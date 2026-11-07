import { beforeAll, describe, expect, it } from "vitest";

import { addMember, createOrganization, createTeam, type Team } from "./fixtures";
import { createTestDatabase, expectDbError, type TestDatabase } from "./harness";

let db: TestDatabase;
let acme: Team;
let globex: Team;

beforeAll(async () => {
  db = await createTestDatabase();
  acme = await createTeam(db, "Acme");
  globex = await createTeam(db, "Globex");
});

describe("organizations", () => {
  it("makes the creator the only admin and records it in the audit log", async () => {
    const founder = await db.createUser("founder");
    const organizationId = await createOrganization(db, founder, "Founder Org");

    const members = await db.rows<{ user_id: string; role: string }>(
      founder,
      "select user_id, role from public.organization_members where organization_id = $1",
      [organizationId],
    );
    expect(members).toEqual([{ user_id: founder.id, role: "admin" }]);

    const audit = await db.rows<{ action: string; actor_id: string }>(
      founder,
      "select action, actor_id from public.audit_logs where organization_id = $1",
      [organizationId],
    );
    expect(audit).toEqual([{ action: "organization.created", actor_id: founder.id }]);
  });

  it("rejects invalid organization names", async () => {
    const user = await db.createUser("namer");
    await expectDbError(createOrganization(db, user, " "), "invalid_input");
    await expectDbError(createOrganization(db, user, "x".repeat(121)), "invalid_input");
  });
});

describe("tenant isolation", () => {
  it("hides other organizations and their members from every role", async () => {
    for (const user of [globex.admin, globex.preparer, globex.approver, globex.viewer]) {
      const orgs = await db.rows<{ id: string }>(user, "select id from public.organizations");
      expect(orgs.map((org) => org.id)).toEqual([globex.organizationId]);

      const foreignMembers = await db.rows(
        user,
        "select 1 from public.organization_members where organization_id = $1",
        [acme.organizationId],
      );
      expect(foreignMembers).toHaveLength(0);
    }
  });

  it("only shows profiles of the user and people who share an organization", async () => {
    const visible = await db.rows<{ id: string }>(acme.viewer, "select id from public.user_profiles");
    const ids = visible.map((profile) => profile.id).sort();
    expect(ids).toEqual(
      [acme.admin.id, acme.preparer.id, acme.approver.id, acme.viewer.id].sort(),
    );
  });

  it("treats another organization's ID as not found in every membership RPC", async () => {
    const outsider = globex.admin;
    await expectDbError(
      db.value(outsider, "select public.invite_member($1, $2, 'admin') as value", [
        acme.organizationId,
        "intruder@example.test",
      ]),
      "not_found",
    );
    await expectDbError(
      db.value(outsider, "select public.change_member_role($1, $2, 'viewer') as value", [
        acme.organizationId,
        acme.admin.id,
      ]),
      "not_found",
    );
    await expectDbError(
      db.value(outsider, "select public.remove_member($1, $2) as value", [
        acme.organizationId,
        acme.viewer.id,
      ]),
      "not_found",
    );
  });
});

describe("unauthorized access", () => {
  it("gives anonymous requests no table access and no RPCs", async () => {
    for (const table of ["organizations", "organization_members", "contractors", "pay_runs", "audit_logs"]) {
      await expectDbError(db.rows("anon", `select 1 from public.${table}`), /permission denied/);
    }
    await expectDbError(
      db.value("anon", "select public.create_organization('Anon Org') as value"),
      /permission denied/,
    );
  });

  it("blocks direct table writes by signed-in users", async () => {
    const intruder = globex.admin;
    await expectDbError(
      db.rows(
        intruder,
        "insert into public.organization_members (organization_id, user_id, role) values ($1, $2, 'admin')",
        [acme.organizationId, intruder.id],
      ),
      /permission denied/,
    );
    await expectDbError(
      db.rows(intruder, "update public.organizations set name = 'Hijacked' where id = $1", [
        globex.organizationId,
      ]),
      /permission denied/,
    );
    await expectDbError(
      db.rows(intruder, "delete from public.audit_logs where organization_id = $1", [
        globex.organizationId,
      ]),
      /permission denied/,
    );
  });

  it("does not expose internal helper functions", async () => {
    await expectDbError(
      db.rows(acme.admin, "select private.write_audit($1, 'fake.event', 'pay_run', null, '{}')", [
        acme.organizationId,
      ]),
      /permission denied/,
    );
  });
});

