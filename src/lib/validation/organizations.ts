import { z } from "zod";

import { emailSchema, orgRoleSchema, uuidSchema } from "./common";

export const createOrganizationSchema = z.object({
  name: z.string().trim().min(2).max(120),
});

export const inviteMemberSchema = z.object({
  organizationId: uuidSchema,
  email: emailSchema,
  role: orgRoleSchema,
});

export const invitationIdSchema = z.object({
  invitationId: uuidSchema,
});

export const changeMemberRoleSchema = z.object({
  organizationId: uuidSchema,
  userId: uuidSchema,
  role: orgRoleSchema,
});

export const removeMemberSchema = z.object({
  organizationId: uuidSchema,
  userId: uuidSchema,
});

export type CreateOrganizationInput = z.output<typeof createOrganizationSchema>;
export type InviteMemberInput = z.output<typeof inviteMemberSchema>;
export type ChangeMemberRoleInput = z.output<typeof changeMemberRoleSchema>;
export type RemoveMemberInput = z.output<typeof removeMemberSchema>;
