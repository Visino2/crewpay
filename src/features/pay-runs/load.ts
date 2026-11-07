import "server-only";

import { notFound } from "next/navigation";

import { getOrgContext, type OrgContext } from "@/features/organizations/context";
import { uuidSchema } from "@/lib/validation/common";

import { getPayRunDetail, type PayRunDetail } from "./data";

/**
 * Loads a pay run for a page. Invalid IDs, runs hidden by RLS and runs that
 * belong to a different organization than the URL all render 404.
 */
export async function loadPayRunPage(
  organizationId: string,
  payRunId: string,
): Promise<{ context: OrgContext; detail: PayRunDetail }> {
  const context = await getOrgContext(organizationId);
  if (!uuidSchema.safeParse(payRunId).success) {
    notFound();
  }
  const detail = await getPayRunDetail(context.db, payRunId);
  if (!detail || detail.payRun.organization_id !== organizationId) {
    notFound();
  }
  return { context, detail };
}
