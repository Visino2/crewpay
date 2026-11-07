-- CrewPay: user-session RPCs are not executable by service_role.
--
-- The hosted project's default privileges (pg_default_acl, read 2026-11-07)
-- grant EXECUTE on every function `postgres` creates in `public` to anon,
-- authenticated and service_role. Earlier migrations revoked PUBLIC and anon
-- but not service_role, so 19 of the 20 public SECURITY DEFINER RPCs were
-- executable with the secret key (invite_member was fixed in
-- 20261107130000). Each RPC derives the actor from auth.uid() and fails
-- without a user session, so the secret key could not use them successfully,
-- but nothing server-side needs them either: the app, demo seed and tests
-- call them only through signed-in user clients, and use the secret key only
-- for the Auth admin API.
--
-- After this migration every public RPC is executable by `authenticated`
-- only (plus its owner, postgres). Grants are restated for all 20 so this
-- file is the single source of truth, and the final block fails the
-- migration if any function in `public` or `private` is still executable by
-- anon, service_role or PUBLIC (other than the four RLS helpers granted to
-- authenticated).

revoke all on function
  public.create_organization(text),
  public.invite_member(uuid, text, public.org_role),
  public.revoke_invitation(uuid),
  public.accept_invitation(uuid),
  public.change_member_role(uuid, uuid, public.org_role),
  public.remove_member(uuid, uuid),
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
  public.reject_pay_run(uuid, uuid, text, text),
  public.list_my_invitations()
from public, anon, service_role;

grant execute on function
  public.create_organization(text),
  public.invite_member(uuid, text, public.org_role),
  public.revoke_invitation(uuid),
  public.accept_invitation(uuid),
  public.change_member_role(uuid, uuid, public.org_role),
  public.remove_member(uuid, uuid),
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
  public.reject_pay_run(uuid, uuid, text, text),
  public.list_my_invitations()
to authenticated;

-- Fail the migration (and roll it back) if the end state is not as intended.
do $$
declare
  v_exposed text;
  v_unpinned text;
begin
  select string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text)
  into v_exposed
  from pg_proc p
  where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
    and (
      has_function_privilege('anon', p.oid, 'execute')
      or has_function_privilege('service_role', p.oid, 'execute')
      or exists (
        select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        where a.grantee = 0 and a.privilege_type = 'EXECUTE'
      )
    );
  if v_exposed is not null then
    raise exception 'functions executable by anon, service_role or PUBLIC: %', v_exposed;
  end if;

  select string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text)
  into v_unpinned
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace
    and (not p.prosecdef or p.proconfig is null or not ('search_path=""' = any (p.proconfig)));
  if v_unpinned is not null then
    raise exception 'public functions without SECURITY DEFINER and a fixed search_path: %', v_unpinned;
  end if;
end;
$$;
