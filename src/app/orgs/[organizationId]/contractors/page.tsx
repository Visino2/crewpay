import { SearchIcon, UserPlusIcon, UsersIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { ContractorStatusBadge, VerificationBadge } from "@/components/app/badges";
import { EmptyState } from "@/components/app/empty-state";
import { NativeSelect } from "@/components/app/form-controls";
import { LinkButton } from "@/components/app/link-button";
import { PageHeader } from "@/components/app/page-header";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listContractorOverviews } from "@/features/contractors/data";
import { filterContractors, parseContractorFilters } from "@/features/contractors/filters";
import { getOrgContext } from "@/features/organizations/context";
import { countryName } from "@/lib/format/countries";
import { formatDate } from "@/lib/format/dates";

export const metadata: Metadata = { title: "Contractors" };

export default async function ContractorsPage({
  params,
  searchParams,
}: PageProps<"/orgs/[organizationId]/contractors">) {
  const { organizationId } = await params;
  const context = await getOrgContext(organizationId);
  const filters = parseContractorFilters(await searchParams);
  const all = await listContractorOverviews(context.db, organizationId);
  const contractors = filterContractors(all, filters);
  const base = `/orgs/${organizationId}/contractors`;
  const filtered = filters.q !== "" || filters.payout !== "all" || filters.verification !== "all" || filters.status !== "active";

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Contractors"
        description="People your organization pays. Payout details are stored securely and only ever shown masked."
        actions={
          context.can("prepare") ? (
            <LinkButton href={`${base}/new`}>
              <UserPlusIcon aria-hidden />
              Add contractor
            </LinkButton>
          ) : null
        }
      />

      {all.length === 0 ? (
        <EmptyState
          icon={UsersIcon}
          title="No contractors yet"
          description="Add the people you pay, with their payout details, to start preparing pay runs."
          action={context.can("prepare") ? <LinkButton href={`${base}/new`}>Add your first contractor</LinkButton> : undefined}
        />
      ) : (
        <div className="flex flex-col gap-4">
          <form role="search" className="grid gap-3 rounded-xl border bg-card p-3 sm:grid-cols-2 lg:grid-cols-[1fr_auto_auto_auto_auto]">
            <label className="relative">
              <span className="sr-only">Search contractors</span>
              <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input name="q" defaultValue={filters.q} placeholder="Search name, email or country code" className="h-9 pl-9" maxLength={100} />
            </label>
            <NativeSelect name="status" defaultValue={filters.status} aria-label="Status">
              <option value="active">Active</option>
              <option value="archived">Archived</option>
              <option value="all">All statuses</option>
            </NativeSelect>
            <NativeSelect name="payout" defaultValue={filters.payout} aria-label="Payout details">
              <option value="all">Any payout details</option>
              <option value="ready">Payout details added</option>
              <option value="missing">Payout details missing</option>
            </NativeSelect>
            <NativeSelect name="verification" defaultValue={filters.verification} aria-label="Verification">
              <option value="all">Any verification</option>
              <option value="not_started">Not verified</option>
              <option value="pending">Verification pending</option>
              <option value="verified">Verified</option>
              <option value="rejected">Verification failed</option>
            </NativeSelect>
            <div className="flex gap-2">
              <Button type="submit" variant="secondary" className="h-9 flex-1">
                Apply
              </Button>
              {filtered ? (
                <LinkButton href={base} variant="ghost" className="h-9">
                  Reset
                </LinkButton>
              ) : null}
            </div>
          </form>

          {contractors.length === 0 ? (
            <EmptyState icon={SearchIcon} title="No matching contractors" description="Try a different search or filter." />
          ) : (
            <div className="overflow-hidden rounded-xl border bg-card">
              <Table>
                <TableHeader>
                  <TableRow className="bg-secondary/50 hover:bg-secondary/50">
                    <TableHead className="pl-4">Contractor</TableHead>
                    <TableHead className="hidden md:table-cell">Country</TableHead>
                    <TableHead>Payout details</TableHead>
                    <TableHead className="hidden lg:table-cell">Verification</TableHead>
                    <TableHead className="hidden sm:table-cell">Status</TableHead>
                    <TableHead className="hidden pr-4 text-right xl:table-cell">Updated</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {contractors.map((contractor) => (
                    <TableRow key={contractor.id}>
                      <TableCell className="pl-4">
                        <Link href={`${base}/${contractor.id}`} className="flex flex-col font-medium hover:underline">
                          {contractor.full_name}
                          <span className="text-xs font-normal text-muted-foreground">{contractor.email ?? "No email"}</span>
                        </Link>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">{countryName(contractor.country_code)}</TableCell>
                      <TableCell>
                        {contractor.currentPayoutMethod ? (
                          <span className="font-mono text-xs">{contractor.currentPayoutMethod.display_label}</span>
                        ) : (
                          <StatusBadge tone="warning">Missing</StatusBadge>
                        )}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        <VerificationBadge status={contractor.verification_status} />
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        <ContractorStatusBadge status={contractor.status} />
                      </TableCell>
                      <TableCell className="hidden pr-4 text-right text-muted-foreground xl:table-cell">
                        {formatDate(contractor.updated_at)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <p className="border-t px-4 py-2.5 text-xs text-muted-foreground">
                Showing {contractors.length} of {all.length} contractors
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
