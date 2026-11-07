import { FingerprintIcon } from "lucide-react";

import { Money } from "@/components/app/money";
import { StatusBadge } from "@/components/app/status-badge";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { countryName } from "@/lib/format/countries";
import { RAIL_LABELS, VERIFICATION_STATUS, type VerificationStatus } from "@/lib/format/status";

import type { Snapshot } from "../data";

function isVerification(value: string): value is VerificationStatus {
  return value in VERIFICATION_STATUS;
}

/** The frozen record stored at submission. Totals are the database's own. */
export function SnapshotView({ snapshot, snapshotHash }: { snapshot: Snapshot; snapshotHash: string }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow className="bg-secondary/50 hover:bg-secondary/50">
              <TableHead className="pl-4">Contractor</TableHead>
              <TableHead>Payout details</TableHead>
              <TableHead className="hidden md:table-cell">Verification</TableHead>
              <TableHead className="hidden lg:table-cell">Reference</TableHead>
              <TableHead className="pr-4 text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {snapshot.items.map((item) => {
              const verification = isVerification(item.verification_status)
                ? VERIFICATION_STATUS[item.verification_status]
                : { label: item.verification_status, tone: "neutral" as const };
              return (
                <TableRow key={item.item_id}>
                  <TableCell className="pl-4">
                    <span className="font-medium">{item.contractor_name}</span>
                    <span className="block text-xs text-muted-foreground">{countryName(item.contractor_country)}</span>
                  </TableCell>
                  <TableCell>
                    <span className="font-mono text-xs">{item.payout_display}</span>
                    <span className="block text-xs text-muted-foreground">
                      {RAIL_LABELS[item.rail as keyof typeof RAIL_LABELS] ?? item.rail} · v{item.payout_method_version}
                    </span>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <StatusBadge tone={verification.tone}>{verification.label}</StatusBadge>
                  </TableCell>
                  <TableCell className="hidden max-w-48 truncate text-muted-foreground lg:table-cell">{item.memo ?? "—"}</TableCell>
                  <TableCell className="pr-4 text-right font-medium">
                    <Money amount={item.amount} currency={item.currency} />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
          <TableFooter>
            {snapshot.totals.map((total) => (
              <TableRow key={total.currency} className="hover:bg-transparent">
                <TableCell colSpan={4} className="pl-4 text-sm text-muted-foreground">
                  Total {total.currency} · {total.items} {total.items === 1 ? "line" : "lines"}
                </TableCell>
                <TableCell className="pr-4 text-right font-semibold">
                  <Money amount={total.amount} currency={total.currency} />
                </TableCell>
              </TableRow>
            ))}
          </TableFooter>
        </Table>
      </div>
      <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <FingerprintIcon className="size-3.5" aria-hidden />
        Snapshot fingerprint
        <code className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[11px] break-all text-foreground" title={snapshotHash}>
          {snapshotHash}
        </code>
      </p>
    </div>
  );
}
