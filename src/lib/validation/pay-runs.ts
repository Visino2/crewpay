import { z } from "zod";

import {
  amountSchema,
  currencyCodeSchema,
  memoSchema,
  periodMonthSchema,
  snapshotHashSchema,
  titleSchema,
  uuidSchema,
} from "./common";

export const createPayRunSchema = z.object({
  organizationId: uuidSchema,
  title: titleSchema,
  periodMonth: periodMonthSchema,
  fundingCurrency: currencyCodeSchema,
});

export const upsertPayRunItemSchema = z.object({
  payRunId: uuidSchema,
  contractorId: uuidSchema,
  amount: amountSchema,
  memo: memoSchema,
});

export const payRunItemIdSchema = z.object({
  itemId: uuidSchema,
});

export const payRunIdSchema = z.object({
  payRunId: uuidSchema,
});

/** An approver confirms the exact submission and snapshot they reviewed. */
export const approvePayRunSchema = z.object({
  payRunId: uuidSchema,
  submissionId: uuidSchema,
  snapshotHash: snapshotHashSchema,
});

export const rejectPayRunSchema = approvePayRunSchema.extend({
  comment: z.string().trim().min(1, "Explain why the pay run is rejected").max(500),
});

export type CreatePayRunInput = z.output<typeof createPayRunSchema>;
export type UpsertPayRunItemInput = z.output<typeof upsertPayRunItemSchema>;
export type ApprovePayRunInput = z.output<typeof approvePayRunSchema>;
export type RejectPayRunInput = z.output<typeof rejectPayRunSchema>;
