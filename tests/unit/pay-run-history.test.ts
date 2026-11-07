import { describe, expect, it } from "vitest";

import type { ExportLine, PayRunSummary } from "@/features/pay-runs/data";
import {
  buildActivity,
  buildHistoryCsv,
  HISTORY_CSV_HEADER,
  summarizeObligations,
  userPreparedRun,
} from "@/features/pay-runs/history";

const PREPARER = "11111111-1111-4111-8111-111111111111";
const APPROVER = "22222222-2222-4222-8222-222222222222";

function run(overrides: Partial<PayRunSummary> & Pick<PayRunSummary, "id" | "status">): PayRunSummary {
  return {
    organization_id: "33333333-3333-4333-8333-333333333333",
    title: `Run ${overrides.id}`,
    period_month: "2026-11-01",
    funding_currency: "USD",
    version: 1,
    created_by: PREPARER,
    created_at: "2026-11-01T09:00:00Z",
    updated_at: "2026-11-01T09:00:00Z",
    itemCount: 1,
    totals: [{ currency: "NGN", amount: "100.00", count: 1 }],
    activeSubmission: null,
    lastSubmission: null,
    lastDecision: null,
    allSubmissions: [],
    allDecisions: [],
    ...overrides,
  };
}

const submission = {
  id: "44444444-4444-4444-8444-444444444444",
  pay_run_version: 2,
  snapshot_hash: "a".repeat(64),
  item_count: 1,
  submitted_by: PREPARER,
  submitted_at: "2026-11-02T10:00:00Z",
  superseded_at: null,
};

const decision = {
  id: "55555555-5555-4555-8555-555555555555",
  submission_id: submission.id,
  decision: "approved" as const,
  decided_by: APPROVER,
  decided_at: "2026-11-03T11:00:00Z",
  comment: null,
};

describe("obligations", () => {
  it("sums approved and pending runs separately, per currency, ignoring drafts", () => {
    const obligations = summarizeObligations([
      run({ id: "a", status: "approved", totals: [{ currency: "NGN", amount: "100.50", count: 1 }] }),
      run({ id: "b", status: "approved", totals: [{ currency: "NGN", amount: "0.50", count: 1 }] }),
      run({ id: "c", status: "pending_approval", totals: [{ currency: "KES", amount: "10.00", count: 1 }] }),
      run({ id: "d", status: "draft", totals: [{ currency: "NGN", amount: "999.00", count: 1 }] }),
    ]);
    expect(obligations.approved.totals).toEqual([{ currency: "NGN", amount: "101.00", count: 2 }]);
    expect(obligations.awaitingApproval.totals).toEqual([{ currency: "KES", amount: "10.00", count: 1 }]);
  });
});

describe("activity feed", () => {
  it("lists workflow events newest first", () => {
    const events = buildActivity(
      [run({ id: "a", status: "approved", allSubmissions: [submission], allDecisions: [decision] })],
      10,
    );
    expect(events.map((event) => event.kind)).toEqual(["approved", "submitted", "created"]);
    expect(events[0]?.actorId).toBe(APPROVER);
  });
});

describe("preparation hint", () => {
  it("recognises the creator or submitter", () => {
    const summary = run({ id: "a", status: "pending_approval", allSubmissions: [submission] });
    expect(userPreparedRun(summary, PREPARER)).toBe(true);
    expect(userPreparedRun(summary, APPROVER)).toBe(false);
  });
});

describe("history CSV", () => {
  const line: ExportLine = {
    pay_run_id: "a",
    amount: "250000.05",
    currency: "NGN",
    memo: "=cmd|' /C calc'!A0",
    contractor: { full_name: "Ada Okafor", country_code: "NG" },
    payout_method: { display_label: "NGN bank ****6789", rail: "bank_transfer" },
  };

  it("writes one row per line with masked payout details and an explicit payment status", () => {
    const csv = buildHistoryCsv(
      [
        run({
          id: "a",
          status: "approved",
          lastSubmission: submission,
          lastDecision: decision,
          allSubmissions: [submission],
          allDecisions: [decision],
        }),
      ],
      [line],
      (userId) => (userId === APPROVER ? "Grace Mwangi" : "Tunde Adeyemi"),
    );
    const [header, row] = csv.trimEnd().split("\r\n");
    expect(header).toBe(HISTORY_CSV_HEADER.map((cell) => `"${cell}"`).join(","));
    expect(row).toContain('"Approved","Not sent","Ada Okafor","NG","NGN bank ****6789","250000.05","NGN"');
    expect(row).toContain('"Grace Mwangi"');
    expect(row).toContain(`"${"a".repeat(64)}"`);
    // The formula-like reference is neutralised.
    expect(row).toContain(`"'=cmd|' /C calc'!A0"`);
  });

  it("keeps runs without lines and never says paid", () => {
    const csv = buildHistoryCsv([run({ id: "empty", status: "draft", itemCount: 0, totals: [] })], [], () => "x");
    expect(csv.trimEnd().split("\r\n")).toHaveLength(2);
    expect(csv).toContain('"Draft","Not sent"');
    expect(csv.toLowerCase()).not.toMatch(/"(paid|completed)"/);
  });
});
