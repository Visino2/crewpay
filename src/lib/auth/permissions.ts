export const ORG_ROLES = ["admin", "preparer", "approver", "viewer"] as const;

export type OrgRole = (typeof ORG_ROLES)[number];

/**
 * Which roles may perform each kind of action. This mirrors the role checks
 * inside the database functions, which remain the authoritative control;
 * the server checks first so it can fail early with a clear error.
 */
export const PERMISSIONS = {
  manageMembers: ["admin"],
  prepare: ["admin", "preparer"],
  decide: ["admin", "approver"],
  readAudit: ["admin", "approver"],
  // History holds no raw payout details; every member can already read it,
  // including viewers such as an external accountant.
  exportHistory: ["admin", "preparer", "approver", "viewer"],
} as const satisfies Record<string, readonly OrgRole[]>;

export type Permission = keyof typeof PERMISSIONS;

export function roleCan(role: OrgRole, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly OrgRole[]).includes(role);
}
