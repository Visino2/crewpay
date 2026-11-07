import { z } from "zod";

/** Search and filter options from the contractors page URL. */
export const contractorFiltersSchema = z.object({
  q: z.string().trim().max(100).catch(""),
  status: z.enum(["active", "archived", "all"]).catch("active"),
  payout: z.enum(["all", "ready", "missing"]).catch("all"),
  verification: z.enum(["all", "not_started", "pending", "verified", "rejected"]).catch("all"),
});

export type ContractorFilters = z.output<typeof contractorFiltersSchema>;

export function parseContractorFilters(params: Record<string, string | string[] | undefined>): ContractorFilters {
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  return contractorFiltersSchema.parse({
    q: first(params.q) ?? "",
    status: first(params.status) ?? "active",
    payout: first(params.payout) ?? "all",
    verification: first(params.verification) ?? "all",
  });
}

type Filterable = {
  full_name: string;
  email: string | null;
  country_code: string;
  status: "active" | "archived";
  verification_status: "not_started" | "pending" | "verified" | "rejected";
  currentPayoutMethod: unknown | null;
};

export function filterContractors<T extends Filterable>(contractors: readonly T[], filters: ContractorFilters): T[] {
  const query = filters.q.toLowerCase();
  return contractors.filter((contractor) => {
    if (filters.status !== "all" && contractor.status !== filters.status) {
      return false;
    }
    if (filters.payout === "ready" && !contractor.currentPayoutMethod) {
      return false;
    }
    if (filters.payout === "missing" && contractor.currentPayoutMethod) {
      return false;
    }
    if (filters.verification !== "all" && contractor.verification_status !== filters.verification) {
      return false;
    }
    if (!query) {
      return true;
    }
    return [contractor.full_name, contractor.email ?? "", contractor.country_code].some((field) =>
      field.toLowerCase().includes(query),
    );
  });
}
