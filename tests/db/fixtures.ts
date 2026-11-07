import type { TestDatabase, TestUser } from "./harness";

/** Test values only; shaped like Blaaiz NGN bank-transfer fields. */
export const ngnBankDetails = {
  bank_id: "TESTBANK",
  account_number: "0000001234",
  account_name: "Test Contractor",
};

export type OrgRole = "admin" | "preparer" | "approver" | "viewer";

export async function createOrganization(
  db: TestDatabase,
  admin: TestUser,
  name = "Test Org",
): Promise<string> {
  return db.value(admin, "select public.create_organization($1) as value", [name]);
}

/** Creates a user, invites them as `role` and has them accept. */
export async function addMember(
  db: TestDatabase,
  admin: TestUser,
  organizationId: string,
  role: OrgRole,
): Promise<TestUser> {
  const user = await db.createUser(role);
  const invitationId = await db.value(
    admin,
    "select public.invite_member($1, $2, $3::public.org_role) as value",
    [organizationId, user.email, role],
  );
  await db.value(user, "select public.accept_invitation($1) as value", [invitationId]);
  return user;
}

export type Team = {
  organizationId: string;
  admin: TestUser;
  preparer: TestUser;
  approver: TestUser;
  viewer: TestUser;
};

export async function createTeam(db: TestDatabase, name = "Test Org"): Promise<Team> {
  const admin = await db.createUser("admin");
  const organizationId = await createOrganization(db, admin, name);
  return {
    organizationId,
    admin,
    preparer: await addMember(db, admin, organizationId, "preparer"),
    approver: await addMember(db, admin, organizationId, "approver"),
    viewer: await addMember(db, admin, organizationId, "viewer"),
  };
}

export async function createContractor(
  db: TestDatabase,
  actor: TestUser,
  organizationId: string,
  fullName = "Test Contractor",
): Promise<string> {
  const contractorId = await db.value(
    actor,
    "select public.create_contractor($1, $2, $3, $4) as value",
    [organizationId, fullName, null, "NG"],
  );
  await setNgnPayoutMethod(db, actor, contractorId);
  return contractorId;
}

export async function setNgnPayoutMethod(
  db: TestDatabase,
  actor: TestUser,
  contractorId: string,
  details: Record<string, string> = ngnBankDetails,
): Promise<string> {
  return db.value(
    actor,
    "select public.set_contractor_payout_method($1, 'bank_transfer', 'NGN', $2::jsonb) as value",
    [contractorId, JSON.stringify(details)],
  );
}

export async function createDraftRun(
  db: TestDatabase,
  actor: TestUser,
  organizationId: string,
  items: { contractorId: string; amount: string }[],
): Promise<string> {
  const payRunId = await db.value(
    actor,
    "select public.create_pay_run($1, $2, $3::date, $4) as value",
    [organizationId, "November contractors", "2026-11-01", "USD"],
  );
  for (const item of items) {
    await db.value(
      actor,
      "select public.upsert_pay_run_item($1, $2, $3::numeric, $4) as value",
      [payRunId, item.contractorId, item.amount, null],
    );
  }
  return payRunId;
}

export type Submission = { payRunId: string; submissionId: string; snapshotHash: string };

export async function submitRun(
  db: TestDatabase,
  actor: TestUser,
  payRunId: string,
): Promise<Submission> {
  const submissionId = await db.value(actor, "select public.submit_pay_run($1) as value", [
    payRunId,
  ]);
  const snapshotHash = await db.value(
    actor,
    "select snapshot_hash as value from public.pay_run_submissions where id = $1",
    [submissionId],
  );
  return { payRunId, submissionId, snapshotHash };
}

export async function createSubmittedRun(
  db: TestDatabase,
  team: Team,
  amount = "150000.00",
): Promise<Submission & { contractorId: string }> {
  const contractorId = await createContractor(db, team.preparer, team.organizationId);
  const payRunId = await createDraftRun(db, team.preparer, team.organizationId, [
    { contractorId, amount },
  ]);
  return { ...(await submitRun(db, team.preparer, payRunId)), contractorId };
}

export function approve(db: TestDatabase, actor: TestUser, submission: Submission) {
  return db.value(actor, "select public.approve_pay_run($1, $2, $3) as value", [
    submission.payRunId,
    submission.submissionId,
    submission.snapshotHash,
  ]);
}
