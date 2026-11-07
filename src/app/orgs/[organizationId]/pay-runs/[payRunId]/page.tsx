import { ArrowRightIcon, ClipboardListIcon } from "lucide-react";
import type { Metadata } from "next";

import { PaymentStatusBadge, PayRunStatusBadge } from "@/components/app/badges";
import { EmptyState } from "@/components/app/empty-state";
import { LinkButton } from "@/components/app/link-button";
import { CurrencyTotals } from "@/components/app/money";
import { Notice } from "@/components/app/notice";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { listPayableContractors } from "@/features/contractors/data";
import { getPeople, personName, type PersonDirectory } from "@/features/organizations/data";
import { AddLineForm } from "@/features/pay-runs/components/line-editor";
import { LinesTable } from "@/features/pay-runs/components/lines-table";
import {
  ApprovePayRunButton,
  CancelPayRunButton,
  RejectPayRunButton,
  ReopenPayRunButton,
  WithdrawPayRunButton,
} from "@/features/pay-runs/components/run-actions";
import { SnapshotView } from "@/features/pay-runs/components/snapshot-view";
import type { PayRunDetail } from "@/features/pay-runs/data";
import { loadPayRunPage } from "@/features/pay-runs/load";
import { formatDateTime, formatPeriod } from "@/lib/format/dates";
import { formatMoney } from "@/lib/money";

export const metadata: Metadata = { title: "Pay run" };

