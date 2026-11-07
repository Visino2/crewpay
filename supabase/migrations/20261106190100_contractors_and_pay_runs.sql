-- CrewPay: contractors, versioned payout methods, pay runs, immutable
-- submission snapshots and approvals.
--
-- Integrity rules enforced here (not only in the application):
-- * Composite foreign keys keep every child row in its parent's organization.
-- * Payout methods are immutable versions; changing details creates a new
--   version and invalidates any pending or approved pay run that pays the
--   contractor.
-- * Pay-run items can only change while the run is a draft.
-- * Submitting a run stores an immutable snapshot and its SHA-256 hash.
--   Approval must quote that hash, must match a fresh recomputation of the
--   run, and must come from someone who did not prepare the run.
-- * Raw payout details are never readable by the `authenticated` role.

create type public.contractor_status as enum ('active', 'archived');
create type public.verification_status as enum ('not_started', 'pending', 'verified', 'rejected');
create type public.payout_rail as enum ('bank_transfer', 'mobile_money', 'ach', 'wire', 'interac');
create type public.pay_run_status as enum ('draft', 'pending_approval', 'approved', 'rejected', 'cancelled');
create type public.approval_decision as enum ('approved', 'rejected');

-- ---------------------------------------------------------------------------
-- Contractors
-- ---------------------------------------------------------------------------

create table public.contractors (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  full_name text not null check (char_length(full_name) between 2 and 120 and full_name = btrim(full_name)),
  email text check (email is null or (email = lower(email) and char_length(email) <= 254)),
  country_code text not null check (country_code ~ '^[A-Z]{2}$'),
  status public.contractor_status not null default 'active',
  -- Set only by the server-side provider integration (service role), never by users.
  provider_customer_id text check (provider_customer_id is null or char_length(provider_customer_id) between 1 and 128),
  verification_status public.verification_status not null default 'not_started',
  created_by uuid not null references public.user_profiles (id),
  updated_by uuid not null references public.user_profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id)
);

create index contractors_org_status_idx on public.contractors (organization_id, status);
create unique index contractors_org_email_key on public.contractors (organization_id, email) where email is not null;

create trigger contractors_touch_updated_at
  before update on public.contractors
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Payout methods (immutable versions)
-- ---------------------------------------------------------------------------

create table public.contractor_payout_methods (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  contractor_id uuid not null,
  version integer not null check (version > 0),
  rail public.payout_rail not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  details jsonb not null check (jsonb_typeof(details) = 'object' and pg_column_size(details) <= 4096),
  display_label text not null check (char_length(display_label) between 1 and 120),
  is_current boolean not null default true,
  created_by uuid not null references public.user_profiles (id),
  created_at timestamptz not null default now(),
  superseded_at timestamptz,
  check (is_current = (superseded_at is null)),
  foreign key (organization_id, contractor_id) references public.contractors (organization_id, id),
  unique (contractor_id, version),
  unique (organization_id, id),
  unique (contractor_id, id)
);

create unique index contractor_payout_methods_one_current_idx
  on public.contractor_payout_methods (contractor_id)
  where is_current;

-- Only allowed change: retiring the current version.
create function private.guard_payout_method_change() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'immutable_record' using errcode = '42501';
  end if;

  if (new.id, new.organization_id, new.contractor_id, new.version, new.rail, new.currency,
      new.details, new.display_label, new.created_by, new.created_at)
     is distinct from
     (old.id, old.organization_id, old.contractor_id, old.version, old.rail, old.currency,
      old.details, old.display_label, old.created_by, old.created_at)
     or not (old.is_current and not new.is_current) then
    raise exception 'immutable_record' using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger contractor_payout_methods_guard
  before update or delete on public.contractor_payout_methods
  for each row execute function private.guard_payout_method_change();

-- Field requirements per rail and currency, from the Blaaiz "Create a payout"
-- reference. Returns null for unsupported combinations.
create function private.payout_required_keys(p_rail public.payout_rail, p_currency text) returns text[]
language sql immutable set search_path = '' as $$
  select case
    when p_rail = 'bank_transfer' and p_currency = 'NGN'
      then array['bank_id', 'account_number', 'account_name']
    when p_rail = 'bank_transfer' and p_currency = 'GBP'
      then array['account_number', 'sort_code', 'account_name', 'country', 'street', 'city', 'zip_code']
    when p_rail = 'bank_transfer' and p_currency = 'EUR'
      then array['iban', 'bic_code', 'account_name', 'country', 'street', 'city', 'zip_code']
    when p_rail = 'mobile_money' and p_currency in ('KES', 'UGX', 'TZS', 'XOF', 'GHS')
      then array['phone_number', 'mobile_money_operator_id', 'account_name']
    when p_rail = 'ach' and p_currency = 'USD'
      then array['account_number', 'account_name', 'account_type', 'bank_name', 'routing_number',
                 'country', 'state', 'street', 'city', 'zip_code']
    when p_rail = 'wire' and p_currency = 'USD'
      then array['account_number', 'account_name', 'account_type', 'bank_name', 'routing_number',
                 'swift_code', 'country', 'state', 'street', 'city', 'zip_code']
    when p_rail = 'interac' and p_currency = 'CAD'
      then array['email', 'first_name', 'last_name']
    else null
  end;
