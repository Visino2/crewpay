import { beforeAll, describe, expect, it } from "vitest";

import { approve, createSubmittedRun, createTeam, type Team } from "./fixtures";
import { createTestDatabase, expectDbError, type TestDatabase } from "./harness";

let db: TestDatabase;
let acme: Team;

beforeAll(async () => {
  db = await createTestDatabase();
  acme = await createTeam(db, "Acme");
});

describe("privileges", () => {
  it("leaves anon and service_role with no table privileges, and authenticated with SELECT only", async () => {
    const grants = await db.owner<{ grantee: string; table_name: string; privilege_type: string }>(
      `select grantee, table_name, privilege_type
       from information_schema.role_table_grants
       where table_schema = 'public' and grantee in ('anon', 'authenticated', 'service_role')
       order by 1, 2, 3`,
    );
    expect(grants.filter((grant) => grant.grantee !== "authenticated")).toEqual([]);
    expect(new Set(grants.map((grant) => grant.privilege_type))).toEqual(new Set(["SELECT"]));
    // Raw payout details are excluded through column-level grants.
    expect(grants.map((grant) => grant.table_name)).not.toContain("contractor_payout_methods");
  });

  it("only lets signed-in users execute the public RPCs and four RLS helpers", async () => {
    const callable = await db.owner<{ fn: string; anon: boolean; service: boolean }>(
      `select n.nspname || '.' || p.proname as fn,
              has_function_privilege('anon', p.oid, 'execute') as anon,
              has_function_privilege('service_role', p.oid, 'execute') as service
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('public', 'private')`,
    );
    expect(callable.filter((row) => row.anon || row.service)).toEqual([]);

    const privateForUsers = await db.owner<{ fn: string }>(
      `select p.proname as fn from pg_proc p
       where p.pronamespace = 'private'::regnamespace
         and has_function_privilege('authenticated', p.oid, 'execute')
       order by 1`,
    );
    expect(privateForUsers.map((row) => row.fn)).toEqual([
      "confirmed_email",
      "has_org_role",
      "is_org_member",
      "shares_org_with",
    ]);
  });

  // Every public RPC acts for the signed-in user (auth.uid()); none is meant
  // for the secret key. Arguments only need to type-check: the privilege
  // check runs before the function body.
  const id = "00000000-0000-0000-0000-000000000000";
  const userSessionRpcs: [string, string][] = [
    ["create_organization", "select public.create_organization('X Org')"],
    ["invite_member", `select public.invite_member('${id}', 'a@example.test', 'viewer')`],
    ["revoke_invitation", `select public.revoke_invitation('${id}')`],
    ["accept_invitation", `select public.accept_invitation('${id}')`],
    ["change_member_role", `select public.change_member_role('${id}', '${id}', 'viewer')`],
    ["remove_member", `select public.remove_member('${id}', '${id}')`],
    ["create_contractor", `select public.create_contractor('${id}', 'Name', null, 'NG')`],
    ["update_contractor", `select public.update_contractor('${id}', 'Name', null, 'NG')`],
    ["archive_contractor", `select public.archive_contractor('${id}')`],
    ["set_contractor_payout_method", `select public.set_contractor_payout_method('${id}', 'bank_transfer', 'NGN', '{}')`],
    ["create_pay_run", `select public.create_pay_run('${id}', 'Run', '2026-11-01', 'USD')`],
    ["upsert_pay_run_item", `select public.upsert_pay_run_item('${id}', '${id}', 1, null)`],
    ["remove_pay_run_item", `select public.remove_pay_run_item('${id}')`],
    ["submit_pay_run", `select public.submit_pay_run('${id}')`],
    ["withdraw_pay_run", `select public.withdraw_pay_run('${id}')`],
    ["reopen_pay_run", `select public.reopen_pay_run('${id}')`],
    ["cancel_pay_run", `select public.cancel_pay_run('${id}')`],
    ["approve_pay_run", `select public.approve_pay_run('${id}', '${id}', 'x')`],
    ["reject_pay_run", `select public.reject_pay_run('${id}', '${id}', 'x', 'why')`],
    ["list_my_invitations", "select * from public.list_my_invitations()"],
  ];

  it.each(userSessionRpcs)("refuses service_role EXECUTE on %s", async (_name, sql) => {
    await expectDbError(db.rows("service_role", sql), /permission denied for function/);
  });

  it("grants every public RPC to authenticated only, with SECURITY DEFINER and a fixed search_path", async () => {
    const fns = await db.owner<{
      fn: string;
      security_definer: boolean;
      config: string[] | null;
      anon: boolean;
      service_role: boolean;
      authenticated: boolean;
      public_role: boolean;
    }>(
      `select p.proname as fn,
              p.prosecdef as security_definer,
              p.proconfig as config,
              has_function_privilege('anon', p.oid, 'execute') as anon,
              has_function_privilege('service_role', p.oid, 'execute') as service_role,
              has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
              exists (
                select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                where a.grantee = 0 and a.privilege_type = 'EXECUTE'
              ) as public_role
       from pg_proc p
       where p.pronamespace = 'public'::regnamespace
       order by 1`,
    );
    expect(fns.map((fn) => fn.fn)).toEqual(userSessionRpcs.map(([name]) => name).sort());
    for (const fn of fns) {
      expect(fn, fn.fn).toEqual({
        fn: fn.fn,
        security_definer: true,
        config: ['search_path=""'],
        anon: false,
        service_role: false,
        authenticated: true,
        public_role: false,
      });
    }
  });

  it("denies the service role TRUNCATE and writes on every table", async () => {
    for (const table of ["pay_run_approvals", "pay_run_submissions", "pay_run_items", "contractor_payout_methods", "audit_logs"]) {
      await expectDbError(db.rows("service_role", `truncate public.${table} cascade`), /permission denied/);
    }
    await expectDbError(
      db.rows("service_role", "update public.pay_runs set status = 'approved'"),
      /permission denied/,
    );
  });
});

