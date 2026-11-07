"use server";

import { runAction, type ActionResult } from "@/lib/actions";
import { getOwningOrganization, requirePermission } from "@/lib/auth/authorization";
import {
  changeMemberRoleSchema,
  createOrganizationSchema,
  invitationIdSchema,
  inviteMemberSchema,
  removeMemberSchema,
} from "@/lib/validation/organizations";

import {
  acceptInvitation,
  changeMemberRole,
  createOrganization,
  inviteMember,
  removeMember,
  revokeInvitation,
} from "./data";

export async function createOrganizationAction(input: unknown): Promise<ActionResult<string>> {
  return runAction(createOrganizationSchema, input, ({ name }, { db }) => createOrganization(db, { name }));
}

export async function inviteMemberAction(input: unknown): Promise<ActionResult<string>> {
  return runAction(inviteMemberSchema, input, async (data, { db, user }) => {
    await requirePermission(db, user, data.organizationId, "manageMembers");
    return inviteMember(db, data);
  });
}

export async function revokeInvitationAction(input: unknown): Promise<ActionResult<null>> {
  return runAction(invitationIdSchema, input, async ({ invitationId }, { db, user }) => {
    const organizationId = await getOwningOrganization(db, "organization_invitations", invitationId);
    await requirePermission(db, user, organizationId, "manageMembers");
    await revokeInvitation(db, invitationId);
    return null;
  });
}

/** Membership is the result, so no role check: the database verifies the invitee's confirmed email. */
export async function acceptInvitationAction(input: unknown): Promise<ActionResult<string>> {
  return runAction(invitationIdSchema, input, ({ invitationId }, { db }) => acceptInvitation(db, invitationId));
}

export async function changeMemberRoleAction(input: unknown): Promise<ActionResult<null>> {
  return runAction(changeMemberRoleSchema, input, async (data, { db, user }) => {
    await requirePermission(db, user, data.organizationId, "manageMembers");
    await changeMemberRole(db, data);
    return null;
  });
}

export async function removeMemberAction(input: unknown): Promise<ActionResult<null>> {
  return runAction(removeMemberSchema, input, async (data, { db, user }) => {
    await requirePermission(db, user, data.organizationId, "manageMembers");
    await removeMember(db, data);
    return null;
  });
}