$$;

create function private.payout_display_label(p_rail public.payout_rail, p_currency text, p_details jsonb) returns text
language sql immutable set search_path = '' as $$
  select p_currency || ' '
    || case p_rail
         when 'bank_transfer' then 'bank'
         when 'mobile_money' then 'mobile money'
         when 'ach' then 'ACH'
         when 'wire' then 'wire'
         when 'interac' then 'Interac'
       end
    || ' '
    || case
         when p_rail = 'interac' then
           left(p_details ->> 'email', 1) || '***@' || split_part(p_details ->> 'email', '@', 2)
         else
           '****' || right(regexp_replace(
             coalesce(p_details ->> 'account_number', p_details ->> 'iban', p_details ->> 'phone_number', ''),
             '[^0-9A-Za-z]', '', 'g'), 4)
       end;
$$;

-- ---------------------------------------------------------------------------
-- Pay runs
-- ---------------------------------------------------------------------------

create table public.pay_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  title text not null check (char_length(title) between 2 and 120 and title = btrim(title)),
  period_month date not null check (extract(day from period_month) = 1),
  funding_currency text not null check (funding_currency ~ '^[A-Z]{3}$'),
  status public.pay_run_status not null default 'draft',
  -- Incremented on every change to the run's content or state; a submission
  -- is only approvable while the run is still at the submitted version.
  version integer not null default 1 check (version > 0),
  created_by uuid not null references public.user_profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id)
);

create index pay_runs_org_period_idx on public.pay_runs (organization_id, period_month desc);

create trigger pay_runs_touch_updated_at
  before update on public.pay_runs
  for each row execute function private.touch_updated_at();

create table public.pay_run_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  pay_run_id uuid not null,
  contractor_id uuid not null,
  payout_method_id uuid not null,
  -- The exact amount the contractor should receive, in `currency`.
  amount numeric(18, 2) not null check (amount > 0 and amount <= 1000000000),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  memo text check (memo is null or char_length(memo) between 1 and 140),
  created_by uuid not null references public.user_profiles (id),
  updated_by uuid not null references public.user_profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, pay_run_id) references public.pay_runs (organization_id, id),
  foreign key (organization_id, contractor_id) references public.contractors (organization_id, id),
  foreign key (organization_id, payout_method_id) references public.contractor_payout_methods (organization_id, id),
  foreign key (contractor_id, payout_method_id) references public.contractor_payout_methods (contractor_id, id),
  unique (pay_run_id, contractor_id)
);

create index pay_run_items_contractor_idx on public.pay_run_items (contractor_id);

create trigger pay_run_items_touch_updated_at
  before update on public.pay_run_items
  for each row execute function private.touch_updated_at();

-- Items may only change while their run is a draft, whoever is writing.
create function private.guard_pay_run_item_change() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_status public.pay_run_status;
begin
  select status into v_status
  from public.pay_runs
  where id = case when tg_op = 'DELETE' then old.pay_run_id else new.pay_run_id end;

  if v_status is distinct from 'draft' then
    raise exception 'invalid_state' using errcode = 'P0001', detail = 'pay_run_not_draft';
  end if;

  if tg_op = 'UPDATE' and (new.pay_run_id <> old.pay_run_id or new.organization_id <> old.organization_id) then
    raise exception 'immutable_record' using errcode = '42501';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger pay_run_items_guard
  before insert or update or delete on public.pay_run_items
  for each row execute function private.guard_pay_run_item_change();

-- ---------------------------------------------------------------------------
-- Submissions (immutable snapshots) and approvals
-- ---------------------------------------------------------------------------

create table public.pay_run_submissions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  pay_run_id uuid not null,
  pay_run_version integer not null check (pay_run_version > 0),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  snapshot_hash text not null check (snapshot_hash ~ '^[0-9a-f]{64}$'),
  item_count integer not null check (item_count > 0),
  submitted_by uuid not null references public.user_profiles (id),
  submitted_at timestamptz not null default now(),
  -- Set when the submission is withdrawn, invalidated or reopened.
  superseded_at timestamptz,
  foreign key (organization_id, pay_run_id) references public.pay_runs (organization_id, id),
  unique (pay_run_id, pay_run_version),
  unique (organization_id, id)
);

create unique index pay_run_submissions_one_active_idx
  on public.pay_run_submissions (pay_run_id)
  where superseded_at is null;

