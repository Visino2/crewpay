import { PlusIcon, WalletCardsIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PaymentStatusBadge, PayRunStatusBadge } from "@/components/app/badges";
import { EmptyState } from "@/components/app/empty-state";
import { LinkButton } from "@/components/app/link-button";
import { CurrencyTotals } from "@/components/app/money";
import { PageHeader } from "@/components/app/page-header";
import { StatusTabs } from "@/components/app/status-tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getOrgContext } from "@/features/organizations/context";
import { listPayRunSummaries, payRunStatusSchema } from "@/features/pay-runs/data";
import { formatDate, formatPeriod } from "@/lib/format/dates";
import { PAY_RUN_STATUS } from "@/lib/format/status";

export const metadata: Metadata = { title: "Pay runs" };

export default async function PayRunsPage({ params, searchParams }: PageProps<"/orgs/[organizationId]/pay-runs">) {
  const { organizationId } = await params;
  const context = await getOrgContext(organizationId);
  const requested = (await searchParams).status;
  const status = payRunStatusSchema.safeParse(Array.isArray(requested) ? requested[0] : requested);
  const runs = await listPayRunSummaries(context.db, organizationId);
  const visible = status.success ? runs.filter((run) => run.status === status.data) : runs;
  const base = `/orgs/${organizationId}/pay-runs`;

  const tabs = [
    { value: "all", label: "All", href: base, count: runs.length },
    ...payRunStatusSchema.options.map((value) => ({
      value,
      label: PAY_RUN_STATUS[value].label,
      href: `${base}?status=${value}`,
      count: runs.filter((run) => run.status === value).length,
    })),
  ];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Pay runs"
        description="Prepare a month's contractor payments, submit them for approval, and keep a frozen record of what was approved."
        actions={
          context.can("prepare") ? (
            <LinkButton href={`${base}/new`}>
              <PlusIcon aria-hidden />
              New pay run
            </LinkButton>
          ) : null
        }
      />
      <StatusTabs label="Filter by status" tabs={tabs} active={status.success ? status.data : "all"} />

      {visible.length === 0 ? (
        <EmptyState
          icon={WalletCardsIcon}
          title={runs.length === 0 ? "No pay runs yet" : "No pay runs with this status"}
          description={runs.length === 0 ? "Create a draft, add contractors and amounts, then submit it for approval." : undefined}
          action={
            runs.length === 0 && context.can("prepare") ? (
              <LinkButton href={`${base}/new`}>Create your first pay run</LinkButton>
            ) : undefined
          }
        />
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="bg-secondary/50 hover:bg-secondary/50">
                <TableHead className="pl-4">Pay run</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden md:table-cell">Payment</TableHead>
                <TableHead className="hidden sm:table-cell text-right">Lines</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="hidden pr-4 text-right lg:table-cell">Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((run) => (
                <TableRow key={run.id}>
                  <TableCell className="pl-4">
                    <Link href={`${base}/${run.id}`} className="flex flex-col font-medium hover:underline">
                      {run.title}
                      <span className="text-xs font-normal text-muted-foreground">{formatPeriod(run.period_month)}</span>
                    </Link>
                  </TableCell>
                  <TableCell>
                    <PayRunStatusBadge status={run.status} />
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <PaymentStatusBadge />
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums sm:table-cell">{run.itemCount}</TableCell>
                  <TableCell className="text-right">
                    <CurrencyTotals totals={run.totals} align="end" className="font-medium" />
                  </TableCell>
                  <TableCell className="hidden pr-4 text-right text-muted-foreground lg:table-cell">
                    {formatDate(run.updated_at)}
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
