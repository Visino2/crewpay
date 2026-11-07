import { beforeAll, describe, expect, it } from "vitest";

import { approve, createSubmittedRun, createTeam, type Team } from "./fixtures";
import { createTestDatabase, expectDbError, type TestDatabase } from "./harness";

let db: TestDatabase;
let acme: Team;

beforeAll(async () => {
  db = await createTestDatabase();
  acme = await createTeam(db, "Acme");
});

describe("audit trail", () => {
  it("records each sensitive step of a pay run with the acting user", async () => {
    const submission = await createSubmittedRun(db, acme);
    await approve(db, acme.approver, submission);

    const entries = await db.rows<{ action: string; actor_id: string }>(
      acme.admin,
      "select action, actor_id from public.audit_logs where entity_id = $1 order by id",
      [submission.payRunId],
    );
    expect(entries).toEqual([
      { action: "pay_run.created", actor_id: acme.preparer.id },
      { action: "pay_run.item_upserted", actor_id: acme.preparer.id },
      { action: "pay_run.submitted", actor_id: acme.preparer.id },
      { action: "pay_run.approved", actor_id: acme.approver.id },
    ]);
  });

  it("is append-only, even for the database owner", async () => {
    const [entry] = await db.owner<{ id: number }>("select id from public.audit_logs limit 1");
    await expectDbError(
      db.owner("update public.audit_logs set action = 'tampered.entry' where id = $1", [entry?.id]),
      "immutable_record",
    );
    await expectDbError(
      db.owner("delete from public.audit_logs where id = $1", [entry?.id]),
      "immutable_record",
    );
    await expectDbError(db.owner("truncate public.audit_logs"), "immutable_record");
  });

  it("is readable only by admins and approvers of the organization", async () => {
    const count = (user: typeof acme.admin) =>
      db.value<number>(user, "select count(*)::int as value from public.audit_logs");

    expect(await count(acme.admin)).toBeGreaterThan(0);
    expect(await count(acme.approver)).toBeGreaterThan(0);
    expect(await count(acme.preparer)).toBe(0);
    expect(await count(acme.viewer)).toBe(0);

    const outsider = await db.createUser("outsider");
    expect(await count(outsider)).toBe(0);
  });

  it("cannot be written directly by application users", async () => {
    await expectDbError(
      db.rows(
        acme.admin,
        "insert into public.audit_logs (organization_id, action, entity_type) values ($1, 'fake.entry', 'pay_run')",
        [acme.organizationId],
      ),
      /permission denied/,
    );
  });
});
