// All dates render in UTC with an explicit label, so server and browser agree
// and records are unambiguous for finance teams across time zones.

const dateFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const dateTimeFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "UTC",
});

const monthFormat = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

export function formatDate(value: string | null | undefined): string {
  return value ? dateFormat.format(new Date(value)) : "—";
}

export function formatDateTime(value: string | null | undefined): string {
  return value ? `${dateTimeFormat.format(new Date(value))} UTC` : "—";
}

/** "2026-11-01" -> "November 2026" */
export function formatPeriod(periodMonth: string): string {
  return monthFormat.format(new Date(`${periodMonth.slice(0, 10)}T00:00:00Z`));
}

/** "2026-11-01" -> "2026-11" for <input type="month"> */
export function toMonthInput(periodMonth: string): string {
  return periodMonth.slice(0, 7);
}
