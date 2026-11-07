import { z } from "zod";

import { ORG_ROLES } from "@/lib/auth/permissions";

export const uuidSchema = z.uuid();

export const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());

/** Empty strings become null so forms can leave the field blank. */
export const optionalEmailSchema = z
  .string()
  .trim()
  .transform((value) => (value === "" ? null : value))
  .pipe(emailSchema.nullable())
  .nullish()
  .transform((value) => value ?? null);

export const personNameSchema = z.string().trim().min(2).max(120);

export const titleSchema = z.string().trim().min(2).max(120);

export const countryCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/, "Use a two-letter ISO country code");

export const currencyCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, "Use a three-letter ISO currency code");

/**
 * A positive decimal amount with at most 2 decimal places, kept as a string
 * so it never passes through floating-point arithmetic.
 */
export const amountSchema = z
  .string()
  .trim()
  .regex(/^\d{1,10}(\.\d{1,2})?$/, "Enter an amount with up to 2 decimal places")
  .refine((value) => Number(value) > 0, "Amount must be greater than zero")
  .refine((value) => Number(value) <= 1_000_000_000, "Amount is too large");

/** `YYYY-MM` from a month picker, normalized to the first day of that month. */
export const periodMonthSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use the format YYYY-MM")
  .transform((value) => `${value}-01`);

export const memoSchema = z
  .string()
  .trim()
  .max(140)
  .transform((value) => (value === "" ? null : value))
  .nullish()
  .transform((value) => value ?? null);

export const orgRoleSchema = z.enum(ORG_ROLES);

export const snapshotHashSchema = z.string().regex(/^[0-9a-f]{64}$/);
