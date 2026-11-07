/**
 * Payout methods the database accepts (private.payout_required_keys) and the
 * fields each one needs, from the Blaaiz "Create a payout" reference. The
 * form shows these; the server validates with payoutMethodSchema and the
 * database checks the exact key set again.
 */

export type PayoutField = {
  key: string;
  label: string;
  placeholder?: string;
  hint?: string;
  inputMode?: "numeric" | "text" | "email" | "tel";
  options?: { value: string; label: string }[];
  /** Account identifiers: never echoed back, excluded from autofill history. */
  sensitive?: boolean;
};

const address: PayoutField[] = [
  { key: "street", label: "Street address" },
  { key: "city", label: "City" },
  { key: "zip_code", label: "Postal code" },
  { key: "country", label: "Country", placeholder: "e.g. GB" },
];

const usdAccount: PayoutField[] = [
  { key: "account_name", label: "Account holder name" },
  { key: "bank_name", label: "Bank name" },
  { key: "routing_number", label: "Routing number", inputMode: "numeric", placeholder: "9 digits", sensitive: true },
  { key: "account_number", label: "Account number", inputMode: "numeric", sensitive: true },
  {
    key: "account_type",
    label: "Account type",
    options: [
      { value: "checking", label: "Checking" },
      { value: "savings", label: "Savings" },
    ],
  },
  { key: "state", label: "State", placeholder: "e.g. NY" },
  ...address,
];

export type PayoutOption = {
  id: string;
  rail: "bank_transfer" | "mobile_money" | "ach" | "wire" | "interac";
  currency: string;
  label: string;
  fields: PayoutField[];
};

const mobileMoney = (currency: string, country: string, example: string): PayoutOption => ({
  id: `mobile_money:${currency}`,
  rail: "mobile_money",
  currency,
  label: `${country} · Mobile money (${currency})`,
  fields: [
    { key: "account_name", label: "Name on the mobile money account" },
    {
      key: "phone_number",
      label: "Phone number",
      inputMode: "tel",
      placeholder: example,
      hint: "International format with a leading +",
      sensitive: true,
    },
    {
      key: "mobile_money_operator_id",
      label: "Mobile money operator ID",
      inputMode: "numeric",
      hint: "The operator ID from the payment provider's operator list",
    },
  ],
});

export const PAYOUT_OPTIONS: PayoutOption[] = [
  {
    id: "bank_transfer:NGN",
    rail: "bank_transfer",
    currency: "NGN",
    label: "Nigeria · Bank transfer (NGN)",
    fields: [
      { key: "account_name", label: "Account holder name" },
      { key: "bank_id", label: "Bank ID", hint: "The bank's ID from the payment provider's bank list" },
      { key: "account_number", label: "Account number (NUBAN)", inputMode: "numeric", sensitive: true },
    ],
  },
  mobileMoney("KES", "Kenya", "+254712345678"),
  mobileMoney("GHS", "Ghana", "+233241234567"),
  mobileMoney("UGX", "Uganda", "+256712345678"),
  mobileMoney("TZS", "Tanzania", "+255712345678"),
  mobileMoney("XOF", "West Africa (CFA)", "+221771234567"),
  {
    id: "bank_transfer:GBP",
    rail: "bank_transfer",
    currency: "GBP",
    label: "United Kingdom · Bank transfer (GBP)",
    fields: [
      { key: "account_name", label: "Account holder name" },
      { key: "sort_code", label: "Sort code", inputMode: "numeric", placeholder: "12-34-56", sensitive: true },
      { key: "account_number", label: "Account number", inputMode: "numeric", placeholder: "8 digits", sensitive: true },
      ...address,
    ],
  },
  {
    id: "bank_transfer:EUR",
    rail: "bank_transfer",
    currency: "EUR",
    label: "Eurozone · SEPA bank transfer (EUR)",
    fields: [
      { key: "account_name", label: "Account holder name" },
      { key: "iban", label: "IBAN", sensitive: true },
      { key: "bic_code", label: "BIC / SWIFT code" },
      ...address,
    ],
  },
  { id: "ach:USD", rail: "ach", currency: "USD", label: "United States · ACH (USD)", fields: usdAccount },
  {
    id: "wire:USD",
    rail: "wire",
    currency: "USD",
    label: "United States · Wire (USD)",
    fields: [...usdAccount, { key: "swift_code", label: "SWIFT code" }],
  },
  {
    id: "interac:CAD",
    rail: "interac",
    currency: "CAD",
    label: "Canada · Interac e-Transfer (CAD)",
    fields: [
      { key: "first_name", label: "First name" },
      { key: "last_name", label: "Last name" },
      { key: "email", label: "Interac email", inputMode: "email", sensitive: true },
    ],
  },
];