describe("payout detail exposure", () => {
  it("keeps every value derived from raw payout details out of snapshots", async () => {
    const submission = await createSubmittedRun(db, acme);
    const [snapshot] = await db.rows<{ snapshot: { items: Record<string, unknown>[] } }>(
      acme.viewer,
      "select snapshot from public.pay_run_submissions where id = $1",
      [submission.submissionId],
    );
    const itemKeys = Object.keys(snapshot!.snapshot.items[0]!);
    expect(itemKeys).not.toContain("payout_details_sha256");
    // Only the masked label and the immutable version reference describe the payout method.
    expect(itemKeys.filter((key) => key.startsWith("payout_")).sort()).toEqual([
      "payout_display",
      "payout_method_current",
      "payout_method_id",
      "payout_method_version",
    ]);
  });
});

describe("TRUNCATE protection", () => {
  it.each(["pay_run_approvals", "pay_run_submissions", "pay_run_items", "contractor_payout_methods", "audit_logs"])(
    "blocks truncating %s even for the table owner",
    async (table) => {
      await createSubmittedRun(db, acme);
      await expectDbError(db.owner(`truncate public.${table} cascade`), "immutable_record");
    },
  );
});

describe("approval integrity for any writer", () => {
  it("requires an approval to reference a submission of the same pay run", async () => {
    const first = await createSubmittedRun(db, acme);
    const second = await createSubmittedRun(db, acme);
    await expectDbError(
      db.owner(
        `insert into public.pay_run_approvals
           (organization_id, pay_run_id, submission_id, snapshot_hash, decision, decided_by)
         values ($1, $2, $3, $4, 'approved', $5)`,
        [acme.organizationId, first.payRunId, second.submissionId, second.snapshotHash, acme.approver.id],
      ),
      /foreign key|stale_submission|not_authorized/,
    );
  });

  it("only records approvals and submissions for the authenticated user they name", async () => {
    const submission = await createSubmittedRun(db, acme);
    // The owner has no auth.uid(), so it cannot record a decision in someone's name.
    await expectDbError(
      db.owner(
        `insert into public.pay_run_approvals
           (organization_id, pay_run_id, submission_id, snapshot_hash, decision, decided_by)
         values ($1, $2, $3, $4, 'approved', $5)`,
        [acme.organizationId, submission.payRunId, submission.submissionId, submission.snapshotHash, acme.approver.id],
      ),
      "decider_must_be_caller",
    );
  });

  it("does not let a pay run become approved without a recorded decision", async () => {
    const submission = await createSubmittedRun(db, acme);
    await expectDbError(
      db.owner("update public.pay_runs set status = 'approved' where id = $1", [submission.payRunId]),
      "decision_required",
    );
  });

  it("does not let a pay run be created already approved", async () => {
    await expectDbError(
      db.owner(
        `insert into public.pay_runs (organization_id, title, period_month, funding_currency, status, created_by)
         values ($1, 'Forged', '2026-11-01', 'USD', 'approved', $2)`,
        [acme.organizationId, acme.preparer.id],
      ),
      "new_pay_run_must_be_draft",
    );
  });

  it("only allows workflow status transitions", async () => {
    const submission = await createSubmittedRun(db, acme);
    await approve(db, acme.approver, submission);
    await expectDbError(
      db.owner("update public.pay_runs set status = 'cancelled' where id = $1", [submission.payRunId]),
      "invalid_status_transition",
    );
    await expectDbError(
      db.owner("update public.pay_runs set status = 'draft' where id = $1", [submission.payRunId]),
      "version_not_incremented",
    );
    await expectDbError(
      db.owner("update public.pay_runs set title = 'Changed after approval' where id = $1", [submission.payRunId]),
      "pay_run_not_draft",
    );
  });

  it("keeps the normal approve, reject, withdraw and cancel paths working", async () => {
    const approved = await createSubmittedRun(db, acme);
    await expect(approve(db, acme.approver, approved)).resolves.toBeTruthy();

    const withdrawn = await createSubmittedRun(db, acme);
    await db.value(acme.preparer, "select public.withdraw_pay_run($1) as value", [withdrawn.payRunId]);
    await db.value(acme.preparer, "select public.cancel_pay_run($1) as value", [withdrawn.payRunId]);
    const status = await db.value(acme.admin, "select status::text as value from public.pay_runs where id = $1", [
      withdrawn.payRunId,
    ]);
    expect(status).toBe("cancelled");
  });
});
