/**
 * Pure helpers for the dashboard, approvals and history pages. No data access
 * here, so they can be unit tested; callers pass rows already filtered by RLS.
 */
import { toCsv } from "@/lib/csv";
import { mergeTotals, type CurrencyTotal } from "@/lib/money";
import { PAY_RUN_STATUS, PAYMENT_STATUS } from "@/lib/format/status";

import type { ExportLine, PayRunSummary } from "./data";

export type ActivityEvent = {
  kind: "created" | "submitted" | "approved" | "rejected";
  at: string;
  actorId: string;
  payRunId: string;
  payRunTitle: string;
};

/** Most recent workflow events across pay runs, newest first. */
export function buildActivity(runs: readonly PayRunSummary[], limit: number): ActivityEvent[] {
  const events: ActivityEvent[] = [];
  for (const run of runs) {
    const base = { payRunId: run.id, payRunTitle: run.title };
    events.push({ ...base, kind: "created", at: run.created_at, actorId: run.created_by });
    for (const submission of run.allSubmissions) {
      events.push({ ...base, kind: "submitted", at: submission.submitted_at, actorId: submission.submitted_by });
    }
    for (const decision of run.allDecisions) {
      events.push({ ...base, kind: decision.decision, at: decision.decided_at, actorId: decision.decided_by });
    }
  }
  return events.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}

/**
 * Hint for the UI only: whether this user created or submitted the run. The
 * database enforces the full separation-of-duties rule (including anyone who
 * edited lines or entered payout details) when a decision is recorded.
 */
export function userPreparedRun(run: PayRunSummary, userId: string): boolean {
  return run.created_by === userId || run.allSubmissions.some((submission) => submission.submitted_by === userId);
}

export type Obligations = {
  /** Approved runs: committed amounts that have not been paid. */
  approved: { runs: PayRunSummary[]; totals: CurrencyTotal[] };
  /** Submitted runs awaiting a decision. */
  awaitingApproval: { runs: PayRunSummary[]; totals: CurrencyTotal[] };
};

/** Upcoming payment obligations, grouped by state and summed per currency. */
export function summarizeObligations(runs: readonly PayRunSummary[]): Obligations {
  const byPeriod = (a: PayRunSummary, b: PayRunSummary) => a.period_month.localeCompare(b.period_month);
  const approved = runs.filter((run) => run.status === "approved").sort(byPeriod);
  const awaiting = runs.filter((run) => run.status === "pending_approval").sort(byPeriod);
  return {
    approved: { runs: approved, totals: mergeTotals(approved.map((run) => run.totals)) },
    awaitingApproval: { runs: awaiting, totals: mergeTotals(awaiting.map((run) => run.totals)) },
  };
}

export const HISTORY_CSV_HEADER = [
  "Pay run ID",
  "Pay run",
  "Period",
  "Run status",
  "Payment status",
  "Contractor",
  "Country",
  "Payout method",
  "Amount",
  "Currency",
  "Reference",
  "Created at (UTC)",
  "Submitted at (UTC)",
  "Submitted by",
  "Decision",
  "Decided at (UTC)",
  "Decided by",
  "Decision comment",
  "Snapshot SHA-256",
] as const;

/**
 * One row per pay-run line. Payout methods appear only as masked labels, and
 * every row states that no payment has been sent.
 */
export function buildHistoryCsv(
  runs: readonly PayRunSummary[],
  lines: readonly ExportLine[],
  personName: (userId: string | null | undefined) => string,
): string {
  const linesByRun = new Map<string, ExportLine[]>();
  for (const line of lines) {
    linesByRun.set(line.pay_run_id, [...(linesByRun.get(line.pay_run_id) ?? []), line]);
  }

  const rows: (string | number | null)[][] = [];
  for (const run of runs) {
    const submission = run.lastSubmission;
    const decision = run.lastDecision;
    const runColumns = [run.id, run.title, run.period_month.slice(0, 7), PAY_RUN_STATUS[run.status].label, PAYMENT_STATUS.not_sent.label];
    const auditColumns = [
      run.created_at,
      submission?.submitted_at ?? null,
      submission ? personName(submission.submitted_by) : null,
      decision ? (decision.decision === "approved" ? "Approved" : "Rejected") : null,
      decision?.decided_at ?? null,
      decision ? personName(decision.decided_by) : null,
      decision?.comment ?? null,
      submission?.snapshot_hash ?? null,
    ];
    const runLines = linesByRun.get(run.id) ?? [];
    if (runLines.length === 0) {
      rows.push([...runColumns, null, null, null, null, null, null, ...auditColumns]);
    }
    for (const line of runLines) {
      rows.push([
        ...runColumns,
        line.contractor.full_name,
        line.contractor.country_code,
        line.payout_method.display_label,
        line.amount,
        line.currency,
        line.memo,
        ...auditColumns,
      ]);
    }
  }
  return toCsv(HISTORY_CSV_HEADER, rows);
}
