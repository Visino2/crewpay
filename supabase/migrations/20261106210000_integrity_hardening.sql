-- CrewPay: integrity hardening from the Step 2B review against local Supabase
-- (PostgreSQL 17.6).
--
-- Confirmed findings fixed here:
-- 0. Pay-run snapshots exposed a plain SHA-256 of each payout method's raw
--    details, readable by every organization member. Account numbers have
--    little entropy and the masked label already shows the last four digits,
--    so the full number was recovered by brute force in seconds. Snapshots now
--    reference the immutable payout-method version instead (its ID and
--    version pin the exact details; rows cannot be altered).
-- 1. TRUNCATE bypassed the immutability triggers. Row-level triggers do not
--    fire on TRUNCATE, and Supabase's default privileges grant TRUNCATE (plus
--    REFERENCES, TRIGGER and MAINTAIN) on new tables to service_role. In a
--    rolled-back test, service_role was refused a row DELETE on
--    pay_run_approvals but could TRUNCATE approvals, submissions, pay-run
--    items and payout-method history. Only audit_logs had a TRUNCATE guard.
-- 2. An approval's run and submission were each tied to the organization, but
--    not to each other, so a row could pair run A with run B's submission.
--
-- Defense in depth added here:
-- 3. Workflow rules were enforced only inside the RPC functions. They are now
--    also enforced by triggers, so they hold for any writer, including the
--    table owner and any future server-side code: status changes must follow
--    the workflow and be backed by the matching submission or decision, and
--    submissions and approvals can only be recorded by the authenticated user
--    they name (auth.uid()).
--
-- Remaining boundary: the table owner (postgres) can still disable triggers
-- with ALTER TABLE. Only database administrators hold that power.

-- ---------------------------------------------------------------------------
-- 0. Snapshots carry no derivative of raw payout details
-- ---------------------------------------------------------------------------

create or replace function private.pay_run_snapshot(p_pay_run_id uuid) returns jsonb
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
        -- Payout-method rows are immutable versions, so ID + version pin the
        -- exact details without exposing anything derived from them.
        'payout_method_id', m.id,
        'payout_method_version', m.version,
        'payout_method_current', m.is_current,
        'rail', m.rail,
        'payout_display', m.display_label,
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

-- ---------------------------------------------------------------------------
-- 1. Block TRUNCATE on protected tables for every role, including the owner
-- ---------------------------------------------------------------------------

create trigger contractor_payout_methods_no_truncate
  before truncate on public.contractor_payout_methods
  for each statement execute function private.reject_mutation();

create trigger pay_run_items_no_truncate
  before truncate on public.pay_run_items
  for each statement execute function private.reject_mutation();

create trigger pay_run_submissions_no_truncate
  before truncate on public.pay_run_submissions
  for each statement execute function private.reject_mutation();

create trigger pay_run_approvals_no_truncate
  before truncate on public.pay_run_approvals
  for each statement execute function private.reject_mutation();

-- No application role needs table privileges beyond what earlier migrations
-- granted explicitly. service_role is not used by any request path; revoke
-- everything (including TRUNCATE, TRIGGER, REFERENCES and MAINTAIN) so it
-- stays least-privileged on any Supabase version's defaults.
revoke all on all tables in schema public from service_role;
revoke all on all sequences in schema public from service_role;

-- ---------------------------------------------------------------------------
-- 2. An approval must belong to a submission of the same pay run
-- ---------------------------------------------------------------------------

alter table public.pay_run_submissions
  add constraint pay_run_submissions_pay_run_id_id_key unique (pay_run_id, id);

alter table public.pay_run_approvals
  add constraint pay_run_approvals_pay_run_submission_fkey
  foreign key (pay_run_id, submission_id) references public.pay_run_submissions (pay_run_id, id);

-- ---------------------------------------------------------------------------
-- 3. Workflow guards
-- ---------------------------------------------------------------------------

-- Separation of duties, shared by the approval function and the approval guard.
create function private.has_prepared_pay_run(p_pay_run_id uuid, p_user_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.pay_runs r where r.id = p_pay_run_id and r.created_by = p_user_id)
    or exists (
      select 1 from public.pay_run_submissions s
      where s.pay_run_id = p_pay_run_id and s.submitted_by = p_user_id
    )
    or exists (
      select 1 from public.pay_run_items i
      where i.pay_run_id = p_pay_run_id and (i.created_by = p_user_id or i.updated_by = p_user_id)
    )
    or exists (
      select 1 from public.pay_run_items i
      join public.contractor_payout_methods m on m.id = i.payout_method_id
      where i.pay_run_id = p_pay_run_id and m.created_by = p_user_id
    )
    or exists (
      select 1 from public.audit_logs a
      where a.entity_type = 'pay_run'
        and a.entity_id = p_pay_run_id
        and a.actor_id = p_user_id
        and a.action in ('pay_run.created', 'pay_run.item_upserted', 'pay_run.item_removed',
                         'pay_run.submitted', 'pay_run.withdrawn', 'pay_run.reopened')
    );
$$;

