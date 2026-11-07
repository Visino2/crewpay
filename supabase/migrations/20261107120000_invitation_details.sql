-- CrewPay: let an invitee see who invited them, and to which organization.
--
-- RLS hides organizations from non-members, so an invitee could see their
-- invitation row but not the organization's name. This function returns only
-- pending, unexpired invitations addressed to the caller's own confirmed
-- email, with the organization name and the inviter's name.

create function public.list_my_invitations()
returns table (
  id uuid,
  organization_id uuid,
  organization_name text,
  role public.org_role,
  invited_by_name text,
  created_at timestamptz,
  expires_at timestamptz
)
language sql stable security definer set search_path = '' as $$
  select
    i.id,
    i.organization_id,
    o.name,
    i.role,
    coalesce(p.full_name, p.email),
    i.created_at,
    i.expires_at
  from public.organization_invitations i
  join public.organizations o on o.id = i.organization_id
  join public.user_profiles p on p.id = i.invited_by
  where i.email = private.confirmed_email()
    and i.accepted_at is null
    and i.revoked_at is null
    and i.expires_at > now()
  order by i.created_at desc;
$$;

revoke all on function public.list_my_invitations() from public, anon;
grant execute on function public.list_my_invitations() to authenticated;
