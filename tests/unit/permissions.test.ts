import { describe, expect, it } from "vitest";

import { ORG_ROLES, roleCan, type OrgRole, type Permission } from "@/lib/auth/permissions";

// Must stay in step with the role arrays in supabase/migrations, which the
// database tests exercise directly.
const expected: Record<Permission, OrgRole[]> = {
  manageMembers: ["admin"],
  prepare: ["admin", "preparer"],
  decide: ["admin", "approver"],
  readAudit: ["admin", "approver"],
  exportHistory: ["admin", "preparer", "approver", "viewer"],
};

describe("role permissions", () => {
  for (const [permission, allowed] of Object.entries(expected) as [Permission, OrgRole[]][]) {
    it(`${permission} is limited to ${allowed.join(", ")}`, () => {
      for (const role of ORG_ROLES) {
        expect(roleCan(role, permission)).toBe(allowed.includes(role));
      }
    });
  }

  it("never lets one role both prepare and decide except admin", () => {
    const both = ORG_ROLES.filter((role) => roleCan(role, "prepare") && roleCan(role, "decide"));
    // Admins can do both, so the database also forbids approving a run you touched.
    expect(both).toEqual(["admin"]);
  });
});
