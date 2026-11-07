/**
 * Exact money handling for display and totals. Amounts are decimal strings
 * with at most two decimal places (the database stores numeric(18, 2)), and
 * arithmetic uses integer minor units (BigInt), never floating point.
 *
 * These totals are informational. The database computes the authoritative
 * totals when a pay run is submitted (see the submission snapshot).
 */

const AMOUNT_PATTERN = /^(\d{1,12})(?:\.(\d{1,2}))?$/;

/** "150000.5" -> 15000050n. Throws on anything that is not a valid amount. */
export function toMinorUnits(amount: string | number): bigint {
  const text = typeof amount === "number" ? amount.toFixed(2) : amount.trim();
  const match = AMOUNT_PATTERN.exec(text);
  if (!match) {
    throw new Error("Invalid amount");
  }
  const [, whole, fraction = ""] = match;
  return BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, "0"));
}

/** 15000050n -> "150000.50" */
export function fromMinorUnits(minor: bigint): string {
  const sign = minor < 0n ? "-" : "";
  const absolute = minor < 0n ? -minor : minor;
  const whole = absolute / 100n;
  const fraction = (absolute % 100n).toString().padStart(2, "0");
  return `${sign}${whole}.${fraction}`;
}

export type CurrencyTotal = { currency: string; amount: string; count: number };

/** Totals per currency, sorted by currency code. Never mixes currencies. */
export function totalsByCurrency(
  lines: readonly { amount: string | number; currency: string }[],
): CurrencyTotal[] {
  const totals = new Map<string, { minor: bigint; count: number }>();
  for (const line of lines) {
    const current = totals.get(line.currency) ?? { minor: 0n, count: 0 };
    totals.set(line.currency, {
      minor: current.minor + toMinorUnits(line.amount),
      count: current.count + 1,
    });
  }
  return [...totals.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, total]) => ({ currency, amount: fromMinorUnits(total.minor), count: total.count }));
}

/** Combines several per-currency totals (e.g. across pay runs). */
export function mergeTotals(groups: readonly CurrencyTotal[][]): CurrencyTotal[] {
  const merged = new Map<string, { minor: bigint; count: number }>();
  for (const total of groups.flat()) {
    const current = merged.get(total.currency) ?? { minor: 0n, count: 0 };
    merged.set(total.currency, {
      minor: current.minor + toMinorUnits(total.amount),
      count: current.count + total.count,
    });
  }
  return [...merged.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, total]) => ({ currency, amount: fromMinorUnits(total.minor), count: total.count }));
}

const grouping = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * "150000.5", "NGN" -> "NGN 150,000.50". Uses the ISO code rather than a
 * symbol so currencies are never ambiguous, and formats the exact decimal
 * string (Intl formats string input without converting to a float).
 */
export function formatMoney(amount: string | number, currency: string): string {
  const exact = fromMinorUnits(toMinorUnits(amount)) as Intl.StringNumericLiteral;
  return `${currency} ${grouping.format(exact)}`;
}
