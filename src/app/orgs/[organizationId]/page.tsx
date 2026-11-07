import {
  ArrowRightIcon,
  BadgeCheckIcon,
  ClipboardCheckIcon,
  DownloadIcon,
  FilePenLineIcon,
  PlusIcon,
  UserPlusIcon,
  UsersIcon,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PayRunStatusBadge } from "@/components/app/badges";
import { EmptyState } from "@/components/app/empty-state";
import { LinkButton } from "@/components/app/link-button";
import { CurrencyTotals } from "@/components/app/money";
import { PageHeader } from "@/components/app/page-header";
import { StatCard } from "@/components/app/stat-card";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { listContractorOverviews } from "@/features/contractors/data";
import { getOrgContext } from "@/features/organizations/context";
import { getPeople, personName } from "@/features/organizations/data";
import { listPayRunSummaries } from "@/features/pay-runs/data";
import { buildActivity, summarizeObligations, userPreparedRun } from "@/features/pay-runs/history";
import { formatDateTime, formatPeriod } from "@/lib/format/dates";
import { formatMoney } from "@/lib/money";

export const metadata: Metadata = { title: "Overview" };

const ACTIVITY_WORDING = {
  created: { verb: "created", suffix: "" },
  submitted: { verb: "submitted", suffix: " for approval" },
  approved: { verb: "approved", suffix: "" },
  rejected: { verb: "rejected", suffix: "" },
} as const;

