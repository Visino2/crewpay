import { beforeAll, describe, expect, it } from "vitest";

import {
  addMember,
  approve,
  createContractor,
  createDraftRun,
  createSubmittedRun,
  createTeam,
  ngnBankDetails,
  setNgnPayoutMethod,
  submitRun,
  type Team,
} from "./fixtures";
import { createTestDatabase, expectDbError, type TestDatabase } from "./harness";

let db: TestDatabase;
let acme: Team;
let globex: Team;

beforeAll(async () => {
  db = await createTestDatabase();
  acme = await createTeam(db, "Acme");
  globex = await createTeam(db, "Globex");
});

async function runStatus(payRunId: string): Promise<string> {
  return db.value(acme.admin, "select status::text as value from public.pay_runs where id = $1", [payRunId]);
}

describe("approval workflow", () => {
  it("lets a different approver approve the exact submitted snapshot", async () => {
    const submission = await createSubmittedRun(db, acme);
    expect(await runStatus(submission.payRunId)).toBe("pending_approval");

    const approvalId = await approve(db, acme.approver, submission);
    expect(approvalId).toMatch(/^[0-9a-f-]{36}$/);
    expect(await runStatus(submission.payRunId)).toBe("approved");

    const [approval] = await db.rows<{ decided_by: string; snapshot_hash: string; decision: string }>(
      acme.viewer,
      "select decided_by, snapshot_hash, decision::text from public.pay_run_approvals where id = $1",
      [approvalId],
    );
    expect(approval).toEqual({
      decided_by: acme.approver.id,
      snapshot_hash: submission.snapshotHash,
      decision: "approved",
    });
  });

  it("stores a snapshot with the amounts, masked payout details and totals", async () => {
    const submission = await createSubmittedRun(db, acme, "2500.50");
    const snapshot = await db.value<{
      items: Record<string, unknown>[];
      totals: Record<string, unknown>[];
    }>(acme.viewer, "select snapshot as value from public.pay_run_submissions where id = $1", [
      submission.submissionId,
    ]);
    expect(snapshot.items).toHaveLength(1);
    expect(snapshot.items[0]).toMatchObject({
      amount: "2500.50",
      currency: "NGN",
      payout_display: "NGN bank ****1234",
      payout_method_current: true,
    });
    expect(snapshot.items[0]).toMatchObject({ payout_method_version: 1 });
    expect(JSON.stringify(snapshot)).not.toContain(ngnBankDetails.account_number);
    expect(snapshot.totals).toEqual([{ currency: "NGN", amount: "2500.50", items: 1 }]);
  });

  it("requires a comment to reject, and the run can then be reopened", async () => {
    const submission = await createSubmittedRun(db, acme);
    const rejectSql = "select public.reject_pay_run($1, $2, $3, $4) as value";
    await expectDbError(
      db.value(acme.approver, rejectSql, [submission.payRunId, submission.submissionId, submission.snapshotHash, " "]),
      "invalid_input",
    );
    await db.value(acme.approver, rejectSql, [
      submission.payRunId,
      submission.submissionId,
      submission.snapshotHash,
      "Amount does not match the invoice",
    ]);
    expect(await runStatus(submission.payRunId)).toBe("rejected");

    await db.value(acme.preparer, "select public.reopen_pay_run($1) as value", [submission.payRunId]);
    expect(await runStatus(submission.payRunId)).toBe("draft");
  });
});

