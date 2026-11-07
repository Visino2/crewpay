/**
 * RFC 4180 CSV with protection against spreadsheet formula injection: a cell
 * that begins with =, +, -, @, tab or carriage return is prefixed with an
 * apostrophe so spreadsheet apps treat it as text (OWASP "CSV Injection").
 */

const FORMULA_TRIGGER = /^[=+\-@\t\r]/;

export function escapeCsvCell(value: string | number | null | undefined): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (FORMULA_TRIGGER.test(text)) {
    text = `'${text}`;
  }
  return `"${text.replaceAll('"', '""')}"`;
}

export function toCsv(header: readonly string[], rows: readonly (readonly (string | number | null)[])[]): string {
  const lines = [header, ...rows].map((row) => row.map(escapeCsvCell).join(","));
  // CRLF line endings per RFC 4180; trailing newline for tools that expect it.
  return `${lines.join("\r\n")}\r\n`;
}