-- Only allowed change: marking an active submission superseded.
create function private.guard_submission_change() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'immutable_record' using errcode = '42501';
  end if;

  if (new.id, new.organization_id, new.pay_run_id, new.pay_run_version, new.snapshot,
      new.snapshot_hash, new.item_count, new.submitted_by, new.submitted_at)
     is distinct from
     (old.id, old.organization_id, old.pay_run_id, old.pay_run_version, old.snapshot,
      old.snapshot_hash, old.item_count, old.submitted_by, old.submitted_at)
     or old.superseded_at is not null
     or new.superseded_at is null then
    raise exception 'immutable_record' using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger pay_run_submissions_guard
  before update or delete on public.pay_run_submissions
  for each row execute function private.guard_submission_change();

create table public.pay_run_approvals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  pay_run_id uuid not null,
  submission_id uuid not null,
  snapshot_hash text not null check (snapshot_hash ~ '^[0-9a-f]{64}$'),
  decision public.approval_decision not null,
  decided_by uuid not null references public.user_profiles (id),
  comment text check (comment is null or char_length(comment) between 1 and 500),
  decided_at timestamptz not null default now(),
  check (decision = 'approved' or comment is not null),
  foreign key (organization_id, pay_run_id) references public.pay_runs (organization_id, id),
  foreign key (organization_id, submission_id) references public.pay_run_submissions (organization_id, id),
  unique (submission_id)
);

create index pay_run_approvals_pay_run_idx on public.pay_run_approvals (pay_run_id);

create trigger pay_run_approvals_immutable
  before update or delete on public.pay_run_approvals
  for each row execute function private.reject_mutation();

-- ---------------------------------------------------------------------------
-- Snapshot helpers
-- ---------------------------------------------------------------------------

-- Canonical description of what an approver signs off. Includes a hash of
-- each payout method's details so any change to account data is detected
-- without exposing the data itself.
create function private.pay_run_snapshot(p_pay_run_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'pay_run_id', r.id,
    'organization_id', r.organization_id,
    'version', r.version,
    'title', r.title,
    'period_month', r.period_month,
    'funding_currency', r.funding_currency,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'item_id', i.id,
        'contractor_id', c.id,
        'contractor_name', c.full_name,
        'contractor_country', c.country_code,
        'contractor_status', c.status,
        'verification_status', c.verification_status,
        'payout_method_id', m.id,
        'payout_method_version', m.version,
        'payout_method_current', m.is_current,
        'rail', m.rail,
        'payout_display', m.display_label,
        'payout_details_sha256', encode(sha256(convert_to(m.details::text, 'UTF8')), 'hex'),
        'amount', i.amount::text,
        'currency', i.currency,
        'memo', i.memo
      ) order by c.full_name, i.id)
      from public.pay_run_items i
      join public.contractors c on c.id = i.contractor_id
      join public.contractor_payout_methods m on m.id = i.payout_method_id
      where i.pay_run_id = r.id
    ), '[]'::jsonb),
    'totals', coalesce((
      select jsonb_agg(jsonb_build_object('currency', t.currency, 'amount', t.total::text, 'items', t.item_count)
                       order by t.currency)
      from (
        select currency, sum(amount) as total, count(*) as item_count
        from public.pay_run_items
        where pay_run_id = r.id
        group by currency
      ) t
    ), '[]'::jsonb)
  )
  from public.pay_runs r
  where r.id = p_pay_run_id;
$$;

create function private.snapshot_hash(p_snapshot jsonb) returns text
language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(p_snapshot::text, 'UTF8')), 'hex');
$$;