create function private.guard_pay_run_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'draft' or new.version <> 1 then
      raise exception 'invalid_state' using errcode = 'P0001', detail = 'new_pay_run_must_be_draft';
    end if;
    return new;
  end if;

  if (new.id, new.organization_id, new.created_by, new.created_at)
     is distinct from (old.id, old.organization_id, old.created_by, old.created_at) then
    raise exception 'immutable_record' using errcode = '42501';
  end if;

  if old.status <> 'draft'
     and (new.title, new.period_month, new.funding_currency)
         is distinct from (old.title, old.period_month, old.funding_currency) then
    raise exception 'invalid_state' using errcode = 'P0001', detail = 'pay_run_not_draft';
  end if;

  if new.version < old.version then
    raise exception 'invalid_state' using errcode = 'P0001', detail = 'version_decreased';
  end if;

  if new.status = old.status then
    -- Content versions only move while a run is a draft.
    if new.status <> 'draft' and new.version <> old.version then
      raise exception 'invalid_state' using errcode = 'P0001', detail = 'pay_run_not_draft';
    end if;
    return new;
  end if;

  if not (
    (old.status = 'draft' and new.status = 'pending_approval')
    or (old.status = 'pending_approval' and new.status in ('approved', 'rejected', 'draft'))
    or (old.status in ('approved', 'rejected') and new.status = 'draft')
    or (old.status in ('draft', 'rejected') and new.status = 'cancelled')
  ) then
    raise exception 'invalid_state' using errcode = 'P0001', detail = 'invalid_status_transition';
  end if;

  if new.status = 'pending_approval' and not exists (
    select 1 from public.pay_run_submissions s
    where s.pay_run_id = new.id and s.superseded_at is null and s.pay_run_version = new.version
  ) then
    raise exception 'invalid_state' using errcode = 'P0001', detail = 'submission_required';
  end if;

  if new.status in ('approved', 'rejected') and not exists (
    select 1
    from public.pay_run_approvals a
    join public.pay_run_submissions s on s.id = a.submission_id
    where a.pay_run_id = new.id
      and s.superseded_at is null
      and s.pay_run_version = new.version
      and a.decision::text = new.status::text
  ) then
    raise exception 'invalid_state' using errcode = 'P0001', detail = 'decision_required';
  end if;

  if new.status = 'draft' and new.version <= old.version then
    raise exception 'invalid_state' using errcode = 'P0001', detail = 'version_not_incremented';
  end if;

  return new;
end;
$$;

create trigger pay_runs_guard
  before insert or update on public.pay_runs
  for each row execute function private.guard_pay_run_change();

-- The stored snapshot must be the run as it is now, recorded by the
-- authenticated preparer.
create function private.guard_submission_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_run public.pay_runs;
  v_expected jsonb;
begin
  if new.submitted_by is distinct from auth.uid() then
    raise exception 'not_authorized' using errcode = '42501', detail = 'submitter_must_be_caller';
  end if;

  select * into v_run from public.pay_runs where id = new.pay_run_id;
  if not found or v_run.status <> 'draft' or new.pay_run_version <> v_run.version then
    raise exception 'invalid_state' using errcode = 'P0001', detail = 'pay_run_not_draft';
  end if;

  if not exists (
    select 1 from public.organization_members m
    where m.organization_id = new.organization_id
      and m.user_id = new.submitted_by
      and m.role in ('admin', 'preparer')
  ) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  v_expected := private.pay_run_snapshot(new.pay_run_id);
  if new.snapshot is distinct from v_expected
     or new.snapshot_hash is distinct from private.snapshot_hash(v_expected)
     or new.item_count <> jsonb_array_length(v_expected -> 'items') then
    raise exception 'snapshot_mismatch' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create trigger pay_run_submissions_guard_insert
  before insert on public.pay_run_submissions
  for each row execute function private.guard_submission_insert();

-- Only the authenticated approver can record a decision, and only on the
-- current, unmodified submission of a run they did not prepare.
create function private.guard_approval_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_run public.pay_runs;
  v_submission public.pay_run_submissions;
begin
  if new.decided_by is distinct from auth.uid() then
    raise exception 'not_authorized' using errcode = '42501', detail = 'decider_must_be_caller';
  end if;

  select * into v_run from public.pay_runs where id = new.pay_run_id;
  select * into v_submission
  from public.pay_run_submissions
  where id = new.submission_id and pay_run_id = new.pay_run_id;

  if v_run.id is null
     or v_submission.id is null
     or v_run.status <> 'pending_approval'
     or v_submission.superseded_at is not null
     or v_submission.pay_run_version <> v_run.version then
    raise exception 'stale_submission' using errcode = 'P0001';
  end if;

  if new.snapshot_hash is distinct from v_submission.snapshot_hash
     or private.snapshot_hash(private.pay_run_snapshot(new.pay_run_id)) <> v_submission.snapshot_hash then
    raise exception 'snapshot_mismatch' using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from public.organization_members m
    where m.organization_id = new.organization_id
      and m.user_id = new.decided_by
      and m.role in ('admin', 'approver')
  ) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  if private.has_prepared_pay_run(new.pay_run_id, new.decided_by) then
    raise exception 'self_approval_forbidden' using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger pay_run_approvals_guard_insert
  before insert on public.pay_run_approvals
  for each row execute function private.guard_approval_insert();

-- The approval function now uses the shared separation-of-duties check; the
-- insert guard repeats every check for any other writer.
create or replace function private.decide_pay_run(
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

  if p_snapshot_hash is null or p_snapshot_hash <> v_submission.snapshot_hash then
    raise exception 'snapshot_mismatch' using errcode = 'P0001';
  end if;

  if private.snapshot_hash(private.pay_run_snapshot(p_pay_run_id)) <> v_submission.snapshot_hash then
    raise exception 'snapshot_mismatch' using errcode = 'P0001';
  end if;

  if private.has_prepared_pay_run(p_pay_run_id, v_uid) then
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

-- ---------------------------------------------------------------------------
-- Function privileges for the helpers added above
-- ---------------------------------------------------------------------------

revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function
  private.is_org_member(uuid),
  private.has_org_role(uuid, public.org_role[]),
  private.shares_org_with(uuid),
  private.confirmed_email()
to authenticated;
