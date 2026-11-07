import { AlertTriangleIcon } from "lucide-react";

import { VerificationBadge } from "@/components/app/badges";
import { Money } from "@/components/app/money";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { CurrencyTotal } from "@/lib/money";

import type { PayRunLine } from "../data";
import { EditLineButton, RemoveLineButton } from "./line-editor";

/** Live lines of a pay run (drafts). Totals are exact per currency. */
export function LinesTable({
  payRunId,
  lines,
  totals,
  editable,
}: {
  payRunId: string;
  lines: PayRunLine[];
  totals: CurrencyTotal[];
  editable: boolean;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow className="bg-secondary/50 hover:bg-secondary/50">
            <TableHead className="pl-4">Contractor</TableHead>
            <TableHead>Payout details</TableHead>
            <TableHead className="hidden md:table-cell">Verification</TableHead>
            <TableHead className="hidden lg:table-cell">Reference</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            {editable ? <TableHead className="w-28 pr-4"><span className="sr-only">Actions</span></TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.map((line) => {
            const stale = !line.payout_method.is_current;
            const archived = line.contractor.status === "archived";
            return (
              <TableRow key={line.id} className={stale || archived ? "bg-warning-soft/40" : undefined}>
                <TableCell className="pl-4">
                  <span className="font-medium">{line.contractor.full_name}</span>
                  {archived ? <span className="block text-xs text-warning">Archived contractor</span> : null}
                </TableCell>
                <TableCell>
                  <span className="font-mono text-xs">{line.payout_method.display_label}</span>
                  {stale ? (
                    <span className="flex items-center gap-1 text-xs text-warning">
                      <AlertTriangleIcon className="size-3" aria-hidden />
                      Payout details changed
                    </span>
                  ) : null}
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  <VerificationBadge status={line.contractor.verification_status} />
                </TableCell>
                <TableCell className="hidden max-w-48 truncate text-muted-foreground lg:table-cell">{line.memo ?? "—"}</TableCell>
                <TableCell className="text-right font-medium">
                  <Money amount={line.amount} currency={line.currency} />
                </TableCell>
                {editable ? (
                  <TableCell className="pr-4">
                    <div className="flex justify-end gap-1">
                      {archived ? null : (
                        <EditLineButton
                          payRunId={payRunId}
                          contractorId={line.contractor_id}
                          contractorName={line.contractor.full_name}
                          currency={line.currency}
                          amount={line.amount}
                          memo={line.memo}
                          stale={stale}
                        />
                      )}
                      <RemoveLineButton itemId={line.id} contractorName={line.contractor.full_name} />
                    </div>
                  </TableCell>
                ) : null}
              </TableRow>
            );
          })}
        </TableBody>
        {totals.length > 0 ? (
          <TableFooter>
            {totals.map((total) => (
              <TableRow key={total.currency} className="hover:bg-transparent">
                <TableCell colSpan={4} className="pl-4 text-sm text-muted-foreground">
                  Total {total.currency} · {total.count} {total.count === 1 ? "line" : "lines"}
                </TableCell>
                <TableCell className="text-right font-semibold">
                  <Money amount={total.amount} currency={total.currency} />
                </TableCell>
                {editable ? <TableCell /> : null}
              </TableRow>
            ))}
          </TableFooter>
        ) : null}
      </Table>
    </div>
  );
}
