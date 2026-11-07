import { describe, expect, it } from "vitest";

import { formatMoney, fromMinorUnits, mergeTotals, toMinorUnits, totalsByCurrency } from "@/lib/money";

describe("exact money arithmetic", () => {
  it("converts decimal strings to minor units and back without loss", () => {
    expect(toMinorUnits("150000.5")).toBe(15000050n);
    expect(toMinorUnits("0.10")).toBe(10n);
    expect(toMinorUnits("1000000000.00")).toBe(100000000000n);
    expect(fromMinorUnits(15000050n)).toBe("150000.50");
    expect(fromMinorUnits(5n)).toBe("0.05");
  });

  it("rejects values that are not valid amounts", () => {
    for (const value of ["", "abc", "1.005", "1e5", "-1", "1,000.00"]) {
      expect(() => toMinorUnits(value)).toThrow();
    }
  });

  it("totals per currency exactly, where floats would drift", () => {
    // 0.1 + 0.2 = 0.30000000000000004 in floating point.
    const totals = totalsByCurrency([
      { amount: "0.10", currency: "NGN" },
      { amount: "0.20", currency: "NGN" },
      { amount: "250000.05", currency: "NGN" },
      { amount: "4200.00", currency: "GHS" },
    ]);
    expect(totals).toEqual([
      { currency: "GHS", amount: "4200.00", count: 1 },
      { currency: "NGN", amount: "250000.35", count: 3 },
    ]);
  });

  it("never adds different currencies together", () => {
    const merged = mergeTotals([
      [{ currency: "NGN", amount: "100.00", count: 1 }],
      [
        { currency: "NGN", amount: "0.01", count: 1 },
        { currency: "KES", amount: "50.00", count: 2 },
      ],
    ]);
    expect(merged).toEqual([
      { currency: "KES", amount: "50.00", count: 2 },
      { currency: "NGN", amount: "100.01", count: 2 },
    ]);
  });

  it("formats with the ISO code and exact decimals", () => {
    expect(formatMoney("150000.5", "NGN")).toBe("NGN 150,000.50");
    expect(formatMoney("999999999.99", "UGX")).toBe("UGX 999,999,999.99");
    expect(formatMoney("0.10", "USD")).toBe("USD 0.10");
  });
});
