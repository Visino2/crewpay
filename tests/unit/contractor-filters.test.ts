import { describe, expect, it } from "vitest";

import { filterContractors, parseContractorFilters } from "@/features/contractors/filters";

const contractors = [
  { full_name: "Ada Okafor", email: "ada@x.example", country_code: "NG", status: "active", verification_status: "not_started", currentPayoutMethod: {} },
  { full_name: "Sofia Haddad", email: null, country_code: "MA", status: "active", verification_status: "not_started", currentPayoutMethod: null },
  { full_name: "Tom Becker", email: "tom@x.example", country_code: "DE", status: "archived", verification_status: "verified", currentPayoutMethod: {} },
] as const;

const names = (list: readonly { full_name: string }[]) => list.map((contractor) => contractor.full_name);

describe("contractor filters", () => {
  it("defaults to active contractors and falls back safely on bad input", () => {
    expect(parseContractorFilters({})).toEqual({ q: "", status: "active", payout: "all", verification: "all" });
    expect(parseContractorFilters({ status: "deleted", payout: ["missing", "ready"], q: "x".repeat(500) })).toEqual({
      q: "",
      status: "active",
      payout: "missing",
      verification: "all",
    });
  });

  it("searches name, email and country code case-insensitively", () => {
    expect(names(filterContractors(contractors, parseContractorFilters({ q: "OKAF" })))).toEqual(["Ada Okafor"]);
    expect(names(filterContractors(contractors, parseContractorFilters({ q: "ma" })))).toEqual(["Sofia Haddad"]);
  });

  it("filters by status, payout details and verification", () => {
    expect(names(filterContractors(contractors, parseContractorFilters({ payout: "missing" })))).toEqual(["Sofia Haddad"]);
    expect(names(filterContractors(contractors, parseContractorFilters({ status: "all", verification: "verified" })))).toEqual([
      "Tom Becker",
    ]);
  });
});
