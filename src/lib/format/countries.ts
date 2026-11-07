/**
 * Countries offered when adding a contractor: markets reachable through the
 * payout rails CrewPay plans to support, plus common contractor locations.
 * Names come from Intl so they stay correct without a hard-coded table.
 */
const COUNTRY_CODES = [
  "NG", "GH", "KE", "UG", "TZ", "RW", "ZA", "EG", "MA", "CI", "SN", "BJ", "CM", "ET",
  "GB", "IE", "DE", "FR", "NL", "ES", "IT", "PT", "PL", "SE",
  "US", "CA", "MX", "BR", "AR", "CO",
  "IN", "PK", "BD", "PH", "ID", "VN", "AE", "SA", "TR", "UA",
] as const;

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });

export function countryName(code: string): string {
  try {
    return regionNames.of(code) ?? code;
  } catch {
    return code;
  }
}

export const COUNTRY_OPTIONS = COUNTRY_CODES.map((code) => ({ code, name: countryName(code) })).sort((a, b) =>
  a.name.localeCompare(b.name),
);
