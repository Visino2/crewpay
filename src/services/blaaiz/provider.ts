import "server-only";

import type { FeeQuoteResult, PaymentProvider } from "@/services/payments/provider";

import type { BlaaizConfig } from "./config";

/**
 * Blaaiz adapter. No API calls are implemented yet: they will be added and
 * tested against the Blaaiz sandbox once credentials are issued. Until then
 * every request reports that quotes are unavailable rather than inventing
 * rates or fees.
 */
export function createBlaaizProvider(config: BlaaizConfig | null): PaymentProvider {
  return {
    name: "blaaiz",
    async getFeeQuote(): Promise<FeeQuoteResult> {
      return { status: "unavailable", reason: config ? "not_implemented" : "not_configured" };
    },
  };
}
