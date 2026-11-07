"use server";

import { runAction, type ActionResult } from "@/lib/actions";
import { getOwningOrganization, requirePermission } from "@/lib/auth/authorization";
import {
  contractorIdSchema,
  createContractorSchema,
  setPayoutMethodSchema,
  updateContractorSchema,
} from "@/lib/validation/contractors";

import { archiveContractor, createContractor, setPayoutMethod, updateContractor } from "./data";

export async function createContractorAction(input: unknown): Promise<ActionResult<string>> {
  return runAction(createContractorSchema, input, async (data, { db, user }) => {
    await requirePermission(db, user, data.organizationId, "prepare");
    return createContractor(db, data);
  });
}

export async function updateContractorAction(input: unknown): Promise<ActionResult<null>> {
  return runAction(updateContractorSchema, input, async (data, { db, user }) => {
    const organizationId = await getOwningOrganization(db, "contractors", data.contractorId);
    await requirePermission(db, user, organizationId, "prepare");
    await updateContractor(db, data);
    return null;
  });
}

export async function archiveContractorAction(input: unknown): Promise<ActionResult<null>> {
  return runAction(contractorIdSchema, input, async ({ contractorId }, { db, user }) => {
    const organizationId = await getOwningOrganization(db, "contractors", contractorId);
    await requirePermission(db, user, organizationId, "prepare");
    await archiveContractor(db, contractorId);
    return null;
  });
}

export async function setPayoutMethodAction(input: unknown): Promise<ActionResult<string>> {
  return runAction(setPayoutMethodSchema, input, async (data, { db, user }) => {
    const organizationId = await getOwningOrganization(db, "contractors", data.contractorId);
    await requirePermission(db, user, organizationId, "prepare");
    return setPayoutMethod(db, data);
  });
}
