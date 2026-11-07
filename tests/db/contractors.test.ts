import { beforeAll, describe, expect, it } from "vitest";

import { createContractor, createTeam, ngnBankDetails, setNgnPayoutMethod, type Team } from "./fixtures";
import { createTestDatabase, expectDbError, type TestDatabase } from "./harness";

let db: TestDatabase;
let acme: Team;
let globex: Team;

beforeAll(async () => {
  db = await createTestDatabase();
  acme = await createTeam(db, "Acme");
  globex = await createTeam(db, "Globex");
});

const createSql = "select public.create_contractor($1, $2, $3, $4) as value";

describe("contractor roles", () => {
  it("lets admins and preparers create contractors", async () => {
    for (const user of [acme.admin, acme.preparer]) {
      const id = await db.value(user, createSql, [acme.organizationId, `By ${user.email}`, null, "NG"]);
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  it("does not let approvers or viewers create or change contractors", async () => {
    const contractorId = await createContractor(db, acme.preparer, acme.organizationId, "Role Check");
    for (const user of [acme.approver, acme.viewer]) {
      await expectDbError(
        db.value(user, createSql, [acme.organizationId, "Blocked", null, "NG"]),
        "not_authorized",
      );
      await expectDbError(
        db.value(user, "select public.update_contractor($1, 'Renamed', null, 'NG') as value", [
          contractorId,
        ]),
        "not_authorized",
      );
      await expectDbError(setNgnPayoutMethod(db, user, contractorId), "not_authorized");
    }
  });
});

describe("contractor ownership", () => {
  it("hides contractors from other organizations", async () => {
    const contractorId = await createContractor(db, acme.preparer, acme.organizationId, "Private");
    const seen = await db.rows(globex.admin, "select 1 from public.contractors where id = $1", [
      contractorId,
    ]);
    expect(seen).toHaveLength(0);
  });

  it("treats another organization's contractor as not found in every RPC", async () => {
    const contractorId = await createContractor(db, acme.preparer, acme.organizationId, "Target");
    await expectDbError(
      db.value(globex.admin, "select public.update_contractor($1, 'Stolen', null, 'NG') as value", [
        contractorId,
      ]),
      "not_found",
    );
    await expectDbError(setNgnPayoutMethod(db, globex.admin, contractorId), "not_found");
    await expectDbError(
      db.value(globex.admin, "select public.archive_contractor($1) as value", [contractorId]),
      "not_found",
    );
    await expectDbError(
      db.value(globex.admin, createSql, [acme.organizationId, "Planted", null, "NG"]),
      "not_found",
    );
  });

  it("rejects duplicate contractor emails within an organization", async () => {
    await db.value(acme.preparer, createSql, [acme.organizationId, "First", "dup@example.test", "NG"]);
    await expectDbError(
      db.value(acme.preparer, createSql, [acme.organizationId, "Second", "DUP@example.test", "NG"]),
      "conflict",
    );
    // The same email is fine in a different organization.
    await db.value(globex.preparer, createSql, [globex.organizationId, "Other", "dup@example.test", "NG"]);
  });
});

describe("contractor input validation", () => {
  it.each([
    ["a name that is too short", ["A", null, "NG"]],
    ["a country that is not ISO alpha-2", ["Valid Name", null, "Nigeria"]],
    ["a malformed email", ["Valid Name", "not-an-email", "NG"]],
  ])("rejects %s", async (_label, args) => {
    await expectDbError(
      db.value(acme.preparer, createSql, [acme.organizationId, ...args]),
      "invalid_input",
    );
  });
});

describe("payout methods", () => {
  const setSql =
    "select public.set_contractor_payout_method($1, $2::public.payout_rail, $3, $4::jsonb) as value";

  it("never lets application users read raw payout details", async () => {
    const contractorId = await createContractor(db, acme.preparer, acme.organizationId, "Masked");
    for (const user of [acme.admin, acme.preparer, acme.approver, acme.viewer]) {
      await expectDbError(
        db.rows(user, "select details from public.contractor_payout_methods where contractor_id = $1", [
          contractorId,
        ]),
        /permission denied/,
      );
    }
    const [method] = await db.rows<{ display_label: string }>(
      acme.viewer,
      "select display_label from public.contractor_payout_methods where contractor_id = $1",
      [contractorId],
    );
    expect(method?.display_label).toBe("NGN bank ****1234");
    expect(method?.display_label).not.toContain(ngnBankDetails.account_number);
  });

  it.each([
    ["a missing required field", "bank_transfer", "NGN", { bank_id: "X", account_number: "0000001234" }],
    ["an unexpected field", "bank_transfer", "NGN", { ...ngnBankDetails, note: "x" }],
    ["a non-string value", "bank_transfer", "NGN", { ...ngnBankDetails, account_number: 1234 }],
    ["an unsupported rail and currency", "mobile_money", "USD", { phone_number: "+15550000000" }],
  ])("rejects %s", async (_label, rail, currency, details) => {
    const contractorId = await createContractor(db, acme.preparer, acme.organizationId, "Validation");
    await expectDbError(
      db.value(acme.preparer, setSql, [contractorId, rail, currency, JSON.stringify(details)]),
      "invalid_input",
    );
  });

  it("keeps every version immutable and exactly one current", async () => {
    const contractorId = await createContractor(db, acme.preparer, acme.organizationId, "Versioned");
    await setNgnPayoutMethod(db, acme.preparer, contractorId, {
      ...ngnBankDetails,
      account_number: "0000005678",
    });

    const versions = await db.rows<{ version: number; is_current: boolean; display_label: string }>(
      acme.viewer,
      "select version, is_current, display_label from public.contractor_payout_methods where contractor_id = $1 order by version",
      [contractorId],
    );
    expect(versions).toEqual([
      { version: 1, is_current: false, display_label: "NGN bank ****1234" },
      { version: 2, is_current: true, display_label: "NGN bank ****5678" },
    ]);

    // The service role has no write access, and even the table owner cannot
    // rewrite, delete or truncate a stored version.
    await expectDbError(
      db.rows(
        "service_role",
        "update public.contractor_payout_methods set details = '{}'::jsonb where contractor_id = $1",
        [contractorId],
      ),
      /permission denied/,
    );
    await expectDbError(
      db.owner("update public.contractor_payout_methods set details = '{}'::jsonb where contractor_id = $1", [
        contractorId,
      ]),
      "immutable_record",
    );
    await expectDbError(
      db.owner("delete from public.contractor_payout_methods where contractor_id = $1", [contractorId]),
      "immutable_record",
    );
  });

  it("records payout changes in the audit log without the account data", async () => {
    const contractorId = await createContractor(db, acme.preparer, acme.organizationId, "Audited");
    const [entry] = await db.rows<{ details: Record<string, unknown> }>(
      acme.admin,
      "select details from public.audit_logs where action = 'payout_method.set' and entity_id = $1",
      [contractorId],
    );
    expect(entry?.details).toMatchObject({ rail: "bank_transfer", currency: "NGN", version: 1 });
    expect(JSON.stringify(entry?.details)).not.toContain(ngnBankDetails.account_number);
  });
});
