import { beforeAll, describe, expect, it } from "vitest";

import { createOrganization, createTeam, type OrgRole, type Team } from "./fixtures";
import { createTestDatabase, expectDbError, type Actor, type TestDatabase } from "./harness";

let db: TestDatabase;
let acme: Team;

beforeAll(async () => {
  db = await createTestDatabase();
  acme = await createTeam(db, "Acme");
});

const listSql = "select * from public.list_my_invitations()";

describe("list_my_invitations", () => {
  it("shows the invitee the organization and inviter, and nothing to anyone else", async () => {
    const invitee = await db.createUser("invitee");
    await db.value(acme.admin, "select public.invite_member($1, $2, 'approver') as value", [
      acme.organizationId,
      invitee.email,
    ]);

    const mine = await db.rows<{ organization_name: string; role: string; invited_by_name: string }>(
      invitee,
      listSql,
    );
    expect(mine).toEqual([
      expect.objectContaining({ organization_name: "Acme", role: "approver", invited_by_name: acme.admin.email }),
    ]);

    const someoneElse = await db.createUser("bystander");
    expect(await db.rows(someoneElse, listSql)).toEqual([]);
    // Members of the inviting organization do not see it through this function either.
    expect(await db.rows(acme.viewer, listSql)).toEqual([]);
  });

  it("hides invitations until the email is confirmed, and after acceptance", async () => {
    const unconfirmed = await db.createUser("unconfirmed", { confirmed: false });
    const invitationId = await db.value(acme.admin, "select public.invite_member($1, $2, 'viewer') as value", [
      acme.organizationId,
      unconfirmed.email,
    ]);
    expect(await db.rows(unconfirmed, listSql)).toEqual([]);

    await db.owner("update auth.users set email_confirmed_at = now() where id = $1", [unconfirmed.id]);
    expect(await db.rows(unconfirmed, listSql)).toHaveLength(1);

    await db.value(unconfirmed, "select public.accept_invitation($1) as value", [invitationId]);
    expect(await db.rows(unconfirmed, listSql)).toEqual([]);
  });

  it("is not available to anonymous requests", async () => {
    await expectDbError(db.rows("anon", listSql), /permission denied/);
  });
});

