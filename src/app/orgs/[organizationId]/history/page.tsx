import { DownloadIcon, HistoryIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PaymentStatusBadge, PayRunStatusBadge } from "@/components/app/badges";
import { EmptyState } from "@/components/app/empty-state";
import { CurrencyTotals } from "@/components/app/money";
import { Notice } from "@/components/app/notice";
import { PageHeader } from "@/components/app/page-header";
import { StatusTabs } from "@/components/app/status-tabs";
import { LinkButton } from "@/components/app/link-button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getOrgContext } from "@/features/organizations/context";
import { getPeople, personName } from "@/features/organizations/data";
import { listPayRunSummaries, payRunStatusSchema } from "@/features/pay-runs/data";
import { formatDate, formatPeriod } from "@/lib/format/dates";
import { PAY_RUN_STATUS } from "@/lib/format/status";

export const metadata: Metadata = { title: "History" };

export default async function HistoryPage({ params, searchParams }: PageProps<"/orgs/[organizationId]/history">) {
  const { organizationId } = await params;
  const context = await getOrgContext(organizationId);
  const requested = (await searchParams).status;
  const status = payRunStatusSchema.safeParse(Array.isArray(requested) ? requested[0] : requested);
  const runs = await listPayRunSummaries(context.db, organizationId, { limit: 1000 });
  const visible = status.success ? runs.filter((run) => run.status === status.data) : runs;
  const people = await getPeople(
    context.db,
    visible.flatMap((run) => [run.lastSubmission?.submitted_by ?? "", run.lastDecision?.decided_by ?? ""]).filter(Boolean),
  );
  const base = `/orgs/${organizationId}`;

  const tabs = [
    { value: "all", label: "All", href: `${base}/history` },
    ...payRunStatusSchema.options.map((value) => ({
      value,
      label: PAY_RUN_STATUS[value].label,
      href: `${base}/history?status=${value}`,
    })),
  ];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Payment history"
        description="Every pay run, with who submitted and decided it and when. Download it for your accountant or records."
        actions={
          context.can("exportHistory") ? (
            <LinkButton href={`${base}/history/export`} variant="outline" download>
              <DownloadIcon aria-hidden />
              Export CSV
            </LinkButton>
          ) : null
        }
      />
      <Notice variant="info">
        &ldquo;Approved&rdquo; means approved for payment, not paid. No payout has been sent for any pay run because
        payment execution is not connected yet. Exports show payout details as masked labels only.
      </Notice>
      <StatusTabs label="Filter by status" tabs={tabs} active={status.success ? status.data : "all"} />

      {visible.length === 0 ? (
        <EmptyState icon={HistoryIcon} title="Nothing here yet" description="Pay runs appear here as soon as they're created." />
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="bg-secondary/50 hover:bg-secondary/50">
                <TableHead className="pl-4">Pay run</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden md:table-cell">Payment</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="hidden lg:table-cell">Submitted</TableHead>
                <TableHead className="hidden pr-4 lg:table-cell">Decision</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((run) => (
                <TableRow key={run.id}>
                  <TableCell className="pl-4">
                    <Link href={`${base}/pay-runs/${run.id}`} className="flex flex-col font-medium hover:underline">
                      {run.title}
                      <span className="text-xs font-normal text-muted-foreground">
                        {formatPeriod(run.period_month)} · created {formatDate(run.created_at)}
                      </span>
                    </Link>
                  </TableCell>
                  <TableCell>
                    <PayRunStatusBadge status={run.status} />
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <PaymentStatusBadge />
                  </TableCell>
                  <TableCell className="text-right">
                    <CurrencyTotals totals={run.totals} align="end" className="font-medium" />
                  </TableCell>
                  <TableCell className="hidden text-sm lg:table-cell">
                    {run.lastSubmission ? (
                      <>
                        {formatDate(run.lastSubmission.submitted_at)}
                        <span className="block text-xs text-muted-foreground">{personName(people, run.lastSubmission.submitted_by)}</span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="hidden pr-4 text-sm lg:table-cell">
                    {run.lastDecision ? (
                      <>
                        {run.lastDecision.decision === "approved" ? "Approved" : "Rejected"} {formatDate(run.lastDecision.decided_at)}
                        <span className="block text-xs text-muted-foreground">{personName(people, run.lastDecision.decided_by)}</span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
