import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { requirePermission } from "@/lib/auth/authorization";
import type { SessionUser } from "@/lib/auth/session";
import { getPeople, personName } from "@/features/organizations/data";

import { listExportLines, listPayRunSummaries } from "./data";
import { buildHistoryCsv } from "./history";

/**
 * Builds the history CSV for an organization. Membership is checked before
 * any data is read (non-members get `not_found`), and every query runs as the
 * signed-in user under RLS.
 */
export async function exportOrganizationHistory(
  db: SupabaseClient,
  user: SessionUser,
  organizationId: string,
): Promise<{ filename: string; csv: string }> {
  await requirePermission(db, user, organizationId, "exportHistory");

  const [runs, lines] = await Promise.all([
    listPayRunSummaries(db, organizationId, { limit: 1000 }),
    listExportLines(db, organizationId),
  ]);
  const people = await getPeople(db, [
    ...runs.flatMap((run) => run.allSubmissions.map((submission) => submission.submitted_by)),
    ...runs.flatMap((run) => run.allDecisions.map((decision) => decision.decided_by)),
  ]);

  const date = new Date().toISOString().slice(0, 10);
  return {
    filename: `crewpay-pay-run-history-${date}.csv`,
    csv: buildHistoryCsv(runs, lines, (userId) => personName(people, userId)),
  };
}
