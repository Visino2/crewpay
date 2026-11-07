import { CreditCardIcon, ReceiptTextIcon, ShieldQuestionIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ContractorStatusBadge, PayRunStatusBadge, VerificationBadge } from "@/components/app/badges";
import { EmptyState } from "@/components/app/empty-state";
import { Money } from "@/components/app/money";
import { Notice } from "@/components/app/notice";
import { PageHeader } from "@/components/app/page-header";
import { StatusBadge } from "@/components/app/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  ArchiveContractorButton,
  EditContractorButton,
  SetPayoutMethodButton,
} from "@/features/contractors/components/contractor-actions";
import { getContractorDetail } from "@/features/contractors/data";
import { getOrgContext } from "@/features/organizations/context";
import { getPeople, personName } from "@/features/organizations/data";
import { countryName } from "@/lib/format/countries";
import { formatDate, formatDateTime, formatPeriod } from "@/lib/format/dates";
import { RAIL_LABELS } from "@/lib/format/status";
import { uuidSchema } from "@/lib/validation/common";

export const metadata: Metadata = { title: "Contractor" };

export default async function ContractorPage({
  params,
}: PageProps<"/orgs/[organizationId]/contractors/[contractorId]">) {
  const { organizationId, contractorId } = await params;
  const context = await getOrgContext(organizationId);
  if (!uuidSchema.safeParse(contractorId).success) {
    notFound();
  }
  const detail = await getContractorDetail(context.db, contractorId);
  // RLS hides other organizations' contractors; also refuse a contractor
  // reached through another organization's URL.
  if (!detail || detail.contractor.organization_id !== organizationId) {
    notFound();
  }

  const { contractor, payoutMethods, payments } = detail;
  const current = payoutMethods.find((method) => method.is_current) ?? null;
  const people = await getPeople(context.db, [
    contractor.created_by,
    contractor.updated_by,
    ...payoutMethods.map((method) => method.created_by),
  ]);
  const canPrepare = context.can("prepare") && contractor.status === "active";
  const base = `/orgs/${organizationId}`;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        back={{ href: `${base}/contractors`, label: "Contractors" }}
        title={contractor.full_name}
        meta={
          <>
            <ContractorStatusBadge status={contractor.status} />
            <VerificationBadge status={contractor.verification_status} />
          </>
        }
        actions={
          canPrepare ? (
            <>
              <EditContractorButton
                contractorId={contractor.id}
                defaults={{ fullName: contractor.full_name, email: contractor.email, countryCode: contractor.country_code }}
              />
              <ArchiveContractorButton contractorId={contractor.id} name={contractor.full_name} />
            </>
          ) : null
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-4 text-sm">
              <DetailRow label="Email" value={contractor.email ?? "Not provided"} />
              <DetailRow label="Country" value={countryName(contractor.country_code)} />
              <DetailRow label="Added" value={`${formatDate(contractor.created_at)} by ${personName(people, contractor.created_by)}`} />
              <DetailRow label="Last updated" value={`${formatDate(contractor.updated_at)} by ${personName(people, contractor.updated_by)}`} />
            </dl>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Payout details</CardTitle>
            <CardDescription>Only a masked label is ever shown. Each change is kept as a separate version.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {current ? (
              <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border bg-secondary/40 px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className="flex size-9 items-center justify-center rounded-lg bg-card text-primary ring-1 ring-border">
                    <CreditCardIcon className="size-4" aria-hidden />
                  </span>
                  <div className="flex flex-col">
                    <span className="font-mono text-sm font-medium">{current.display_label}</span>
                    <span className="text-xs text-muted-foreground">
                      {RAIL_LABELS[current.rail]} · version {current.version} · set {formatDate(current.created_at)} by{" "}
                      {personName(people, current.created_by)}
                    </span>
                  </div>
                </div>
                {canPrepare ? <SetPayoutMethodButton contractorId={contractor.id} hasExisting /> : null}
              </div>
            ) : (
              <EmptyState
                icon={CreditCardIcon}
                title="No payout details"
                description="Add payout details before including this contractor in a pay run."
                action={canPrepare ? <SetPayoutMethodButton contractorId={contractor.id} hasExisting={false} /> : undefined}
              />
            )}

            <Notice variant="info" title="Identity verification">
              Contractors are verified by the payment provider before any payout. That integration isn&apos;t connected
              yet, so verification status stays &ldquo;Not verified&rdquo; for now.
            </Notice>

            {payoutMethods.length > 1 ? (
              <details className="group rounded-lg border">
                <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium">Version history ({payoutMethods.length})</summary>
                <ul className="divide-y border-t text-sm">
                  {payoutMethods.map((method) => (
                    <li key={method.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                      <span className="font-mono text-xs">{method.display_label}</span>
                      <span className="text-xs text-muted-foreground">
                        v{method.version} · {formatDateTime(method.created_at)} · {personName(people, method.created_by)}
                      </span>
                      {method.is_current ? <StatusBadge tone="success">Current</StatusBadge> : <StatusBadge tone="neutral">Replaced</StatusBadge>}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Pay run lines</CardTitle>
          <CardDescription>Amounts this contractor has been included for. Approved does not mean paid.</CardDescription>
        </CardHeader>
        <CardContent>
          {payments.length === 0 ? (
            <EmptyState icon={ReceiptTextIcon} title="Not in any pay run yet" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pay run</TableHead>
                  <TableHead className="hidden sm:table-cell">Period</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments.map((payment) => (
                  <TableRow key={payment.id}>
                    <TableCell>
                      <Link href={`${base}/pay-runs/${payment.pay_run.id}`} className="font-medium hover:underline">
                        {payment.pay_run.title}
                      </Link>
                      {payment.memo ? <p className="text-xs text-muted-foreground">{payment.memo}</p> : null}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">{formatPeriod(payment.pay_run.period_month)}</TableCell>
                    <TableCell>
                      <PayRunStatusBadge status={payment.pay_run.status} />
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      <Money amount={payment.amount} currency={payment.currency} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {contractor.status === "archived" ? (
        <Notice variant="warning" title="Archived">
          This contractor can&apos;t be added to new pay runs.
        </Notice>
      ) : null}
      {contractor.verification_status !== "verified" && current ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <ShieldQuestionIcon className="size-3.5" aria-hidden />
          Unverified contractors can be approved in a pay run, but will need provider verification before any payout.
        </p>
      ) : null}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
