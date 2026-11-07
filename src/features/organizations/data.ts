import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { callRpc, throwIfError } from "@/lib/supabase/rpc";
import { orgRoleSchema, uuidSchema } from "@/lib/validation/common";
import type {
  ChangeMemberRoleInput,
  CreateOrganizationInput,
  InviteMemberInput,
  RemoveMemberInput,
} from "@/lib/validation/organizations";

const membershipSchema = z.object({
  role: orgRoleSchema,
  organization: z.object({ id: uuidSchema, name: z.string() }),
});

export type Membership = { organizationId: string; name: string; role: z.output<typeof orgRoleSchema> };

export async function listMyMemberships(db: SupabaseClient, userId: string): Promise<Membership[]> {
  const { data, error } = await db
    .from("organization_members")
    .select("role, organization:organizations!inner(id, name)")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  throwIfError(error);
  return z
    .array(membershipSchema)
    .parse(data ?? [])
    .map((row) => ({ organizationId: row.organization.id, name: row.organization.name, role: row.role }));
}

/** The caller's membership in one organization, or null (RLS hides others). */
export async function getMembership(
  db: SupabaseClient,
  organizationId: string,
  userId: string,
): Promise<Membership | null> {
  const { data, error } = await db
    .from("organization_members")
    .select("role, organization:organizations!inner(id, name)")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .maybeSingle();
  throwIfError(error);
  if (!data) {
    return null;
  }
  const row = membershipSchema.parse(data);
  return { organizationId: row.organization.id, name: row.organization.name, role: row.role };
}

const memberSchema = z.object({
  user_id: uuidSchema,
  role: orgRoleSchema,
  created_at: z.string(),
  profile: z.object({ email: z.string(), full_name: z.string().nullable() }).nullable(),
});

export type Member = {
  userId: string;
  role: z.output<typeof orgRoleSchema>;
  email: string;
  fullName: string | null;
  joinedAt: string;
};

export async function listMembers(db: SupabaseClient, organizationId: string): Promise<Member[]> {
  const { data, error } = await db
    .from("organization_members")
    .select("user_id, role, created_at, profile:user_profiles(email, full_name)")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: true });
  throwIfError(error);
  return z
    .array(memberSchema)
    .parse(data ?? [])
    .map((row) => ({
      userId: row.user_id,
      role: row.role,
      email: row.profile?.email ?? "",
      fullName: row.profile?.full_name ?? null,
      joinedAt: row.created_at,
    }));
}

const invitationSchema = z.object({
  id: uuidSchema,
  email: z.string(),
  role: orgRoleSchema,
  created_at: z.string(),
  expires_at: z.string(),
});

export type PendingInvitation = z.output<typeof invitationSchema>;

/** Pending invitations for an organization. RLS returns rows to admins only. */
export async function listPendingInvitations(
  db: SupabaseClient,
  organizationId: string,
): Promise<PendingInvitation[]> {
  const { data, error } = await db
    .from("organization_invitations")
    .select("id, email, role, created_at, expires_at")
    .eq("organization_id", organizationId)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false });
  throwIfError(error);
  return z.array(invitationSchema).parse(data ?? []);
}

const myInvitationSchema = z.object({
  id: uuidSchema,
  organization_id: uuidSchema,
  organization_name: z.string(),
  role: orgRoleSchema,
  invited_by_name: z.string(),
  created_at: z.string(),
  expires_at: z.string(),
});

export type MyInvitation = z.output<typeof myInvitationSchema>;

/** Invitations addressed to the signed-in user's confirmed email. */
export function listMyInvitations(db: SupabaseClient): Promise<MyInvitation[]> {
  return callRpc(db, "list_my_invitations", {}, z.array(myInvitationSchema));
}

const profileSchema = z.object({ id: uuidSchema, email: z.string(), full_name: z.string().nullable() });

export type PersonDirectory = Map<string, { name: string; email: string }>;

/**
 * Names for user IDs the caller is allowed to see (themselves and colleagues).
 * IDs that are not visible, such as former members, are simply absent.
 */
export async function getPeople(db: SupabaseClient, userIds: readonly string[]): Promise<PersonDirectory> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) {
    return new Map();
  }
  const { data, error } = await db.from("user_profiles").select("id, email, full_name").in("id", ids);
  throwIfError(error);
  return new Map(
    z
      .array(profileSchema)
      .parse(data ?? [])
      .map((profile) => [profile.id, { name: profile.full_name ?? profile.email, email: profile.email }]),
  );
}

export function personName(people: PersonDirectory, userId: string | null | undefined): string {
  if (!userId) {
    return "—";
  }
  return people.get(userId)?.name ?? "Former member";
}

export function createOrganization(db: SupabaseClient, input: CreateOrganizationInput): Promise<string> {
  return callRpc(db, "create_organization", { p_name: input.name }, uuidSchema);
}

export function inviteMember(db: SupabaseClient, input: InviteMemberInput): Promise<string> {
  return callRpc(
    db,
    "invite_member",
    { p_organization_id: input.organizationId, p_email: input.email, p_role: input.role },
    uuidSchema,
  );
}

export async function revokeInvitation(db: SupabaseClient, invitationId: string): Promise<void> {
  await callRpc(db, "revoke_invitation", { p_invitation_id: invitationId }, z.null());
}

/** Returns the organization joined. */
export function acceptInvitation(db: SupabaseClient, invitationId: string): Promise<string> {
  return callRpc(db, "accept_invitation", { p_invitation_id: invitationId }, uuidSchema);
}

export async function changeMemberRole(db: SupabaseClient, input: ChangeMemberRoleInput): Promise<void> {
  await callRpc(
    db,
    "change_member_role",
    { p_organization_id: input.organizationId, p_user_id: input.userId, p_role: input.role },
    z.null(),
  );
}

export async function removeMember(db: SupabaseClient, input: RemoveMemberInput): Promise<void> {
  await callRpc(
    db,
    "remove_member",
    { p_organization_id: input.organizationId, p_user_id: input.userId },
    z.null(),
  );
}
