-- CrewPay: tenancy, membership, invitations and the append-only audit log.
--
-- Security model
-- * Every organization-owned table has RLS enabled. The `authenticated` role
--   gets SELECT only, filtered by membership. `anon` gets nothing.
-- * All writes from application users go through SECURITY DEFINER functions
--   in `public` (exposed as RPCs). Each one derives the organization from the
--   target row, checks the caller's role, validates input and writes an audit
--   record in the same transaction.
-- * Internal helpers live in the `private` schema, which is not exposed by the
--   Data API.
-- * Error messages are stable codes (e.g. `not_found`, `not_authorized`) that
--   the application maps to safe user-facing text.

create schema if not exists private;
revoke all on schema private from public;

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------

create type public.org_role as enum ('admin', 'preparer', 'approver', 'viewer');

-- ---------------------------------------------------------------------------
-- Generic helpers
-- ---------------------------------------------------------------------------

create function private.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create function private.reject_mutation() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'immutable_record' using
    errcode = '42501',
    detail = format('%s on %I.%I is not allowed', tg_op, tg_table_schema, tg_table_name);
end;
$$;

create function private.require_user() returns uuid
language plpgsql stable set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  return v_uid;
end;
$$;

create function private.normalize_email(p_email text) returns text
language plpgsql immutable set search_path = '' as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
begin
  if char_length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'invalid_input' using errcode = '22023', detail = 'email';
  end if;
  return v_email;
end;
$$;

-- ---------------------------------------------------------------------------
-- User profiles (one per auth user, maintained by triggers on auth.users)
-- ---------------------------------------------------------------------------

create table public.user_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null check (email = lower(email) and char_length(email) <= 254),
  full_name text check (full_name is null or char_length(full_name) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger user_profiles_touch_updated_at
  before update on public.user_profiles
  for each row execute function private.touch_updated_at();

create function private.sync_user_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.user_profiles (id, email, full_name)
    values (
      new.id,
      lower(coalesce(new.email, '')),
      left(nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''), 120)
    );
  elsif new.email is distinct from old.email then
    update public.user_profiles
    set email = lower(coalesce(new.email, ''))
    where id = new.id;
  end if;
  return new;
end;
$$;

create trigger crewpay_user_profile_on_insert
  after insert on auth.users
  for each row execute function private.sync_user_profile();

create trigger crewpay_user_profile_on_email_change
  after update of email on auth.users
  for each row execute function private.sync_user_profile();

-- ---------------------------------------------------------------------------
-- Organizations and membership
-- ---------------------------------------------------------------------------

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120 and name = btrim(name)),
  created_by uuid not null references public.user_profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger organizations_touch_updated_at
  before update on public.organizations
  for each row execute function private.touch_updated_at();

create table public.organization_members (
  organization_id uuid not null references public.organizations (id),
  user_id uuid not null references public.user_profiles (id),
  role public.org_role not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create index organization_members_user_idx on public.organization_members (user_id);

create trigger organization_members_touch_updated_at
  before update on public.organization_members
  for each row execute function private.touch_updated_at();

create table public.organization_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  email text not null check (email = lower(email) and char_length(email) <= 254),
  role public.org_role not null,
  invited_by uuid not null references public.user_profiles (id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  accepted_by uuid references public.user_profiles (id),
  revoked_at timestamptz,
  check (expires_at > created_at),
  check (accepted_at is null or revoked_at is null),
  check ((accepted_at is null) = (accepted_by is null))
);

create unique index organization_invitations_one_pending_idx
  on public.organization_invitations (organization_id, email)
  where accepted_at is null and revoked_at is null;

create index organization_invitations_email_idx on public.organization_invitations (email);

-- ---------------------------------------------------------------------------
-- Audit log (append-only)
-- ---------------------------------------------------------------------------

create table public.audit_logs (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations (id),
  -- No foreign key: the record must outlive the account that created it.
  actor_id uuid,
  action text not null check (action ~ '^[a-z_]+\.[a-z_]+$'),
  entity_type text not null check (entity_type ~ '^[a-z_]+$'),
  entity_id uuid,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default now()
);

create index audit_logs_org_created_idx on public.audit_logs (organization_id, created_at desc);
create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id);

create trigger audit_logs_no_update_or_delete
  before update or delete on public.audit_logs
  for each row execute function private.reject_mutation();

create trigger audit_logs_no_truncate
  before truncate on public.audit_logs
  for each statement execute function private.reject_mutation();

create function private.write_audit(
  p_organization_id uuid,
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_details jsonb default '{}'::jsonb
) returns void
language sql security definer set search_path = '' as $$
  insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, details)
  values (p_organization_id, auth.uid(), p_action, p_entity_type, p_entity_id, coalesce(p_details, '{}'::jsonb));
$$;

-- ---------------------------------------------------------------------------
-- Authorization helpers
-- ---------------------------------------------------------------------------