-- Returns pending or approved runs that pay this contractor to draft, so
-- nobody can approve or execute a run against outdated contractor data.
create function private.invalidate_contractor_runs(p_contractor_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_run record;
begin
  for v_run in
    select pr.id, pr.organization_id, pr.status
    from public.pay_runs pr
    where pr.status in ('pending_approval', 'approved')
      and exists (
        select 1 from public.pay_run_items i
        where i.pay_run_id = pr.id and i.contractor_id = p_contractor_id
      )
    for update of pr
  loop
    update public.pay_run_submissions
    set superseded_at = now()
    where pay_run_id = v_run.id and superseded_at is null;

    update public.pay_runs
    set status = 'draft', version = version + 1
    where id = v_run.id;

    perform private.write_audit(v_run.organization_id, 'pay_run.invalidated', 'pay_run', v_run.id,
      jsonb_build_object('reason', p_reason, 'previous_status', v_run.status, 'contractor_id', p_contractor_id));
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPCs: contractors
-- ---------------------------------------------------------------------------

create function public.create_contractor(
  p_organization_id uuid,
  p_full_name text,
  p_email text,
  p_country_code text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.assert_org_role(p_organization_id, array['admin', 'preparer']::public.org_role[]);
  v_name text := btrim(coalesce(p_full_name, ''));
  v_email text := case when nullif(btrim(coalesce(p_email, '')), '') is null then null
                       else private.normalize_email(p_email) end;
  v_country text := upper(btrim(coalesce(p_country_code, '')));
  v_contractor_id uuid;
begin
  if char_length(v_name) not between 2 and 120 then
    raise exception 'invalid_input' using errcode = '22023', detail = 'full_name';
  end if;
  if v_country !~ '^[A-Z]{2}$' then
    raise exception 'invalid_input' using errcode = '22023', detail = 'country_code';
  end if;

  begin
    insert into public.contractors (organization_id, full_name, email, country_code, created_by, updated_by)
    values (p_organization_id, v_name, v_email, v_country, v_uid, v_uid)
    returning id into v_contractor_id;
  exception when unique_violation then
    raise exception 'conflict' using errcode = '23505', detail = 'contractor_email_exists';
  end;

  perform private.write_audit(p_organization_id, 'contractor.created', 'contractor', v_contractor_id,
    jsonb_build_object('full_name', v_name, 'email', v_email, 'country_code', v_country));

  return v_contractor_id;
end;
$$;

create function public.update_contractor(
  p_contractor_id uuid,
  p_full_name text,
  p_email text,
  p_country_code text
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_contractor public.contractors;
  v_uid uuid;
  v_name text := btrim(coalesce(p_full_name, ''));
  v_email text;
  v_country text := upper(btrim(coalesce(p_country_code, '')));
begin
  select * into v_contractor from public.contractors where id = p_contractor_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  v_uid := private.assert_org_role(v_contractor.organization_id, array['admin', 'preparer']::public.org_role[]);

  if v_contractor.status <> 'active' then
    raise exception 'invalid_state' using errcode = 'P0001', detail = 'contractor_archived';
  end if;
  if char_length(v_name) not between 2 and 120 then
    raise exception 'invalid_input' using errcode = '22023', detail = 'full_name';
  end if;
  if v_country !~ '^[A-Z]{2}$' then
    raise exception 'invalid_input' using errcode = '22023', detail = 'country_code';
  end if;
  v_email := case when nullif(btrim(coalesce(p_email, '')), '') is null then null
                  else private.normalize_email(p_email) end;

  if (v_name, v_email, v_country) is not distinct from
     (v_contractor.full_name, v_contractor.email, v_contractor.country_code) then
    return;
  end if;

  begin
    update public.contractors
    set full_name = v_name, email = v_email, country_code = v_country, updated_by = v_uid
    where id = p_contractor_id;
  exception when unique_violation then
    raise exception 'conflict' using errcode = '23505', detail = 'contractor_email_exists';
  end;

  perform private.invalidate_contractor_runs(p_contractor_id, 'contractor_updated');

  perform private.write_audit(v_contractor.organization_id, 'contractor.updated', 'contractor', p_contractor_id,
    jsonb_build_object(
      'before', jsonb_build_object('full_name', v_contractor.full_name, 'email', v_contractor.email,
                                   'country_code', v_contractor.country_code),
      'after', jsonb_build_object('full_name', v_name, 'email', v_email, 'country_code', v_country)));
end;
$$;

create function public.archive_contractor(p_contractor_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_contractor public.contractors;
  v_uid uuid;
begin
  select * into v_contractor from public.contractors where id = p_contractor_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  v_uid := private.assert_org_role(v_contractor.organization_id, array['admin', 'preparer']::public.org_role[]);

  if v_contractor.status = 'archived' then
    return;
  end if;

  if exists (
    select 1
    from public.pay_run_items i
    join public.pay_runs r on r.id = i.pay_run_id
    where i.contractor_id = p_contractor_id and r.status in ('pending_approval', 'approved')
  ) then
    raise exception 'invalid_state' using errcode = 'P0001', detail = 'contractor_in_active_pay_run';
  end if;

  update public.contractors set status = 'archived', updated_by = v_uid where id = p_contractor_id;

  perform private.write_audit(v_contractor.organization_id, 'contractor.archived', 'contractor', p_contractor_id, '{}'::jsonb);
end;
$$;

create function public.set_contractor_payout_method(
  p_contractor_id uuid,
  p_rail public.payout_rail,
  p_currency text,
  p_details jsonb
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_contractor public.contractors;
  v_uid uuid;
  v_currency text := upper(btrim(coalesce(p_currency, '')));
  v_required text[];
  v_version integer;
  v_label text;
  v_method_id uuid;
begin
  select * into v_contractor from public.contractors where id = p_contractor_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  v_uid := private.assert_org_role(v_contractor.organization_id, array['admin', 'preparer']::public.org_role[]);

  if v_contractor.status <> 'active' then
    raise exception 'invalid_state' using errcode = 'P0001', detail = 'contractor_archived';
  end if;

  v_required := private.payout_required_keys(p_rail, v_currency);
  if v_required is null then
    raise exception 'invalid_input' using errcode = '22023', detail = 'unsupported_rail_currency';
  end if;

  if p_details is null
     or jsonb_typeof(p_details) <> 'object'
     or not (p_details ?& v_required)
     or (select count(*) from jsonb_object_keys(p_details)) <> cardinality(v_required)
     or exists (
       select 1 from jsonb_each(p_details) e
       where jsonb_typeof(e.value) <> 'string'
          or char_length(btrim(e.value #>> '{}')) not between 1 and 140
     ) then
    raise exception 'invalid_input' using errcode = '22023', detail = 'details';
  end if;

  update public.contractor_payout_methods
  set is_current = false, superseded_at = now()
  where contractor_id = p_contractor_id and is_current;

  select coalesce(max(version), 0) + 1 into v_version
  from public.contractor_payout_methods
  where contractor_id = p_contractor_id;

  v_label := private.payout_display_label(p_rail, v_currency, p_details);

  insert into public.contractor_payout_methods
    (organization_id, contractor_id, version, rail, currency, details, display_label, created_by)
  values
    (v_contractor.organization_id, p_contractor_id, v_version, p_rail, v_currency, p_details, v_label, v_uid)
  returning id into v_method_id;

  perform private.invalidate_contractor_runs(p_contractor_id, 'payout_method_changed');

  -- Never log raw account details.
  perform private.write_audit(v_contractor.organization_id, 'payout_method.set', 'contractor', p_contractor_id,
    jsonb_build_object('payout_method_id', v_method_id, 'version', v_version, 'rail', p_rail,
                       'currency', v_currency, 'display_label', v_label));

  return v_method_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPCs: pay runs
-- ---------------------------------------------------------------------------

create function public.create_pay_run(
  p_organization_id uuid,
  p_title text,
  p_period_month date,
  p_funding_currency text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.assert_org_role(p_organization_id, array['admin', 'preparer']::public.org_role[]);
  v_title text := btrim(coalesce(p_title, ''));
  v_currency text := upper(btrim(coalesce(p_funding_currency, '')));
  v_pay_run_id uuid;
begin
  if char_length(v_title) not between 2 and 120 then
    raise exception 'invalid_input' using errcode = '22023', detail = 'title';
  end if;
  if p_period_month is null or extract(day from p_period_month) <> 1 then
    raise exception 'invalid_input' using errcode = '22023', detail = 'period_month';
  end if;
  if v_currency !~ '^[A-Z]{3}$' then
    raise exception 'invalid_input' using errcode = '22023', detail = 'funding_currency';
  end if;

  insert into public.pay_runs (organization_id, title, period_month, funding_currency, created_by)
  values (p_organization_id, v_title, p_period_month, v_currency, v_uid)
  returning id into v_pay_run_id;

  perform private.write_audit(p_organization_id, 'pay_run.created', 'pay_run', v_pay_run_id,
    jsonb_build_object('title', v_title, 'period_month', p_period_month, 'funding_currency', v_currency));

  return v_pay_run_id;
end;
$$;

create function public.upsert_pay_run_item(
  p_pay_run_id uuid,
  p_contractor_id uuid,
  p_amount numeric,
  p_memo text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_run public.pay_runs;
  v_uid uuid;
  v_contractor public.contractors;
  v_method public.contractor_payout_methods;
  v_memo text := nullif(btrim(coalesce(p_memo, '')), '');
  v_item_id uuid;
  v_previous_amount numeric;
begin
  select * into v_run from public.pay_runs where id = p_pay_run_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  v_uid := private.assert_org_role(v_run.organization_id, array['admin', 'preparer']::public.org_role[]);

  if v_run.status <> 'draft' then
    raise exception 'invalid_state' using errcode = 'P0001', detail = 'pay_run_not_draft';
  end if;

  -- A contractor from another organization is indistinguishable from a missing one.
  select * into v_contractor
  from public.contractors
  where id = p_contractor_id and organization_id = v_run.organization_id;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_contractor.status <> 'active' then
    raise exception 'invalid_state' using errcode = 'P0001', detail = 'contractor_archived';
  end if;

  select * into v_method
  from public.contractor_payout_methods
  where contractor_id = p_contractor_id and is_current;
  if not found then
    raise exception 'invalid_state' using errcode = 'P0001', detail = 'no_payout_method';
  end if;

  if p_amount is null or p_amount <= 0 or p_amount > 1000000000 or p_amount <> round(p_amount, 2) then
    raise exception 'invalid_input' using errcode = '22023', detail = 'amount';
  end if;
  if v_memo is not null and char_length(v_memo) > 140 then
    raise exception 'invalid_input' using errcode = '22023', detail = 'memo';
  end if;

  select id, amount into v_item_id, v_previous_amount
  from public.pay_run_items
  where pay_run_id = p_pay_run_id and contractor_id = p_contractor_id
  for update;

  if found then
    update public.pay_run_items
    set payout_method_id = v_method.id, amount = p_amount, currency = v_method.currency,
        memo = v_memo, updated_by = v_uid
    where id = v_item_id;
  else
    insert into public.pay_run_items
      (organization_id, pay_run_id, contractor_id, payout_method_id, amount, currency, memo, created_by, updated_by)
    values
      (v_run.organization_id, p_pay_run_id, p_contractor_id, v_method.id, p_amount, v_method.currency, v_memo, v_uid, v_uid)
    returning id into v_item_id;
  end if;

  update public.pay_runs set version = version + 1 where id = p_pay_run_id;

  perform private.write_audit(v_run.organization_id, 'pay_run.item_upserted', 'pay_run', p_pay_run_id,
    jsonb_build_object('item_id', v_item_id, 'contractor_id', p_contractor_id,
                       'amount', p_amount::text, 'previous_amount', v_previous_amount::text,
                       'currency', v_method.currency, 'payout_method_id', v_method.id));

  return v_item_id;
end;
$$;

create function public.remove_pay_run_item(p_item_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_item public.pay_run_items;
  v_run public.pay_runs;
begin
  select * into v_item from public.pay_run_items where id = p_item_id;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  select * into v_run from public.pay_runs where id = v_item.pay_run_id for update;

  perform private.assert_org_role(v_run.organization_id, array['admin', 'preparer']::public.org_role[]);

  if v_run.status <> 'draft' then
    raise exception 'invalid_state' using errcode = 'P0001', detail = 'pay_run_not_draft';
  end if;

  delete from public.pay_run_items where id = p_item_id;
  update public.pay_runs set version = version + 1 where id = v_run.id;

  perform private.write_audit(v_run.organization_id, 'pay_run.item_removed', 'pay_run', v_run.id,
    jsonb_build_object('item_id', p_item_id, 'contractor_id', v_item.contractor_id,
                       'amount', v_item.amount::text, 'currency', v_item.currency));
end;
$$;

create function public.submit_pay_run(p_pay_run_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_run public.pay_runs;
  v_uid uuid;
  v_snapshot jsonb;
  v_hash text;
  v_item_count integer;
  v_submission_id uuid;
begin
  select * into v_run from public.pay_runs where id = p_pay_run_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  v_uid := private.assert_org_role(v_run.organization_id, array['admin', 'preparer']::public.org_role[]);

  if v_run.status <> 'draft' then
    raise exception 'invalid_state' using errcode = 'P0001', detail = 'pay_run_not_draft';
  end if;

  select count(*) into v_item_count from public.pay_run_items where pay_run_id = p_pay_run_id;
  if v_item_count = 0 then
    raise exception 'invalid_state' using errcode = 'P0001', detail = 'empty_pay_run';
  end if;

  if exists (
    select 1 from public.pay_run_items i
    join public.contractors c on c.id = i.contractor_id
    where i.pay_run_id = p_pay_run_id and c.status <> 'active'
  ) then
    raise exception 'invalid_state' using errcode = 'P0001', detail = 'contractor_archived';
  end if;

  if exists (
    select 1 from public.pay_run_items i
    join public.contractor_payout_methods m on m.id = i.payout_method_id
    where i.pay_run_id = p_pay_run_id and not m.is_current
  ) then
    raise exception 'invalid_state' using errcode = 'P0001', detail = 'stale_payout_method';
  end if;

  v_snapshot := private.pay_run_snapshot(p_pay_run_id);
  v_hash := private.snapshot_hash(v_snapshot);

  insert into public.pay_run_submissions
    (organization_id, pay_run_id, pay_run_version, snapshot, snapshot_hash, item_count, submitted_by)
  values
    (v_run.organization_id, p_pay_run_id, v_run.version, v_snapshot, v_hash, v_item_count, v_uid)
  returning id into v_submission_id;

  update public.pay_runs set status = 'pending_approval' where id = p_pay_run_id;

  perform private.write_audit(v_run.organization_id, 'pay_run.submitted', 'pay_run', p_pay_run_id,
    jsonb_build_object('submission_id', v_submission_id, 'version', v_run.version,
                       'snapshot_hash', v_hash, 'item_count', v_item_count,
                       'totals', v_snapshot -> 'totals'));

  return v_submission_id;
end;
$$;

-- Moves a run back to draft, superseding any active submission.
create function private.return_pay_run_to_draft(
  p_pay_run_id uuid,
  p_allowed_from public.pay_run_status[],
  p_action text
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_run public.pay_runs;
begin
  select * into v_run from public.pay_runs where id = p_pay_run_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  perform private.assert_org_role(v_run.organization_id, array['admin', 'preparer']::public.org_role[]);

  if not (v_run.status = any (p_allowed_from)) then
    raise exception 'invalid_state' using errcode = 'P0001', detail = 'pay_run_status';
  end if;

  update public.pay_run_submissions
  set superseded_at = now()
  where pay_run_id = p_pay_run_id and superseded_at is null;

  update public.pay_runs set status = 'draft', version = version + 1 where id = p_pay_run_id;

  perform private.write_audit(v_run.organization_id, p_action, 'pay_run', p_pay_run_id,
    jsonb_build_object('previous_status', v_run.status));
end;
$$;

create function public.withdraw_pay_run(p_pay_run_id uuid) returns void
language sql security definer set search_path = '' as $$
  select private.return_pay_run_to_draft(p_pay_run_id, array['pending_approval']::public.pay_run_status[], 'pay_run.withdrawn');
$$;

create function public.reopen_pay_run(p_pay_run_id uuid) returns void
language sql security definer set search_path = '' as $$
  select private.return_pay_run_to_draft(p_pay_run_id, array['rejected']::public.pay_run_status[], 'pay_run.reopened');
$$;

create function public.cancel_pay_run(p_pay_run_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_run public.pay_runs;
begin
  select * into v_run from public.pay_runs where id = p_pay_run_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  perform private.assert_org_role(v_run.organization_id, array['admin', 'preparer']::public.org_role[]);

  if v_run.status not in ('draft', 'rejected') then
    raise exception 'invalid_state' using errcode = 'P0001', detail = 'pay_run_status';
  end if;

  update public.pay_run_submissions
  set superseded_at = now()
  where pay_run_id = p_pay_run_id and superseded_at is null;

  update public.pay_runs set status = 'cancelled', version = version + 1 where id = p_pay_run_id;

  perform private.write_audit(v_run.organization_id, 'pay_run.cancelled', 'pay_run', p_pay_run_id,
    jsonb_build_object('previous_status', v_run.status));
end;
$$;

create function private.decide_pay_run(
  p_pay_run_id uuid,
  p_submission_id uuid,
  p_snapshot_hash text,
  p_decision public.approval_decision,
  p_comment text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_run public.pay_runs;
  v_submission public.pay_run_submissions;
  v_uid uuid;
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
  v_approval_id uuid;
begin
  select * into v_run from public.pay_runs where id = p_pay_run_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  v_uid := private.assert_org_role(v_run.organization_id, array['admin', 'approver']::public.org_role[]);

  if v_run.status <> 'pending_approval' then
    raise exception 'invalid_state' using errcode = 'P0001', detail = 'pay_run_not_pending';
  end if;

  select * into v_submission
  from public.pay_run_submissions
  where id = p_submission_id and pay_run_id = p_pay_run_id;

  if not found or v_submission.superseded_at is not null or v_submission.pay_run_version <> v_run.version then
    raise exception 'stale_submission' using errcode = 'P0001';
  end if;

  -- The approver must confirm the exact snapshot they reviewed...
  if p_snapshot_hash is null or p_snapshot_hash <> v_submission.snapshot_hash then
    raise exception 'snapshot_mismatch' using errcode = 'P0001';
  end if;

  -- ...and the run must still match it now.
  if private.snapshot_hash(private.pay_run_snapshot(p_pay_run_id)) <> v_submission.snapshot_hash then
    raise exception 'snapshot_mismatch' using errcode = 'P0001';
  end if;

  -- Separation of duties: anyone who created, edited, submitted, withdrew or
  -- reopened this run, or who entered the payout details it pays to, cannot
  -- decide on it.
  if v_uid = v_run.created_by
     or v_uid = v_submission.submitted_by
     or exists (
       select 1 from public.pay_run_items i
       where i.pay_run_id = p_pay_run_id and (i.created_by = v_uid or i.updated_by = v_uid)
     )
     or exists (
       select 1 from public.pay_run_items i
       join public.contractor_payout_methods m on m.id = i.payout_method_id
       where i.pay_run_id = p_pay_run_id and m.created_by = v_uid
     )
     or exists (
       select 1 from public.audit_logs a
       where a.entity_type = 'pay_run'
         and a.entity_id = p_pay_run_id
         and a.actor_id = v_uid
         and a.action in ('pay_run.created', 'pay_run.item_upserted', 'pay_run.item_removed',
                          'pay_run.submitted', 'pay_run.withdrawn', 'pay_run.reopened')
     ) then
    raise exception 'self_approval_forbidden' using errcode = '42501';
  end if;

  if p_decision = 'rejected' and v_comment is null then
    raise exception 'invalid_input' using errcode = '22023', detail = 'comment';
  end if;
  if v_comment is not null and char_length(v_comment) > 500 then
    raise exception 'invalid_input' using errcode = '22023', detail = 'comment';
  end if;

  insert into public.pay_run_approvals
    (organization_id, pay_run_id, submission_id, snapshot_hash, decision, decided_by, comment)
  values
    (v_run.organization_id, p_pay_run_id, p_submission_id, v_submission.snapshot_hash, p_decision, v_uid, v_comment)
  returning id into v_approval_id;

  update public.pay_runs
  set status = case p_decision when 'approved' then 'approved'::public.pay_run_status
                               else 'rejected'::public.pay_run_status end
  where id = p_pay_run_id;

  perform private.write_audit(v_run.organization_id,
    case p_decision when 'approved' then 'pay_run.approved' else 'pay_run.rejected' end,
    'pay_run', p_pay_run_id,
    jsonb_build_object('approval_id', v_approval_id, 'submission_id', p_submission_id,
                       'snapshot_hash', v_submission.snapshot_hash, 'version', v_run.version,
                       'comment', v_comment));

  return v_approval_id;
end;
$$;

create function public.approve_pay_run(p_pay_run_id uuid, p_submission_id uuid, p_snapshot_hash text) returns uuid
language sql security definer set search_path = '' as $$
  select private.decide_pay_run(p_pay_run_id, p_submission_id, p_snapshot_hash, 'approved', null);
$$;

create function public.reject_pay_run(
  p_pay_run_id uuid,
  p_submission_id uuid,
  p_snapshot_hash text,
  p_comment text
) returns uuid
language sql security definer set search_path = '' as $$
  select private.decide_pay_run(p_pay_run_id, p_submission_id, p_snapshot_hash, 'rejected', p_comment);
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.contractors enable row level security;
alter table public.contractor_payout_methods enable row level security;
alter table public.pay_runs enable row level security;
alter table public.pay_run_items enable row level security;
alter table public.pay_run_submissions enable row level security;
alter table public.pay_run_approvals enable row level security;

create policy contractors_select_member on public.contractors
  for select to authenticated using (private.is_org_member(organization_id));

create policy contractor_payout_methods_select_member on public.contractor_payout_methods
  for select to authenticated using (private.is_org_member(organization_id));

create policy pay_runs_select_member on public.pay_runs
  for select to authenticated using (private.is_org_member(organization_id));

create policy pay_run_items_select_member on public.pay_run_items
  for select to authenticated using (private.is_org_member(organization_id));

create policy pay_run_submissions_select_member on public.pay_run_submissions
  for select to authenticated using (private.is_org_member(organization_id));

create policy pay_run_approvals_select_member on public.pay_run_approvals
  for select to authenticated using (private.is_org_member(organization_id));

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

revoke all on table
  public.contractors,
  public.contractor_payout_methods,
  public.pay_runs,
  public.pay_run_items,
  public.pay_run_submissions,
  public.pay_run_approvals
from anon, authenticated;

grant select on table
  public.contractors,
  public.pay_runs,
  public.pay_run_items,
  public.pay_run_submissions,
  public.pay_run_approvals
to authenticated;

-- Raw `details` (account numbers, addresses) are deliberately excluded.
grant select (
  id, organization_id, contractor_id, version, rail, currency, display_label,
  is_current, created_by, created_at, superseded_at
) on public.contractor_payout_methods to authenticated;

revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function
  private.is_org_member(uuid),
  private.has_org_role(uuid, public.org_role[]),
  private.shares_org_with(uuid),
  private.confirmed_email()
to authenticated;

revoke all on function
  public.create_contractor(uuid, text, text, text),
  public.update_contractor(uuid, text, text, text),
  public.archive_contractor(uuid),
  public.set_contractor_payout_method(uuid, public.payout_rail, text, jsonb),
  public.create_pay_run(uuid, text, date, text),
  public.upsert_pay_run_item(uuid, uuid, numeric, text),
  public.remove_pay_run_item(uuid),
  public.submit_pay_run(uuid),
  public.withdraw_pay_run(uuid),
  public.reopen_pay_run(uuid),
  public.cancel_pay_run(uuid),
  public.approve_pay_run(uuid, uuid, text),
  public.reject_pay_run(uuid, uuid, text, text)
from public, anon;

grant execute on function
  public.create_contractor(uuid, text, text, text),
  public.update_contractor(uuid, text, text, text),
  public.archive_contractor(uuid),
  public.set_contractor_payout_method(uuid, public.payout_rail, text, jsonb),
  public.create_pay_run(uuid, text, date, text),
  public.upsert_pay_run_item(uuid, uuid, numeric, text),
  public.remove_pay_run_item(uuid),
  public.submit_pay_run(uuid),
  public.withdraw_pay_run(uuid),
  public.reopen_pay_run(uuid),
  public.cancel_pay_run(uuid),
  public.approve_pay_run(uuid, uuid, text),
  public.reject_pay_run(uuid, uuid, text, text)
to authenticated;
