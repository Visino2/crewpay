import { CheckCircle2Icon, CircleAlertIcon, InfoIcon } from "lucide-react";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { LinkButton } from "@/components/app/link-button";
import { CurrencyTotals } from "@/components/app/money";
import { Notice } from "@/components/app/notice";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LinesTable } from "@/features/pay-runs/components/lines-table";
import { SubmitPayRunButton } from "@/features/pay-runs/components/run-actions";
import { loadPayRunPage } from "@/features/pay-runs/load";
import { formatPeriod } from "@/lib/format/dates";
import { getBlaaizConfig } from "@/services/blaaiz/config";
import { createBlaaizProvider } from "@/services/blaaiz/provider";

export const metadata: Metadata = { title: "Review pay run" };

function safeConfig() {
  try {
    return getBlaaizConfig();
  } catch {
    return null;
  }
}

export default async function ReviewPayRunPage({
  params,
}: PageProps<"/orgs/[organizationId]/pay-runs/[payRunId]/review">) {
  const { organizationId, payRunId } = await params;
  const { context, detail } = await loadPayRunPage(organizationId, payRunId);
  if (!context.can("prepare")) {
    notFound();
  }
  const { payRun, lines, totals } = detail;
  const runHref = `/orgs/${organizationId}/pay-runs/${payRun.id}`;
  if (payRun.status !== "draft") {
    redirect(runHref);
  }

  const stale = lines.filter((line) => !line.payout_method.is_current);
  const archived = lines.filter((line) => line.contractor.status === "archived");
  const unverified = lines.filter((line) => line.contractor.verification_status !== "verified");
  const blocking = lines.length === 0 || stale.length > 0 || archived.length > 0;

  // Ask the provider-neutral interface for a quote; it reports why none exists
  // rather than inventing fees or rates.
  const quote = await createBlaaizProvider(safeConfig()).getFeeQuote({
    sourceCurrency: payRun.funding_currency,
    destinationCurrency: totals[0]?.currency ?? payRun.funding_currency,
    recipientAmount: totals[0]?.amount ?? "0.00",
  });

  const checks = [
    {
      ok: lines.length > 0,
      label: lines.length > 0 ? `${lines.length} ${lines.length === 1 ? "line" : "lines"} ready` : "Add at least one line",
    },
    {
      ok: stale.length === 0,
      label: stale.length === 0 ? "All lines use current payout details" : `${stale.length} line(s) use outdated payout details`,
    },
    {
      ok: archived.length === 0,
      label: archived.length === 0 ? "No archived contractors" : `${archived.length} archived contractor(s)`,
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        back={{ href: runHref, label: payRun.title }}
        title="Review before submitting"
        description={`${payRun.title} · ${formatPeriod(payRun.period_month)}. Once submitted, the pay run is frozen exactly as shown here.`}
        actions={
          <>
            <LinkButton href={runHref} variant="outline">
              Keep editing
            </LinkButton>
            <SubmitPayRunButton organizationId={organizationId} payRunId={payRun.id} disabled={blocking} />
          </>
        }
      />

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>What will be submitted</CardTitle>
            <CardDescription>The amount each contractor should receive, in the currency of their payout details.</CardDescription>
          </CardHeader>
          <CardContent>
            <LinesTable payRunId={payRun.id} lines={lines} totals={totals} editable={false} />
          </CardContent>
        </Card>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Checks</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col gap-3 text-sm">
                {checks.map((check) => (
                  <li key={check.label} className="flex items-start gap-2">
                    {check.ok ? (
                      <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-success" aria-label="Passed" />
                    ) : (
                      <CircleAlertIcon className="mt-0.5 size-4 shrink-0 text-destructive" aria-label="Needs attention" />
                    )}
                    {check.label}
                  </li>
                ))}
                {unverified.length > 0 ? (
                  <li className="flex items-start gap-2 text-muted-foreground">
                    <InfoIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
                    {unverified.length} contractor(s) not yet verified by the payment provider. This doesn&apos;t block
                    approval, but verification will be required before any payout.
                  </li>
                ) : null}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Totals</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="text-lg font-semibold">
                <CurrencyTotals totals={totals} />
              </div>
              {quote.status === "unavailable" ? (
                <Notice variant="info" title="Fees and FX not available">
                  {quote.reason === "not_configured"
                    ? "The payment provider isn't connected, so CrewPay can't quote fees, exchange rates or the cost in "
                    : "Provider quotes aren't implemented yet, so CrewPay can't quote fees, exchange rates or the cost in "}
                  {payRun.funding_currency}. No estimate is shown rather than an invented one.
                </Notice>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
