import { formatMoney, type CurrencyTotal } from "@/lib/money";
import { cn } from "@/lib/utils";

export function Money({ amount, currency, className }: { amount: string; currency: string; className?: string }) {
  return <span className={cn("tabular-nums whitespace-nowrap", className)}>{formatMoney(amount, currency)}</span>;
}

/**
 * One line per currency; currencies are never added together. Runs paying in
 * more than three currencies use two columns to stay compact.
 */
export function CurrencyTotals({
  totals,
  className,
  align = "start",
  emptyLabel = "—",
}: {
  totals: readonly CurrencyTotal[];
  className?: string;
  align?: "start" | "end";
  emptyLabel?: string;
}) {
  if (totals.length === 0) {
    return <span className="text-muted-foreground">{emptyLabel}</span>;
  }
  const compact = totals.length > 3;
  return (
    <span
      className={cn(
        compact ? "grid grid-cols-[auto_auto] gap-x-5 gap-y-0.5" : "flex flex-col gap-0.5",
        align === "end" && (compact ? "justify-end justify-items-end" : "items-end"),
        className,
      )}
    >
      {totals.map((total) => (
        <Money key={total.currency} amount={total.amount} currency={total.currency} />
      ))}
    </span>
  );
}
