import { describe, expect, it } from "vitest";

import { escapeCsvCell, toCsv } from "@/lib/csv";

describe("CSV export safety", () => {
  it("quotes every cell and doubles embedded quotes", () => {
    expect(escapeCsvCell('He said "hi", then left')).toBe('"He said ""hi"", then left"');
    expect(escapeCsvCell("line one\nline two")).toBe('"line one\nline two"');
    expect(escapeCsvCell(null)).toBe('""');
  });

  it.each(["=SUM(A1:A9)", "+1+1", "-2+3", "@cmd", "\tTAB", "\rCR"])(
    "neutralises the spreadsheet formula %j",
    (value) => {
      expect(escapeCsvCell(value).startsWith(`"'`)).toBe(true);
    },
  );

  it("leaves ordinary values alone", () => {
    expect(escapeCsvCell("150000.50")).toBe('"150000.50"');
    expect(escapeCsvCell("Ada Okafor")).toBe('"Ada Okafor"');
  });

  it("uses CRLF line endings with a header row", () => {
    expect(toCsv(["A", "B"], [["1", null]])).toBe('"A","B"\r\n"1",""\r\n');
  });
});
