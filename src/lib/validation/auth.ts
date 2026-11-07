import { z } from "zod";

import { emailSchema, personNameSchema } from "./common";

export const signInSchema = z.object({
  email: emailSchema,
  // Sign-in accepts any length the account might have; strength is checked at sign-up.
  password: z.string().min(1).max(128),
  next: z.string().max(512).optional(),
});

export const PASSWORD_MIN_LENGTH = 12;

export const signUpSchema = z.object({
  fullName: personNameSchema,
  email: emailSchema,
  password: z.string().min(PASSWORD_MIN_LENGTH).max(128),
});

export const EMAIL_OTP_TYPES = ["signup", "email", "recovery", "invite", "email_change"] as const;

export const emailOtpTypeSchema = z.enum(EMAIL_OTP_TYPES);
