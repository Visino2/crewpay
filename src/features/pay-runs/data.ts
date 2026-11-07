import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { totalsByCurrency, type CurrencyTotal } from "@/lib/money";
import { callRpc, throwIfError } from "@/lib/supabase/rpc";
import { uuidSchema } from "@/lib/validation/common";
import type {
  ApprovePayRunInput,
  CreatePayRunInput,
  RejectPayRunInput,
  UpsertPayRunItemInput,
} from "@/lib/validation/pay-runs";

export const payRunStatusSchema = z.enum(["draft", "pending_approval", "approved", "rejected", "cancelled"]);
export type PayRunStatus = z.output<typeof payRunStatusSchema>;

const payRunSchema = z.object({
  id: uuidSchema,
  organization_id: uuidSchema,
  title: z.string(),
  period_month: z.string(),
  funding_currency: z.string(),
  status: payRunStatusSchema,
  version: z.number().int(),
  created_by: uuidSchema,
  created_at: z.string(),
  updated_at: z.string(),
});

const submissionMetaSchema = z.object({
  id: uuidSchema,
  pay_run_version: z.number().int(),
  snapshot_hash: z.string(),
  item_count: z.number().int(),
  submitted_by: uuidSchema,
  submitted_at: z.string(),
  superseded_at: z.string().nullable(),
});

const decisionSchema = z.object({
  id: uuidSchema,
  submission_id: uuidSchema,
  decision: z.enum(["approved", "rejected"]),
  decided_by: uuidSchema,
  decided_at: z.string(),
  comment: z.string().nullable(),
});

export type PayRun = z.output<typeof payRunSchema>;
export type SubmissionMeta = z.output<typeof submissionMetaSchema>;
export type Decision = z.output<typeof decisionSchema>;

const PAY_RUN_COLUMNS =
  "id, organization_id, title, period_month, funding_currency, status, version, created_by, created_at, updated_at";
const SUBMISSION_META_COLUMNS = "id, pay_run_version, snapshot_hash, item_count, submitted_by, submitted_at, superseded_at";
const DECISION_COLUMNS = "id, submission_id, decision, decided_by, decided_at, comment";

// ---------------------------------------------------------------------------
// Summaries (lists, dashboard, history)
// ---------------------------------------------------------------------------

const summaryRowSchema = payRunSchema.extend({
  items: z.array(z.object({ amount: z.string(), currency: z.string() })),
  submissions: z.array(submissionMetaSchema),
  decisions: z.array(decisionSchema),
});

export type PayRunSummary = PayRun & {
  itemCount: number;
  totals: CurrencyTotal[];
  activeSubmission: SubmissionMeta | null;
  lastSubmission: SubmissionMeta | null;
  lastDecision: Decision | null;
  allSubmissions: SubmissionMeta[];
  allDecisions: Decision[];
};

function latest<T>(rows: readonly T[], key: (row: T) => string): T | null {
  return rows.reduce<T | null>((best, row) => (best === null || key(row) > key(best) ? row : best), null);
}

