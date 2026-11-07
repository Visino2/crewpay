import { ArrowRightIcon, ClipboardCheckIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PayRunStatusBadge } from "@/components/app/badges";
import { EmptyState } from "@/components/app/empty-state";
import { CurrencyTotals } from "@/components/app/money";
import { PageHeader } from "@/components/app/page-header";
import { StatusBadge } from "@/components/app/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getOrgContext } from "@/features/organizations/context";
import { getPeople, personName } from "@/features/organizations/data";
import { listPayRunSummaries } from "@/features/pay-runs/data";
import { userPreparedRun } from "@/features/pay-runs/history";
import { formatDateTime, formatPeriod } from "@/lib/format/dates";

export const metadata: Metadata = { title: "Approvals" };

export default async function ApprovalsPage({ params }: PageProps<"/orgs/[organizationId]/approvals">) {
  const { organizationId } = await params;
  const context = await getOrgContext(organizationId);
  const runs = await listPayRunSummaries(context.db, organizationId, {
    statuses: ["pending_approval", "approved", "rejected"],
  });
  const pending = runs.filter((run) => run.status === "pending_approval");
  const decided = runs
    .filter((run) => run.lastDecision && run.status !== "pending_approval")
    .sort((a, b) => (b.lastDecision?.decided_at ?? "").localeCompare(a.lastDecision?.decided_at ?? ""))
    .slice(0, 8);
  const people = await getPeople(context.db, [
    ...pending.map((run) => run.activeSubmission?.submitted_by ?? run.created_by),
    ...decided.map((run) => run.lastDecision?.decided_by ?? ""),
  ]);
  const base = `/orgs/${organizationId}/pay-runs`;
  const canDecide = context.can("decide");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Approvals"
        description={
          canDecide
            ? "Pay runs waiting for a decision. You can't approve a pay run you prepared; another approver has to."
            : "Pay runs waiting for a decision. Only admins and approvers can approve or reject."
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Awaiting approval</CardTitle>
          <CardDescription>Each submission is frozen. Approving checks it hasn&apos;t changed since you reviewed it.</CardDescription>
        </CardHeader>
        <CardContent>
          {pending.length === 0 ? (
            <EmptyState icon={ClipboardCheckIcon} title="Nothing waiting" description="Submitted pay runs will appear here." />
          ) : (
            <ul className="flex flex-col gap-3">
              {pending.map((run) => {
                const mine = userPreparedRun(run, context.user.id);
                return (
                  <li key={run.id}>
                    <Link
                      href={`${base}/${run.id}`}
                      className="group flex flex-wrap items-center gap-4 rounded-lg border px-4 py-3 transition-colors hover:border-primary/30 hover:bg-accent/30"
                    >
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="font-medium">{run.title}</span>
                        <span className="text-xs text-muted-foreground">
                          {formatPeriod(run.period_month)} · {run.itemCount} {run.itemCount === 1 ? "line" : "lines"} · submitted by{" "}
                          {personName(people, run.activeSubmission?.submitted_by)} on {formatDateTime(run.activeSubmission?.submitted_at)}
                        </span>
                      </div>
                      {canDecide ? (
                        mine ? (
                          <StatusBadge tone="neutral">You prepared this</StatusBadge>
                        ) : (
                          <StatusBadge tone="warning">Needs your decision</StatusBadge>
                        )
                      ) : null}
                      <CurrencyTotals totals={run.totals} align="end" className="text-sm font-medium" />
                      <ArrowRightIcon className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recently decided</CardTitle>
        </CardHeader>
        <CardContent>
          {decided.length === 0 ? (
            <p className="text-sm text-muted-foreground">No decisions yet.</p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {decided.map((run) => (
                <li key={run.id}>
                  <Link href={`${base}/${run.id}`} className="flex flex-wrap items-center gap-4 px-4 py-3 hover:bg-secondary/50">
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="font-medium">{run.title}</span>
                      <span className="text-xs text-muted-foreground">
                        {personName(people, run.lastDecision?.decided_by)} · {formatDateTime(run.lastDecision?.decided_at)}
                      </span>
                    </div>
                    <PayRunStatusBadge status={run.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