export default async function DashboardPage({ params }: PageProps<"/orgs/[organizationId]">) {
  const { organizationId } = await params;
  const context = await getOrgContext(organizationId);
  const base = `/orgs/${organizationId}`;

  const [contractors, runs] = await Promise.all([
    listContractorOverviews(context.db, organizationId),
    listPayRunSummaries(context.db, organizationId, { limit: 200 }),
  ]);

  const active = contractors.filter((contractor) => contractor.status === "active");
  const missingPayout = active.filter((contractor) => !contractor.currentPayoutMethod).length;
  const drafts = runs.filter((run) => run.status === "draft");
  const obligations = summarizeObligations(runs);
  const pending = obligations.awaitingApproval.runs;
  const decidable = context.can("decide") ? pending.filter((run) => !userPreparedRun(run, context.user.id)) : [];
  const activity = buildActivity(runs, 8);
  const people = await getPeople(
    context.db,
    activity.map((event) => event.actorId),
  );
  const upcoming = [...obligations.awaitingApproval.runs, ...obligations.approved.runs].sort((a, b) =>
    a.period_month.localeCompare(b.period_month),
  );

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={context.organization.name}
        description="Contractor pay runs, approvals and payment records for your organization."
        actions={
          context.can("prepare") ? (
            <LinkButton href={`${base}/pay-runs/new`}>
              <PlusIcon aria-hidden />
              New pay run
            </LinkButton>
          ) : null
        }
      />

      <section aria-label="Key figures" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Active contractors"
          value={active.length}
          icon={UsersIcon}
          href={`${base}/contractors`}
          detail={
            missingPayout > 0
              ? `${missingPayout} without payout details`
              : active.length > 0
                ? "All have payout details"
                : "None added yet"
          }
        />
        <StatCard
          label="Draft pay runs"
          value={drafts.length}
          icon={FilePenLineIcon}
          href={`${base}/pay-runs?status=draft`}
          detail="Being prepared"
        />
        <StatCard
          label="Awaiting approval"
          value={pending.length}
          icon={ClipboardCheckIcon}
          href={`${base}/approvals`}
          emphasis={decidable.length > 0}
          detail={
            context.can("decide")
              ? decidable.length > 0
                ? `${decidable.length} need your decision`
                : "Nothing for you to decide"
              : "Submitted for review"
          }
        />
        <StatCard
          label="Approved · not paid"
          value={obligations.approved.runs.length}
          icon={BadgeCheckIcon}
          href={`${base}/pay-runs?status=approved`}
          detail={
            obligations.approved.totals.length === 0
              ? "No approved runs"
              : obligations.approved.totals.length <= 2
                ? obligations.approved.totals.map((total) => formatMoney(total.amount, total.currency)).join(" · ")
                : `Across ${obligations.approved.totals.length} currencies · see obligations`
          }
        />
      </section>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Upcoming payment obligations</CardTitle>
            <CardDescription>
              Submitted and approved pay runs. Amounts are what each contractor should receive, in their payout
              currency. No payout has been sent: payment execution is not connected yet, so fees and FX are not
              available.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {upcoming.length === 0 ? (
              <EmptyState
                icon={ClipboardCheckIcon}
                title="No upcoming obligations"
                description="Pay runs appear here once they are submitted for approval."
              />
            ) : (
              <ul className="divide-y rounded-lg border">
                {upcoming.map((run) => (
                  <li key={run.id}>
                    <Link
                      href={`${base}/pay-runs/${run.id}`}
                      className="flex flex-col gap-2 px-4 py-3 transition-colors hover:bg-secondary/60 sm:flex-row sm:items-center sm:gap-4"
                    >
                      <div className="flex min-w-0 flex-1 items-start justify-between gap-3">
                        <div className="flex min-w-0 flex-col">
                          <span className="font-medium">{run.title}</span>
                          <span className="text-xs text-muted-foreground">
                            {formatPeriod(run.period_month)} · {run.itemCount} {run.itemCount === 1 ? "contractor" : "contractors"}
                          </span>
                        </div>
                        <PayRunStatusBadge status={run.status} />
                      </div>
                      <CurrencyTotals totals={run.totals} className="text-sm font-medium sm:min-w-44 sm:justify-items-end sm:text-right" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Quick actions</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {context.can("prepare") ? (
                <>
                  <QuickLink href={`${base}/pay-runs/new`} icon={PlusIcon} label="Start a pay run" />
                  <QuickLink href={`${base}/contractors/new`} icon={UserPlusIcon} label="Add a contractor" />
                </>
              ) : null}
              {context.can("decide") ? (
                <QuickLink href={`${base}/approvals`} icon={ClipboardCheckIcon} label="Review approvals" />
              ) : null}
              <QuickLink href={`${base}/history/export`} icon={DownloadIcon} label="Export history (CSV)" download />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recent activity</CardTitle>
            </CardHeader>
            <CardContent>
              {activity.length === 0 ? (
                <p className="text-sm text-muted-foreground">No pay run activity yet.</p>
              ) : (
                <ol className="flex flex-col gap-4">
                  {activity.map((event) => (
                    <li key={`${event.payRunId}-${event.kind}-${event.at}`} className="flex gap-3 text-sm">
                      <span aria-hidden className="mt-1.5 size-2 shrink-0 rounded-full bg-primary/60" />
                      <div className="flex min-w-0 flex-col">
                        <span>
                          <span className="font-medium">{personName(people, event.actorId)}</span>{" "}
                          {ACTIVITY_WORDING[event.kind].verb}{" "}
                          <Link href={`${base}/pay-runs/${event.payRunId}`} className="font-medium underline-offset-4 hover:underline">
                            {event.payRunTitle}
                          </Link>
                          {ACTIVITY_WORDING[event.kind].suffix}
                        </span>
                        <span className="text-xs text-muted-foreground">{formatDateTime(event.at)}</span>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function QuickLink({
  href,
  icon: Icon,
  label,
  download = false,
}: {
  href: string;
  icon: typeof PlusIcon;
  label: string;
  download?: boolean;
}) {
  const className =
    "group flex items-center gap-3 rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors hover:border-primary/30 hover:bg-accent/40";
  const content = (
    <>
      <Icon className="size-4 text-primary" aria-hidden />
      <span className="flex-1">{label}</span>
      <ArrowRightIcon className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
    </>
  );
  // File downloads use a plain anchor so the browser handles the attachment.
  return download ? (
    <a href={href} className={className} download>
      {content}
    </a>
  ) : (
    <Link href={href} className={className}>
      {content}
    </Link>
  );
}