/** Pay runs with line totals and their full submission and decision history. */
export async function listPayRunSummaries(
  db: SupabaseClient,
  organizationId: string,
  options: { statuses?: readonly PayRunStatus[]; limit?: number } = {},
): Promise<PayRunSummary[]> {
  let query = db
    .from("pay_runs")
    .select(
      `${PAY_RUN_COLUMNS}, items:pay_run_items(amount::text, currency), submissions:pay_run_submissions(${SUBMISSION_META_COLUMNS}), decisions:pay_run_approvals(${DECISION_COLUMNS})`,
    )
    .eq("organization_id", organizationId)
    .order("period_month", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(options.limit ?? 200);
  if (options.statuses?.length) {
    query = query.in("status", [...options.statuses]);
  }
  const { data, error } = await query;
  throwIfError(error);

  return z
    .array(summaryRowSchema)
    .parse(data ?? [])
    .map(({ items, submissions, decisions, ...run }) => ({
      ...run,
      itemCount: items.length,
      totals: totalsByCurrency(items),
      activeSubmission: submissions.find((submission) => submission.superseded_at === null) ?? null,
      lastSubmission: latest(submissions, (submission) => submission.submitted_at),
      lastDecision: latest(decisions, (decision) => decision.decided_at),
      allSubmissions: submissions,
      allDecisions: decisions,
    }));
}

export async function countPayRuns(db: SupabaseClient, organizationId: string, status: PayRunStatus): Promise<number> {
  const { count, error } = await db
    .from("pay_runs")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .eq("status", status);
  throwIfError(error);
  return count ?? 0;
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

const lineSchema = z.object({
  id: uuidSchema,
  contractor_id: uuidSchema,
  payout_method_id: uuidSchema,
  amount: z.string(),
  currency: z.string(),
  memo: z.string().nullable(),
  created_by: uuidSchema,
  updated_by: uuidSchema,
  contractor: z.object({
    full_name: z.string(),
    country_code: z.string(),
    status: z.enum(["active", "archived"]),
    verification_status: z.enum(["not_started", "pending", "verified", "rejected"]),
  }),
  payout_method: z.object({
    rail: z.enum(["bank_transfer", "mobile_money", "ach", "wire", "interac"]),
    display_label: z.string(),
    version: z.number().int(),
    is_current: z.boolean(),
  }),
});

export type PayRunLine = z.output<typeof lineSchema>;

/** The frozen record an approver signs off, as stored by the database. */
export const snapshotSchema = z.object({
  version: z.number().int(),
  title: z.string(),
  period_month: z.string(),
  funding_currency: z.string(),
  items: z.array(
    z.object({
      item_id: uuidSchema,
      contractor_id: uuidSchema,
      contractor_name: z.string(),
      contractor_country: z.string(),
      verification_status: z.string(),
      payout_method_id: uuidSchema,
      payout_method_version: z.number().int(),
      rail: z.string(),
      payout_display: z.string(),
      amount: z.string(),
      currency: z.string(),
      memo: z.string().nullable(),
    }),
  ),
  totals: z.array(z.object({ currency: z.string(), amount: z.string(), items: z.number().int() })),
});

export type Snapshot = z.output<typeof snapshotSchema>;

export type PayRunDetail = {
  payRun: PayRun;
  lines: PayRunLine[];
  totals: CurrencyTotal[];
  submissions: SubmissionMeta[];
  activeSubmission: (SubmissionMeta & { snapshot: Snapshot }) | null;
  decisions: Decision[];
};

export async function getPayRunDetail(db: SupabaseClient, payRunId: string): Promise<PayRunDetail | null> {
  const { data: run, error } = await db.from("pay_runs").select(PAY_RUN_COLUMNS).eq("id", payRunId).maybeSingle();
  throwIfError(error);
  if (!run) {
    return null;
  }

  const [lines, submissions, decisions] = await Promise.all([
    db
      .from("pay_run_items")
      .select(
        "id, contractor_id, payout_method_id, amount::text, currency, memo, created_by, updated_by, " +
          "contractor:contractors(full_name, country_code, status, verification_status), " +
          "payout_method:contractor_payout_methods!pay_run_items_contractor_id_payout_method_id_fkey(rail, display_label, version, is_current)",
      )
      .eq("pay_run_id", payRunId)
      .order("created_at"),
    db
      .from("pay_run_submissions")
      .select(`${SUBMISSION_META_COLUMNS}, snapshot`)
      .eq("pay_run_id", payRunId)
      .order("submitted_at", { ascending: false }),
    db.from("pay_run_approvals").select(DECISION_COLUMNS).eq("pay_run_id", payRunId).order("decided_at", {
      ascending: false,
    }),
  ]);
  throwIfError(lines.error);
  throwIfError(submissions.error);
  throwIfError(decisions.error);

  const parsedLines = z.array(lineSchema).parse(lines.data ?? []);
  const parsedSubmissions = z
    .array(submissionMetaSchema.extend({ snapshot: z.unknown() }))
    .parse(submissions.data ?? []);
  const active = parsedSubmissions.find((submission) => submission.superseded_at === null);

  return {
    payRun: payRunSchema.parse(run),
    lines: parsedLines,
    totals: totalsByCurrency(parsedLines),
    // Parsing with the metadata schema drops the (large) snapshot field.
    submissions: parsedSubmissions.map((submission) => submissionMetaSchema.parse(submission)),
    activeSubmission: active ? { ...active, snapshot: snapshotSchema.parse(active.snapshot) } : null,
    decisions: z.array(decisionSchema).parse(decisions.data ?? []),
  };
}

// ---------------------------------------------------------------------------
// History export
// ---------------------------------------------------------------------------

const exportLineSchema = z.object({
  pay_run_id: uuidSchema,
  amount: z.string(),
  currency: z.string(),
  memo: z.string().nullable(),
  contractor: z.object({ full_name: z.string(), country_code: z.string() }),
  payout_method: z.object({ display_label: z.string(), rail: z.string() }),
});

export type ExportLine = z.output<typeof exportLineSchema>;

/** Every pay-run line in an organization with its masked payout label. */
export async function listExportLines(db: SupabaseClient, organizationId: string): Promise<ExportLine[]> {
  const { data, error } = await db
    .from("pay_run_items")
    .select(
      "pay_run_id, amount::text, currency, memo, contractor:contractors(full_name, country_code), " +
        "payout_method:contractor_payout_methods!pay_run_items_contractor_id_payout_method_id_fkey(display_label, rail)",
    )
    .eq("organization_id", organizationId)
    .order("created_at")
    .limit(10000);
  throwIfError(error);
  return z.array(exportLineSchema).parse(data ?? []);
}

// ---------------------------------------------------------------------------
// Mutations (RPCs)
// ---------------------------------------------------------------------------

export function createPayRun(db: SupabaseClient, input: CreatePayRunInput): Promise<string> {
  return callRpc(
    db,
    "create_pay_run",
    {
      p_organization_id: input.organizationId,
      p_title: input.title,
      p_period_month: input.periodMonth,
      p_funding_currency: input.fundingCurrency,
    },
    uuidSchema,
  );
}

export function upsertPayRunItem(db: SupabaseClient, input: UpsertPayRunItemInput): Promise<string> {
  return callRpc(
    db,
    "upsert_pay_run_item",
    {
      p_pay_run_id: input.payRunId,
      p_contractor_id: input.contractorId,
      // Sent as a decimal string to avoid floating-point rounding.
      p_amount: input.amount,
      p_memo: input.memo,
    },
    uuidSchema,
  );
}

export async function removePayRunItem(db: SupabaseClient, itemId: string): Promise<void> {
  await callRpc(db, "remove_pay_run_item", { p_item_id: itemId }, z.null());
}

/** Freezes the run into an immutable snapshot and returns the submission ID. */
export function submitPayRun(db: SupabaseClient, payRunId: string): Promise<string> {
  return callRpc(db, "submit_pay_run", { p_pay_run_id: payRunId }, uuidSchema);
}

export async function transitionPayRun(
  db: SupabaseClient,
  fn: "withdraw_pay_run" | "reopen_pay_run" | "cancel_pay_run",
  payRunId: string,
): Promise<void> {
  await callRpc(db, fn, { p_pay_run_id: payRunId }, z.null());
}

export function approvePayRun(db: SupabaseClient, input: ApprovePayRunInput): Promise<string> {
  return callRpc(
    db,
    "approve_pay_run",
    {
      p_pay_run_id: input.payRunId,
      p_submission_id: input.submissionId,
      p_snapshot_hash: input.snapshotHash,
    },
    uuidSchema,
  );
}

export function rejectPayRun(db: SupabaseClient, input: RejectPayRunInput): Promise<string> {
  return callRpc(
    db,
    "reject_pay_run",
    {
      p_pay_run_id: input.payRunId,
      p_submission_id: input.submissionId,
      p_snapshot_hash: input.snapshotHash,
      p_comment: input.comment,
    },
    uuidSchema,
  );
}