describe("separation of duties", () => {
  it("does not let the preparer approve their own pay run, even as an admin", async () => {
    const contractorId = await createContractor(db, acme.admin, acme.organizationId, "Own Run");
    const payRunId = await createDraftRun(db, acme.admin, acme.organizationId, [
      { contractorId, amount: "100.00" },
    ]);
    const submission = await submitRun(db, acme.admin, payRunId);
    await expectDbError(approve(db, acme.admin, submission), "self_approval_forbidden");
  });

  it("does not let anyone who edited the run approve it", async () => {
    const coAdmin = await addMember(db, acme.admin, acme.organizationId, "admin");
    const first = await createContractor(db, acme.preparer, acme.organizationId, "First Item");
    const second = await createContractor(db, acme.preparer, acme.organizationId, "Second Item");
    const payRunId = await createDraftRun(db, acme.preparer, acme.organizationId, [
      { contractorId: first, amount: "100.00" },
    ]);
    // The co-admin adds one line, then the preparer submits.
    await db.value(coAdmin, "select public.upsert_pay_run_item($1, $2, 50, null) as value", [payRunId, second]);
    const submission = await submitRun(db, acme.preparer, payRunId);

    await expectDbError(approve(db, coAdmin, submission), "self_approval_forbidden");
    await expect(approve(db, acme.approver, submission)).resolves.toBeTruthy();
  });

  it("does not let whoever entered a contractor's payout details approve a run paying them", async () => {
    const contractorId = await createContractor(db, acme.admin, acme.organizationId, "Admin Entered");
    const payRunId = await createDraftRun(db, acme.preparer, acme.organizationId, [
      { contractorId, amount: "75.00" },
    ]);
    const submission = await submitRun(db, acme.preparer, payRunId);
    await expectDbError(approve(db, acme.admin, submission), "self_approval_forbidden");
  });

  it("only lets admins and approvers decide, and only admins and preparers prepare", async () => {
    const submission = await createSubmittedRun(db, acme);
    for (const user of [acme.preparer, acme.viewer]) {
      await expectDbError(approve(db, user, submission), "not_authorized");
    }
    for (const user of [acme.approver, acme.viewer]) {
      await expectDbError(
        db.value(user, "select public.create_pay_run($1, 'Blocked', '2026-11-01', 'USD') as value", [
          acme.organizationId,
        ]),
        "not_authorized",
      );
    }
  });
});

describe("approval snapshot integrity", () => {
  it("rejects an approval that quotes a different snapshot hash", async () => {
    const submission = await createSubmittedRun(db, acme);
    await expectDbError(
      approve(db, acme.approver, { ...submission, snapshotHash: "0".repeat(64) }),
      "snapshot_mismatch",
    );
  });

  it("rejects approving an older submission after the run was withdrawn, edited and resubmitted", async () => {
    const original = await createSubmittedRun(db, acme, "100.00");
    await db.value(acme.preparer, "select public.withdraw_pay_run($1) as value", [original.payRunId]);
    await db.value(acme.preparer, "select public.upsert_pay_run_item($1, $2, 999999, null) as value", [
      original.payRunId,
      original.contractorId,
    ]);
    const resubmitted = await submitRun(db, acme.preparer, original.payRunId);

    await expectDbError(approve(db, acme.approver, original), "stale_submission");
    await expect(approve(db, acme.approver, resubmitted)).resolves.toBeTruthy();
  });

  it("returns pending and approved runs to draft when payout details change", async () => {
    const pending = await createSubmittedRun(db, acme);
    const approved = await createSubmittedRun(db, acme);
    await approve(db, acme.approver, approved);

    for (const run of [pending, approved]) {
      await setNgnPayoutMethod(db, acme.preparer, run.contractorId, {
        ...ngnBankDetails,
        account_number: "0000009999",
      });
      expect(await runStatus(run.payRunId)).toBe("draft");
    }

    await expectDbError(approve(db, acme.approver, pending), "invalid_state");
    // The draft still points at the old details, so it cannot be resubmitted
    // until the preparer re-saves the line with the current payout method.
    await expectDbError(submitRun(db, acme.preparer, pending.payRunId), "stale_payout_method");
    await db.value(acme.preparer, "select public.upsert_pay_run_item($1, $2, 150000, null) as value", [
      pending.payRunId,
      pending.contractorId,
    ]);
    await expect(submitRun(db, acme.preparer, pending.payRunId)).resolves.toBeTruthy();
  });

  it("detects changes made outside the RPCs before approving", async () => {
    const submission = await createSubmittedRun(db, acme);
    // A direct database edit by the owner, bypassing the RPCs and invalidation.
    await db.owner("update public.contractors set full_name = 'Someone Else' where id = $1", [
      submission.contractorId,
    ]);
    await expectDbError(approve(db, acme.approver, submission), "snapshot_mismatch");
  });

  it("freezes items once submitted, even for the table owner", async () => {
    const submission = await createSubmittedRun(db, acme);
    await expectDbError(
      db.owner("update public.pay_run_items set amount = 1 where pay_run_id = $1", [submission.payRunId]),
      "invalid_state",
    );
    await expectDbError(
      db.value(acme.preparer, "select public.upsert_pay_run_item($1, $2, 1, null) as value", [
        submission.payRunId,
        submission.contractorId,
      ]),
      "invalid_state",
    );
  });

  it("keeps submissions and approvals immutable", async () => {
    const submission = await createSubmittedRun(db, acme);
    const approvalId = await approve(db, acme.approver, submission);
    await expectDbError(
      db.owner("update public.pay_run_approvals set decision = 'rejected', comment = 'x' where id = $1", [
        approvalId,
      ]),
      "immutable_record",
    );
    await expectDbError(
      db.owner("update public.pay_run_submissions set snapshot_hash = $2 where id = $1", [
        submission.submissionId,
        "f".repeat(64),
      ]),
      "immutable_record",
    );
    await expectDbError(
      db.owner("delete from public.pay_run_submissions where id = $1", [submission.submissionId]),
      "immutable_record",
    );
  });
});

