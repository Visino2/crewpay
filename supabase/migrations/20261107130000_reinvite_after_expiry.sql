-- CrewPay: let admins re-invite someone whose previous invitation expired.
--
-- organization_invitations_one_pending_idx allows one open invitation per
-- (organization_id, email), where open means not accepted and not revoked.
-- It cannot also exclude expired rows, because an index predicate may not use
-- now(). An invitation that expired unanswered therefore kept the slot:
-- invite_member reported `invitation_pending`, and the Team page, which lists
-- only unexpired invitations, gave the admin no way to revoke it.
--
-- invite_member now revokes expired, still-open invitations for the same
-- organization and email in the same transaction that creates the new one,
-- and writes an `invitation.revoked` audit entry (reason `expired`) for each.
-- Everything else is unchanged and runs first: the admin check, input
-- validation and the already-member check. A caller who may not invite
-- therefore cannot revoke anything, and an active, unexpired invitation still
-- raises `invitation_pending`. If the new invitation cannot be created, the
-- whole call rolls back, revocation and audit entry included.

create or replace function public.invite_member(p_organization_id uuid, p_email text, p_role public.org_role) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.assert_org_role(p_organization_id, array['admin']::public.org_role[]);
  v_email text := private.normalize_email(p_email);
  v_invitation_id uuid;
  v_expired record;
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

  -- Release the slot held by an invitation that expired unanswered. Uses the
  -- same expiry rule as accept_invitation (expires_at <= now()). A concurrent
  -- re-invite blocks on the row lock, then finds nothing left to revoke and
  -- fails on the unique index below with `invitation_pending`.
  for v_expired in
    update public.organization_invitations
    set revoked_at = now()
    where organization_id = p_organization_id
      and email = v_email
      and accepted_at is null
      and revoked_at is null
      and expires_at <= now()
    returning id, role, expires_at
  loop
    perform private.write_audit(p_organization_id, 'invitation.revoked', 'invitation', v_expired.id,
      jsonb_build_object('email', v_email, 'role', v_expired.role, 'reason', 'expired',
                         'expired_at', v_expired.expires_at));
  end loop;

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

-- CREATE OR REPLACE keeps the existing grants; restate them so this function's
-- privileges do not depend on earlier migrations or project defaults. Hosted
-- projects with legacy default privileges grant EXECUTE on new public
-- functions to service_role as well as anon. No request path calls this as
-- service_role, and without auth.uid() it could not succeed anyway.
revoke all on function public.invite_member(uuid, text, public.org_role) from public, anon, service_role;
grant execute on function public.invite_member(uuid, text, public.org_role) to authenticated;