describe("membership and roles", () => {
  it("lets only admins invite members", async () => {
    for (const user of [acme.preparer, acme.approver, acme.viewer]) {
      await expectDbError(
        db.value(user, "select public.invite_member($1, $2, 'viewer') as value", [
          acme.organizationId,
          "someone@example.test",
        ]),
        "not_authorized",
      );
    }
  });

  it("only lets the invited person with a confirmed email accept an invitation", async () => {
    const invitee = await db.createUser("invitee", { confirmed: false });
    const invitationId = await db.value(
      acme.admin,
      "select public.invite_member($1, $2, 'viewer') as value",
      [acme.organizationId, invitee.email],
    );

    await expectDbError(
      db.value(globex.viewer, "select public.accept_invitation($1) as value", [invitationId]),
      "not_found",
    );
    await expectDbError(
      db.value(invitee, "select public.accept_invitation($1) as value", [invitationId]),
      "email_not_confirmed",
    );

    await db.owner("update auth.users set email_confirmed_at = now() where id = $1", [invitee.id]);
    await expect(
      db.value(invitee, "select public.accept_invitation($1) as value", [invitationId]),
    ).resolves.toBe(acme.organizationId);

    await expectDbError(
      db.value(invitee, "select public.accept_invitation($1) as value", [invitationId]),
      "invalid_state",
    );
  });

  it("rejects expired and revoked invitations", async () => {
    const late = await db.createUser("late");
    const expiredId = await db.value(
      acme.admin,
      "select public.invite_member($1, $2, 'viewer') as value",
      [acme.organizationId, late.email],
    );
    await db.owner(
      "update public.organization_invitations set created_at = now() - interval '8 days', expires_at = now() - interval '1 day' where id = $1",
      [expiredId],
    );
    await expectDbError(
      db.value(late, "select public.accept_invitation($1) as value", [expiredId]),
      "invalid_state",
    );

    const revokedUser = await db.createUser("revoked");
    const revokedId = await db.value(
      acme.admin,
      "select public.invite_member($1, $2, 'viewer') as value",
      [acme.organizationId, revokedUser.email],
    );
    await db.value(acme.admin, "select public.revoke_invitation($1) as value", [revokedId]);
    await expectDbError(
      db.value(revokedUser, "select public.accept_invitation($1) as value", [revokedId]),
      "invalid_state",
    );
  });

  it("refuses to demote or remove the last admin", async () => {
    const solo = await db.createUser("solo");
    const organizationId = await createOrganization(db, solo, "Solo Org");
    await expectDbError(
      db.value(solo, "select public.change_member_role($1, $2, 'viewer') as value", [
        organizationId,
        solo.id,
      ]),
      "last_admin",
    );
    await expectDbError(
      db.value(solo, "select public.remove_member($1, $2) as value", [organizationId, solo.id]),
      "last_admin",
    );

    const second = await addMember(db, solo, organizationId, "admin");
    await db.value(solo, "select public.change_member_role($1, $2, 'viewer') as value", [
      organizationId,
      solo.id,
    ]);
    const roles = await db.rows<{ user_id: string; role: string }>(
      second,
      "select user_id, role from public.organization_members where organization_id = $1 order by role",
      [organizationId],
    );
    expect(roles).toEqual(
      expect.arrayContaining([
        { user_id: second.id, role: "admin" },
        { user_id: solo.id, role: "viewer" },
      ]),
    );
  });

  it("records role changes with before and after values", async () => {
    const member = await addMember(db, acme.admin, acme.organizationId, "viewer");
    await db.value(acme.admin, "select public.change_member_role($1, $2, 'preparer') as value", [
      acme.organizationId,
      member.id,
    ]);
    const [entry] = await db.rows<{ actor_id: string; details: Record<string, string> }>(
      acme.admin,
      "select actor_id, details from public.audit_logs where action = 'member.role_changed' and entity_id = $1",
      [member.id],
    );
    expect(entry).toEqual({
      actor_id: acme.admin.id,
      details: { previous_role: "viewer", role: "preparer" },
    });
  });
});
