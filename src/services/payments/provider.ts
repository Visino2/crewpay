/**
 * Provider-neutral boundary for payment infrastructure. Business logic depends
 * on this interface, never on a specific provider's API.
 *
 * Amounts are decimal strings. A quote only exists when a provider returned
 * one; otherwise the result says why it is unavailable.
 */

export type FeeQuoteRequest = {
  sourceCurrency: string;
  destinationCurrency: string;
  /** The exact amount the recipient should receive. */
  recipientAmount: string;
};

export type FeeQuote = {
  provider: string;
  recipientAmount: string;
  sourceAmount: string;
  totalFees: string;
  rate: string;
  quotedAt: string;
};

export type ProviderUnavailableReason =
  /** Credentials are not configured for this environment. */
  | "not_configured"
  /** Configured, but the integration has not been built and verified yet. */
  | "not_implemented";

export type FeeQuoteResult =
  | { status: "quoted"; quote: FeeQuote }
  | { status: "unavailable"; reason: ProviderUnavailableReason };

export interface PaymentProvider {
  readonly name: string;
  getFeeQuote(request: FeeQuoteRequest): Promise<FeeQuoteResult>;
}