export default async function PayRunPage({ params }: PageProps<"/orgs/[organizationId]/pay-runs/[payRunId]">) {
  const { organizationId, payRunId } = await params;
  const { context, detail } = await loadPayRunPage(organizationId, payRunId);
  const { payRun, lines, totals, activeSubmission, decisions, submissions } = detail;
  const base = `/orgs/${organizationId}/pay-runs`;
  const canPrepare = context.can("prepare");
  const canDecide = context.can("decide");
  const isDraft = payRun.status === "draft";

  const people = await getPeople(context.db, [
    payRun.created_by,
    ...submissions.map((submission) => submission.submitted_by),
    ...decisions.map((decision) => decision.decided_by),
  ]);
  const payable =
    isDraft && canPrepare
      ? (await listPayableContractors(context.db, organizationId))
          .filter((contractor) => !lines.some((line) => line.contractor_id === contractor.id))
          .map((contractor) => ({
            id: contractor.id,
            name: contractor.full_name,
            payoutLabel: contractor.currentPayoutMethod.display_label,
            currency: contractor.currentPayoutMethod.currency,
          }))
      : [];

  const latestDecision = decisions[0] ?? null;
  const blocked = lines.some((line) => !line.payout_method.is_current || line.contractor.status === "archived");
  // Hint only: the database applies the full separation-of-duties rule.
  const preparedByMe =
    payRun.created_by === context.user.id || submissions.some((submission) => submission.submitted_by === context.user.id);

  const actions = (
    <>
      {isDraft && canPrepare ? (
        <>
          <CancelPayRunButton organizationId={organizationId} payRunId={payRun.id} />
          {lines.length > 0 ? (
            <LinkButton href={`${base}/${payRun.id}/review`}>
              Review and submit
              <ArrowRightIcon aria-hidden />
            </LinkButton>
          ) : null}
        </>
      ) : null}
      {payRun.status === "pending_approval" && canPrepare ? <WithdrawPayRunButton payRunId={payRun.id} /> : null}
      {payRun.status === "rejected" && canPrepare ? (
        <>
          <CancelPayRunButton organizationId={organizationId} payRunId={payRun.id} />
          <ReopenPayRunButton payRunId={payRun.id} />
        </>
      ) : null}
    </>
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        back={{ href: base, label: "Pay runs" }}
        title={payRun.title}
        meta={
          <>
            <PayRunStatusBadge status={payRun.status} />
            <PaymentStatusBadge />
            <span className="text-sm text-muted-foreground">
              {formatPeriod(payRun.period_month)} · funded in {payRun.funding_currency}
            </span>
          </>
        }
        actions={actions}
      />

      <StatusNotice detail={detail} people={people} blocked={blocked} />

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="flex flex-col gap-6 xl:col-span-2">
          {payRun.status === "pending_approval" && canDecide && activeSubmission ? (
            <Card className="border-warning/30">
              <CardHeader>
                <CardTitle>Your decision</CardTitle>
                <CardDescription>
                  You are approving the snapshot below, identified by its fingerprint. If anything changes before you
                  decide, the decision is refused.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {preparedByMe ? (
                  <Notice variant="warning" title="Someone else must decide">
                    You created or submitted this pay run, so another approver has to review it.
                  </Notice>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <ApprovePayRunButton
                      decision={{ payRunId: payRun.id, submissionId: activeSubmission.id, snapshotHash: activeSubmission.snapshot_hash }}
                      summary={`${activeSubmission.snapshot.items.length} ${activeSubmission.snapshot.items.length === 1 ? "line" : "lines"} totalling ${activeSubmission.snapshot.totals.map((total) => formatMoney(total.amount, total.currency)).join(" and ")}.`}
                    />
                    <RejectPayRunButton
                      decision={{ payRunId: payRun.id, submissionId: activeSubmission.id, snapshotHash: activeSubmission.snapshot_hash }}
                    />
                  </div>
                )}
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>{activeSubmission && !isDraft ? "Submitted snapshot" : "Lines"}</CardTitle>
              <CardDescription>
                {activeSubmission && !isDraft
                  ? `Frozen when ${personName(people, activeSubmission.submitted_by)} submitted it on ${formatDateTime(activeSubmission.submitted_at)}. Amounts are what each contractor should receive.`
                  : "Amounts are what each contractor should receive, in the currency of their payout details. Fees and FX are not calculated."}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {activeSubmission && !isDraft ? (
                <SnapshotView snapshot={activeSubmission.snapshot} snapshotHash={activeSubmission.snapshot_hash} />
              ) : lines.length === 0 ? (
                <EmptyState
                  icon={ClipboardListIcon}
                  title="No lines yet"
                  description={
                    isDraft && canPrepare
                      ? "Add contractors and the amount each should receive."
                      : "This pay run has no lines."
                  }
                />
              ) : (
                <LinesTable payRunId={payRun.id} lines={lines} totals={totals} editable={isDraft && canPrepare} />
              )}
              {isDraft && canPrepare ? <AddLineForm payRunId={payRun.id} contractors={payable} /> : null}
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="flex flex-col gap-4 text-sm">
                <div className="flex flex-col gap-1">
                  <dt className="text-xs font-medium text-muted-foreground">Total to contractors</dt>
                  <dd className="text-lg font-semibold">
                    <CurrencyTotals totals={activeSubmission && !isDraft ? activeSubmission.snapshot.totals.map((total) => ({ ...total, count: total.items })) : totals} />
                  </dd>
                </div>
                <div className="flex flex-col gap-1">
                  <dt className="text-xs font-medium text-muted-foreground">Fees and FX</dt>
                  <dd className="text-muted-foreground">Not available: payment provider not connected</dd>
                </div>
                <div className="flex flex-col gap-1">
                  <dt className="text-xs font-medium text-muted-foreground">Payment</dt>
                  <dd className="text-muted-foreground">Not sent. Approval records a decision; it does not move money.</dd>
                </div>
                {latestDecision?.comment ? (
                  <div className="flex flex-col gap-1">
                    <dt className="text-xs font-medium text-muted-foreground">Latest decision comment</dt>
                    <dd>&ldquo;{latestDecision.comment}&rdquo;</dd>
                  </div>
                ) : null}
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Timeline</CardTitle>
            </CardHeader>
            <CardContent>
              <Timeline detail={detail} people={people} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function StatusNotice({ detail, people, blocked }: { detail: PayRunDetail; people: PersonDirectory; blocked: boolean }) {
  const { payRun, decisions } = detail;
  const latest = decisions[0];
  if (payRun.status === "draft" && blocked) {
    return (
      <Notice variant="warning" title="Some lines need attention before submitting">
        A contractor&apos;s payout details changed or the contractor was archived. Update or remove the highlighted lines.
      </Notice>
    );
  }
  if (payRun.status === "approved" && latest) {
    return (
      <Notice variant="secure" title={`Approved by ${personName(people, latest.decided_by)} on ${formatDateTime(latest.decided_at)}`}>
        Approved for payment. No money has been sent: payouts are not connected yet.
      </Notice>
    );
  }
  if (payRun.status === "rejected" && latest) {
    return (
      <Notice variant="warning" title={`Rejected by ${personName(people, latest.decided_by)} on ${formatDateTime(latest.decided_at)}`}>
        &ldquo;{latest.comment}&rdquo;
      </Notice>
    );
  }
  if (payRun.status === "pending_approval") {
    return (
      <Notice variant="info" title="Awaiting approval">
        This pay run is frozen. To change it, withdraw it to draft and submit it again.
      </Notice>
    );
  }
  if (payRun.status === "cancelled") {
    return <Notice variant="info" title="Cancelled">This pay run is closed. It was not paid.</Notice>;
  }
  return null;
}

function Timeline({ detail, people }: { detail: PayRunDetail; people: PersonDirectory }) {
  const { payRun, submissions, decisions } = detail;
  const events = [
    { at: payRun.created_at, text: `Created by ${personName(people, payRun.created_by)}` },
    ...submissions.flatMap((submission) => [
      { at: submission.submitted_at, text: `Submitted (version ${submission.pay_run_version}) by ${personName(people, submission.submitted_by)}` },
      ...(submission.superseded_at
        ? [{ at: submission.superseded_at, text: `Submission (version ${submission.pay_run_version}) superseded` }]
        : []),
    ]),
    ...decisions.map((decision) => ({
      at: decision.decided_at,
      text: `${decision.decision === "approved" ? "Approved" : "Rejected"} by ${personName(people, decision.decided_by)}`,
    })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  return (
    <ol className="relative flex flex-col gap-4 border-l pl-4">
      {events.map((event, index) => (
        <li key={`${event.at}-${index}`} className="relative text-sm">
          <span aria-hidden className="absolute top-1.5 -left-[21px] size-2.5 rounded-full border-2 border-card bg-primary" />
          <p>{event.text}</p>
          <p className="text-xs text-muted-foreground">{formatDateTime(event.at)}</p>
        </li>
      ))}
    </ol>
  );
}