describe("pay run ownership and input", () => {
  it("does not let a pay run include another organization's contractor", async () => {
    const foreignContractor = await createContractor(db, globex.preparer, globex.organizationId, "Foreign");
    const payRunId = await createDraftRun(db, acme.preparer, acme.organizationId, []);
    await expectDbError(
      db.value(acme.preparer, "select public.upsert_pay_run_item($1, $2, 10, null) as value", [
        payRunId,
        foreignContractor,
      ]),
      "not_found",
    );

    // The composite foreign keys stop it even for the table owner.
    const [foreignMethod] = await db.owner<{ id: string }>(
      "select id from public.contractor_payout_methods where contractor_id = $1",
      [foreignContractor],
    );
    await expectDbError(
      db.owner(
        `insert into public.pay_run_items
           (organization_id, pay_run_id, contractor_id, payout_method_id, amount, currency, created_by, updated_by)
         values ($1, $2, $3, $4, 10, 'NGN', $5, $5)`,
        [acme.organizationId, payRunId, foreignContractor, foreignMethod?.id, acme.preparer.id],
      ),
      /foreign key/,
    );
  });

  it("hides another organization's pay runs and rejects actions on them", async () => {
    const submission = await createSubmittedRun(db, acme);
    const seen = await db.rows(globex.admin, "select 1 from public.pay_runs where id = $1", [submission.payRunId]);
    expect(seen).toHaveLength(0);
    await expectDbError(approve(db, globex.approver, submission), "not_found");
    await expectDbError(
      db.value(globex.preparer, "select public.withdraw_pay_run($1) as value", [submission.payRunId]),
      "not_found",
    );
  });

  it("hides another organization's items, submissions, approvals and payout methods", async () => {
    const submission = await createSubmittedRun(db, acme);
    await approve(db, acme.approver, submission);

    const checks: [string, string][] = [
      ["pay_run_items", "pay_run_id"],
      ["pay_run_submissions", "pay_run_id"],
      ["pay_run_approvals", "pay_run_id"],
    ];
    for (const user of [globex.admin, globex.approver, globex.viewer]) {
      for (const [table, column] of checks) {
        const rows = await db.rows(user, `select 1 from public.${table} where ${column} = $1`, [
          submission.payRunId,
        ]);
        expect(rows, `${table} visible across organizations`).toHaveLength(0);
      }
      const methods = await db.rows(
        user,
        "select 1 from public.contractor_payout_methods where contractor_id = $1",
        [submission.contractorId],
      );
      expect(methods, "payout methods visible across organizations").toHaveLength(0);
    }
  });

  it.each([["0"], ["-5"], ["10.001"], ["1000000001"]])("rejects the amount %s", async (amount) => {
    const contractorId = await createContractor(db, acme.preparer, acme.organizationId, "Amounts");
    const payRunId = await createDraftRun(db, acme.preparer, acme.organizationId, []);
    await expectDbError(
      db.value(acme.preparer, "select public.upsert_pay_run_item($1, $2, $3::numeric, null) as value", [
        payRunId,
        contractorId,
        amount,
      ]),
      "invalid_input",
    );
  });

  it("rejects submitting an empty run and a period that is not a month start", async () => {
    const payRunId = await createDraftRun(db, acme.preparer, acme.organizationId, []);
    await expectDbError(submitRun(db, acme.preparer, payRunId), "empty_pay_run");
    await expectDbError(
      db.value(acme.preparer, "select public.create_pay_run($1, 'Mid-month', '2026-11-15', 'USD') as value", [
        acme.organizationId,
      ]),
      "invalid_input",
    );
  });
});
