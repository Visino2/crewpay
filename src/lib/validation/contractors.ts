import { z } from "zod";

import {
  countryCodeSchema,
  emailSchema,
  optionalEmailSchema,
  personNameSchema,
  uuidSchema,
} from "./common";

export const createContractorSchema = z.object({
  organizationId: uuidSchema,
  fullName: personNameSchema,
  email: optionalEmailSchema,
  countryCode: countryCodeSchema,
});

export const updateContractorSchema = z.object({
  contractorId: uuidSchema,
  fullName: personNameSchema,
  email: optionalEmailSchema,
  countryCode: countryCodeSchema,
});

export const contractorIdSchema = z.object({
  contractorId: uuidSchema,
});

// --- Payout details -----------------------------------------------------------
// Field sets follow the Blaaiz "Create a payout" reference. The database
// enforces the same required keys per rail and currency.

const text = z.string().trim().min(1).max(140);
const accountNumber = z.string().trim().regex(/^\d{4,20}$/, "Use digits only");
const bic = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/, "Enter a valid BIC/SWIFT code");
const address = {
  country: text,
  street: text,
  city: text,
  zip_code: text,
};

const ngnBank = z.object({
  rail: z.literal("bank_transfer"),
  currency: z.literal("NGN"),
  details: z.strictObject({
    bank_id: z.string().trim().regex(/^[A-Za-z0-9_-]{1,32}$/),
    account_number: accountNumber,
    account_name: text,
  }),
});

const gbpBank = z.object({
  rail: z.literal("bank_transfer"),
  currency: z.literal("GBP"),
  details: z.strictObject({
    account_number: z.string().trim().regex(/^\d{8}$/, "UK account numbers have 8 digits"),
    sort_code: z
      .string()
      .trim()
      .regex(/^\d{2}-?\d{2}-?\d{2}$/, "Enter a 6-digit sort code")
      .transform((value) => value.replaceAll("-", "")),
    account_name: text,
    ...address,
  }),
});

const eurBank = z.object({
  rail: z.literal("bank_transfer"),
  currency: z.literal("EUR"),
  details: z.strictObject({
    iban: z
      .string()
      .transform((value) => value.replaceAll(" ", "").toUpperCase())
      .pipe(z.string().regex(/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/, "Enter a valid IBAN")),
    bic_code: bic,
    account_name: text,
    ...address,
  }),
});

const mobileMoney = z.object({
  rail: z.literal("mobile_money"),
  currency: z.enum(["KES", "UGX", "TZS", "XOF", "GHS"]),
  details: z.strictObject({
    phone_number: z
      .string()
      .trim()
      .regex(/^\+[1-9]\d{7,14}$/, "Use international format, e.g. +254712345678"),
    mobile_money_operator_id: z.string().trim().regex(/^\d{1,10}$/),
    account_name: text,
  }),
});

const usdAccount = {
  account_number: accountNumber,
  account_name: text,
  account_type: z.enum(["checking", "savings"]),
  bank_name: text,
  routing_number: z.string().trim().regex(/^\d{9}$/, "Routing numbers have 9 digits"),
  state: text,
  ...address,
};

const usdAch = z.object({
  rail: z.literal("ach"),
  currency: z.literal("USD"),
  details: z.strictObject(usdAccount),
});

const usdWire = z.object({
  rail: z.literal("wire"),
  currency: z.literal("USD"),
  details: z.strictObject({ ...usdAccount, swift_code: bic }),
});

const cadInterac = z.object({
  rail: z.literal("interac"),
  currency: z.literal("CAD"),
  details: z.strictObject({
    email: emailSchema,
    first_name: text,
    last_name: text,
  }),
});

export const payoutMethodSchema = z.union([
  ngnBank,
  gbpBank,
  eurBank,
  mobileMoney,
  usdAch,
  usdWire,
  cadInterac,
]);

export const setPayoutMethodSchema = z.object({
  contractorId: uuidSchema,
  payoutMethod: payoutMethodSchema,
});

export type CreateContractorInput = z.output<typeof createContractorSchema>;
export type UpdateContractorInput = z.output<typeof updateContractorSchema>;
export type PayoutMethodInput = z.output<typeof payoutMethodSchema>;
export type SetPayoutMethodInput = z.output<typeof setPayoutMethodSchema>;