describe("invite_member after an invitation expires", () => {
  const inviteSql = "select public.invite_member($1, $2, $3::public.org_role) as value";

  type InvitationRow = { id: string; role: string; accepted_at: Date | null; revoked_at: Date | null };
  type AuditRow = { action: string; entity_id: string; actor_id: string; details: Record<string, unknown> };

  function invite(actor: Actor, email: string, role: OrgRole | null = "viewer"): Promise<string> {
    return db.value(actor, inviteSql, [acme.organizationId, email, role]);
  }

  async function expire(invitationId: string): Promise<void> {
    await db.owner(
      `update public.organization_invitations
       set created_at = now() - interval '8 days', expires_at = now() - interval '1 day'
       where id = $1`,
      [invitationId],
    );
  }

  function invitationsFor(email: string): Promise<InvitationRow[]> {
    return db.owner<InvitationRow>(
      `select id, role::text as role, accepted_at, revoked_at
       from public.organization_invitations
       where organization_id = $1 and email = $2
       order by created_at, id`,
      [acme.organizationId, email],
    );
  }

  function auditFor(email: string): Promise<AuditRow[]> {
    return db.rows<AuditRow>(
      acme.admin,
      `select action, entity_id, actor_id, details
       from public.audit_logs
       where organization_id = $1 and entity_type = 'invitation' and details ->> 'email' = $2
       order by id`,
      [acme.organizationId, email],
    );
  }

  it("lets an admin re-invite an email whose previous invitation expired unanswered", async () => {
    const invitee = await db.createUser("lapsed");
    const expiredId = await invite(acme.admin, invitee.email, "viewer");
    await expire(expiredId);

    const newId = await invite(acme.admin, invitee.email, "approver");
    expect(newId).not.toBe(expiredId);

    const [expired, current] = await invitationsFor(invitee.email);
    expect(expired).toMatchObject({ id: expiredId, role: "viewer", accepted_at: null });
    expect(expired!.revoked_at).toBeInstanceOf(Date);
    expect(current).toMatchObject({ id: newId, role: "approver", accepted_at: null, revoked_at: null });

    // The invitee sees and can accept only the new invitation.
    expect(await db.rows<{ id: string }>(invitee, listSql)).toEqual([expect.objectContaining({ id: newId })]);
    await expectDbError(db.value(invitee, "select public.accept_invitation($1) as value", [expiredId]), "invalid_state");
    await expect(db.value(invitee, "select public.accept_invitation($1) as value", [newId])).resolves.toBe(
      acme.organizationId,
    );
  });

  it("writes an audit entry for each automatic revocation, before the new invitation's entry", async () => {
    const invitee = await db.createUser("audited");
    const expiredId = await invite(acme.admin, invitee.email, "viewer");
    await expire(expiredId);
    const newId = await invite(acme.admin, invitee.email, "preparer");

    expect(await auditFor(invitee.email)).toEqual([
      expect.objectContaining({ action: "member.invited", entity_id: expiredId }),
      {
        action: "invitation.revoked",
        entity_id: expiredId,
        actor_id: acme.admin.id,
        details: { email: invitee.email, role: "viewer", reason: "expired", expired_at: expect.any(String) },
      },
      expect.objectContaining({ action: "member.invited", entity_id: newId, actor_id: acme.admin.id }),
    ]);
  });

  it("still refuses a duplicate while the earlier invitation is active, and revokes nothing", async () => {
    const invitee = await db.createUser("pending");
    const activeId = await invite(acme.admin, invitee.email);

    // Same address after normalization.
    await expectDbError(invite(acme.admin, `  ${invitee.email.toUpperCase()} `), "invitation_pending");

    // An invitation one minute from expiry is still active.
    await db.owner(
      "update public.organization_invitations set expires_at = now() + interval '1 minute' where id = $1",
      [activeId],
    );
    await expectDbError(invite(acme.admin, invitee.email, "admin"), "invitation_pending");

    expect(await invitationsFor(invitee.email)).toEqual([
      expect.objectContaining({ id: activeId, revoked_at: null }),
    ]);
    expect((await auditFor(invitee.email)).map((entry) => entry.action)).toEqual(["member.invited"]);
  });

  it("does not let unauthorized or invalid requests revoke an expired invitation", async () => {
    const invitee = await db.createUser("guarded");
    const expiredId = await invite(acme.admin, invitee.email);
    await expire(expiredId);

    for (const member of [acme.preparer, acme.approver, acme.viewer]) {
      await expectDbError(invite(member, invitee.email), "not_authorized");
    }
    const otherAdmin = await db.createUser("other-admin");
    await createOrganization(db, otherAdmin, "Globex");
    await expectDbError(invite(otherAdmin, invitee.email), "not_found");
    const noOrgUser = await db.createUser("no-org");
    await expectDbError(invite(noOrgUser, invitee.email), "not_found");
    await expectDbError(invite("anon", invitee.email), /permission denied/);
    await expectDbError(invite("service_role", invitee.email), /permission denied/);

    // Validation also runs before anything is revoked.
    await expectDbError(invite(acme.admin, invitee.email, null), "invalid_input");

    expect(await invitationsFor(invitee.email)).toEqual([
      expect.objectContaining({ id: expiredId, revoked_at: null }),
    ]);
    expect((await auditFor(invitee.email)).map((entry) => entry.action)).toEqual(["member.invited"]);
  });

  it("keeps a fixed search_path and lets only signed-in users execute it", async () => {
    const [fn] = await db.owner<{
      security_definer: boolean;
      config: string[];
      anon: boolean;
      service_role: boolean;
      authenticated: boolean;
      public_role: boolean;
    }>(
      `select p.prosecdef as security_definer,
              p.proconfig as config,
              has_function_privilege('anon', p.oid, 'execute') as anon,
              has_function_privilege('service_role', p.oid, 'execute') as service_role,
              has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
              exists (
                select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                where a.grantee = 0 and a.privilege_type = 'EXECUTE'
              ) as public_role
       from pg_proc p
       where p.oid = 'public.invite_member(uuid, text, public.org_role)'::regprocedure`,
    );
    expect(fn).toEqual({
      security_definer: true,
      config: ['search_path=""'],
      anon: false,
      service_role: false,
      authenticated: true,
      public_role: false,
    });
  });
});