-- Used by RLS policies. SECURITY DEFINER avoids recursive RLS evaluation on
-- organization_members; each only answers questions about the caller.
create function private.is_org_member(p_organization_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = p_organization_id
      and m.user_id = (select auth.uid())
  );
$$;

create function private.has_org_role(p_organization_id uuid, p_roles public.org_role[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = p_organization_id
      and m.user_id = (select auth.uid())
      and m.role = any (p_roles)
  );
$$;

create function private.shares_org_with(p_user_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.organization_members mine
    join public.organization_members theirs on theirs.organization_id = mine.organization_id
    where mine.user_id = (select auth.uid())
      and theirs.user_id = p_user_id
  );
$$;

-- The caller's email, only if it has been confirmed.
create function private.confirmed_email() returns text
language sql stable security definer set search_path = '' as $$
  select lower(u.email)
  from auth.users u
  where u.id = (select auth.uid())
    and u.email_confirmed_at is not null;
$$;

-- Raises `not_found` when the caller is not a member (so other organizations'
-- IDs are indistinguishable from nonexistent ones) and `not_authorized` when
-- the caller is a member without one of the required roles.
create function private.assert_org_role(p_organization_id uuid, p_roles public.org_role[]) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v_role public.org_role;
begin
  select m.role into v_role
  from public.organization_members m
  where m.organization_id = p_organization_id
    and m.user_id = v_uid;

  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  if not (v_role = any (p_roles)) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  return v_uid;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPCs: organizations and membership
-- ---------------------------------------------------------------------------

create function public.create_organization(p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v_name text := btrim(coalesce(p_name, ''));
  v_organization_id uuid;
begin
  if char_length(v_name) not between 2 and 120 then
    raise exception 'invalid_input' using errcode = '22023', detail = 'name';
  end if;

  insert into public.organizations (name, created_by)
  values (v_name, v_uid)
  returning id into v_organization_id;

  insert into public.organization_members (organization_id, user_id, role)
  values (v_organization_id, v_uid, 'admin');

  perform private.write_audit(v_organization_id, 'organization.created', 'organization', v_organization_id,
    jsonb_build_object('name', v_name));

  return v_organization_id;
end;
$$;

create function public.invite_member(p_organization_id uuid, p_email text, p_role public.org_role) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.assert_org_role(p_organization_id, array['admin']::public.org_role[]);
  v_email text := private.normalize_email(p_email);
  v_invitation_id uuid;
begin
  if p_role is null then
    raise exception 'invalid_input' using errcode = '22023', detail = 'role';
  end if;

  if exists (
    select 1
    from public.organization_members m
    join public.user_profiles p on p.id = m.user_id
    where m.organization_id = p_organization_id and p.email = v_email
  ) then
    raise exception 'conflict' using errcode = '23505', detail = 'already_member';
  end if;

  begin
    insert into public.organization_invitations (organization_id, email, role, invited_by)
    values (p_organization_id, v_email, p_role, v_uid)
    returning id into v_invitation_id;
  exception when unique_violation then
    raise exception 'conflict' using errcode = '23505', detail = 'invitation_pending';
  end;

  perform private.write_audit(p_organization_id, 'member.invited', 'invitation', v_invitation_id,
    jsonb_build_object('email', v_email, 'role', p_role));

  return v_invitation_id;
end;
$$;

create function public.revoke_invitation(p_invitation_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_invitation public.organization_invitations;
begin
  select * into v_invitation
  from public.organization_invitations
  where id = p_invitation_id
  for update;

  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  perform private.assert_org_role(v_invitation.organization_id, array['admin']::public.org_role[]);

  if v_invitation.accepted_at is not null or v_invitation.revoked_at is not null then
    raise exception 'invalid_state' using errcode = 'P0001', detail = 'invitation_closed';
  end if;

  update public.organization_invitations set revoked_at = now() where id = p_invitation_id;

  perform private.write_audit(v_invitation.organization_id, 'invitation.revoked', 'invitation', p_invitation_id,
    jsonb_build_object('email', v_invitation.email));
end;
$$;

create function public.accept_invitation(p_invitation_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v_email text := private.confirmed_email();
  v_invitation public.organization_invitations;
begin
  if v_email is null then
    raise exception 'email_not_confirmed' using errcode = '42501';
  end if;

  select * into v_invitation
  from public.organization_invitations
  where id = p_invitation_id
  for update;

  -- An invitation addressed to someone else is indistinguishable from a
  -- nonexistent one.
  if not found or v_invitation.email <> v_email then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  if v_invitation.accepted_at is not null
     or v_invitation.revoked_at is not null
     or v_invitation.expires_at <= now() then
    raise exception 'invalid_state' using errcode = 'P0001', detail = 'invitation_closed';
  end if;

  if exists (
    select 1 from public.organization_members
    where organization_id = v_invitation.organization_id and user_id = v_uid
  ) then
    raise exception 'conflict' using errcode = '23505', detail = 'already_member';
  end if;

  insert into public.organization_members (organization_id, user_id, role)
  values (v_invitation.organization_id, v_uid, v_invitation.role);

  update public.organization_invitations
  set accepted_at = now(), accepted_by = v_uid
  where id = p_invitation_id;

  perform private.write_audit(v_invitation.organization_id, 'member.joined', 'member', v_uid,
    jsonb_build_object('role', v_invitation.role, 'invitation_id', p_invitation_id));

  return v_invitation.organization_id;
end;
$$;

create function public.change_member_role(p_organization_id uuid, p_user_id uuid, p_role public.org_role) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_old_role public.org_role;
  v_admin_count integer;
begin
  perform private.assert_org_role(p_organization_id, array['admin']::public.org_role[]);

  if p_role is null then
    raise exception 'invalid_input' using errcode = '22023', detail = 'role';
  end if;

  -- Lock the admin rows so two concurrent demotions cannot remove the last admin.
  perform 1 from public.organization_members
  where organization_id = p_organization_id and role = 'admin'
  for update;

  select role into v_old_role
  from public.organization_members
  where organization_id = p_organization_id and user_id = p_user_id
  for update;

  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  if v_old_role = p_role then
    return;
  end if;

  if v_old_role = 'admin' then
    select count(*) into v_admin_count
    from public.organization_members
    where organization_id = p_organization_id and role = 'admin';

    if v_admin_count <= 1 then
      raise exception 'last_admin' using errcode = 'P0001';
    end if;
  end if;

  update public.organization_members
  set role = p_role
  where organization_id = p_organization_id and user_id = p_user_id;

  perform private.write_audit(p_organization_id, 'member.role_changed', 'member', p_user_id,
    jsonb_build_object('previous_role', v_old_role, 'role', p_role));
end;
$$;

create function public.remove_member(p_organization_id uuid, p_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_old_role public.org_role;
  v_admin_count integer;
begin
  perform private.assert_org_role(p_organization_id, array['admin']::public.org_role[]);

  perform 1 from public.organization_members
  where organization_id = p_organization_id and role = 'admin'
  for update;

  select role into v_old_role
  from public.organization_members
  where organization_id = p_organization_id and user_id = p_user_id
  for update;

  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  if v_old_role = 'admin' then
    select count(*) into v_admin_count
    from public.organization_members
    where organization_id = p_organization_id and role = 'admin';

    if v_admin_count <= 1 then
      raise exception 'last_admin' using errcode = 'P0001';
    end if;
  end if;

  delete from public.organization_members
  where organization_id = p_organization_id and user_id = p_user_id;

  perform private.write_audit(p_organization_id, 'member.removed', 'member', p_user_id,
    jsonb_build_object('previous_role', v_old_role));
end;
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.user_profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.organization_invitations enable row level security;
alter table public.audit_logs enable row level security;

create policy user_profiles_select_self_or_colleague on public.user_profiles
  for select to authenticated
  using (id = (select auth.uid()) or private.shares_org_with(id));

create policy organizations_select_member on public.organizations
  for select to authenticated
  using (private.is_org_member(id));

create policy organization_members_select_member on public.organization_members
  for select to authenticated
  using (private.is_org_member(organization_id));

create policy organization_invitations_select_admin_or_invitee on public.organization_invitations
  for select to authenticated
  using (
    private.has_org_role(organization_id, array['admin']::public.org_role[])
    or (
      email = private.confirmed_email()
      and accepted_at is null
      and revoked_at is null
      and expires_at > now()
    )
  );

create policy audit_logs_select_admin_or_approver on public.audit_logs
  for select to authenticated
  using (private.has_org_role(organization_id, array['admin', 'approver']::public.org_role[]));

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
-- Supabase grants ALL on new public tables and functions to anon and
-- authenticated by default; reset to least privilege explicitly.

revoke all on table
  public.user_profiles,
  public.organizations,
  public.organization_members,
  public.organization_invitations,
  public.audit_logs
from anon, authenticated;

grant select on table
  public.user_profiles,
  public.organizations,
  public.organization_members,
  public.organization_invitations,
  public.audit_logs
to authenticated;

revoke all on all sequences in schema public from anon, authenticated;

revoke all on all functions in schema private from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function
  private.is_org_member(uuid),
  private.has_org_role(uuid, public.org_role[]),
  private.shares_org_with(uuid),
  private.confirmed_email()
to authenticated;

revoke all on function
  public.create_organization(text),
  public.invite_member(uuid, text, public.org_role),
  public.revoke_invitation(uuid),
  public.accept_invitation(uuid),
  public.change_member_role(uuid, uuid, public.org_role),
  public.remove_member(uuid, uuid)
from public, anon;

grant execute on function
  public.create_organization(text),
  public.invite_member(uuid, text, public.org_role),
  public.revoke_invitation(uuid),
  public.accept_invitation(uuid),
  public.change_member_role(uuid, uuid, public.org_role),
  public.remove_member(uuid, uuid)
to authenticated;
