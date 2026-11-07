"use server";

import { runAction, type ActionResult } from "@/lib/actions";
import { getOwningOrganization, requirePermission } from "@/lib/auth/authorization";
import {
  approvePayRunSchema,
  createPayRunSchema,
  payRunIdSchema,
  payRunItemIdSchema,
  rejectPayRunSchema,
  upsertPayRunItemSchema,
} from "@/lib/validation/pay-runs";

import {
  approvePayRun,
  createPayRun,
  rejectPayRun,
  removePayRunItem,
  submitPayRun,
  transitionPayRun,
  upsertPayRunItem,
} from "./data";

// Role pre-checks below fail early; the database functions repeat them and
// also enforce draft-only edits, snapshot integrity and separation of duties.

export async function createPayRunAction(input: unknown): Promise<ActionResult<string>> {
  return runAction(createPayRunSchema, input, async (data, { db, user }) => {
    await requirePermission(db, user, data.organizationId, "prepare");
    return createPayRun(db, data);
  });
}

export async function upsertPayRunItemAction(input: unknown): Promise<ActionResult<string>> {
  return runAction(upsertPayRunItemSchema, input, async (data, { db, user }) => {
    const organizationId = await getOwningOrganization(db, "pay_runs", data.payRunId);
    await requirePermission(db, user, organizationId, "prepare");
    return upsertPayRunItem(db, data);
  });
}

export async function removePayRunItemAction(input: unknown): Promise<ActionResult<null>> {
  return runAction(payRunItemIdSchema, input, async ({ itemId }, { db, user }) => {
    const organizationId = await getOwningOrganization(db, "pay_run_items", itemId);
    await requirePermission(db, user, organizationId, "prepare");
    await removePayRunItem(db, itemId);
    return null;
  });
}

export async function submitPayRunAction(input: unknown): Promise<ActionResult<string>> {
  return runAction(payRunIdSchema, input, async ({ payRunId }, { db, user }) => {
    const organizationId = await getOwningOrganization(db, "pay_runs", payRunId);
    await requirePermission(db, user, organizationId, "prepare");
    return submitPayRun(db, payRunId);
  });
}

async function transition(
  input: unknown,
  fn: "withdraw_pay_run" | "reopen_pay_run" | "cancel_pay_run",
): Promise<ActionResult<null>> {
  return runAction(payRunIdSchema, input, async ({ payRunId }, { db, user }) => {
    const organizationId = await getOwningOrganization(db, "pay_runs", payRunId);
    await requirePermission(db, user, organizationId, "prepare");
    await transitionPayRun(db, fn, payRunId);
    return null;
  });
}

export async function withdrawPayRunAction(input: unknown): Promise<ActionResult<null>> {
  return transition(input, "withdraw_pay_run");
}

export async function reopenPayRunAction(input: unknown): Promise<ActionResult<null>> {
  return transition(input, "reopen_pay_run");
}

export async function cancelPayRunAction(input: unknown): Promise<ActionResult<null>> {
  return transition(input, "cancel_pay_run");
}

export async function approvePayRunAction(input: unknown): Promise<ActionResult<string>> {
  return runAction(approvePayRunSchema, input, async (data, { db, user }) => {
    const organizationId = await getOwningOrganization(db, "pay_runs", data.payRunId);
    await requirePermission(db, user, organizationId, "decide");
    return approvePayRun(db, data);
  });
}

export async function rejectPayRunAction(input: unknown): Promise<ActionResult<string>> {
  return runAction(rejectPayRunSchema, input, async (data, { db, user }) => {
    const organizationId = await getOwningOrganization(db, "pay_runs", data.payRunId);
    await requirePermission(db, user, organizationId, "decide");
    return rejectPayRun(db, data);
  });
}
