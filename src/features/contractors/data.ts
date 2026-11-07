import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { callRpc, throwIfError } from "@/lib/supabase/rpc";
import { uuidSchema } from "@/lib/validation/common";
import type {
  CreateContractorInput,
  SetPayoutMethodInput,
  UpdateContractorInput,
} from "@/lib/validation/contractors";

const payRunStatusSchema = z.enum(["draft", "pending_approval", "approved", "rejected", "cancelled"]);

const contractorSchema = z.object({
  id: uuidSchema,
  organization_id: uuidSchema,
  full_name: z.string(),
  email: z.string().nullable(),
  country_code: z.string(),
  status: z.enum(["active", "archived"]),
  verification_status: z.enum(["not_started", "pending", "verified", "rejected"]),
  created_by: uuidSchema,
  updated_by: uuidSchema,
  created_at: z.string(),
  updated_at: z.string(),
});

// Raw `details` are not readable by application users; only the masked label is.
const payoutMethodSchema = z.object({
  id: uuidSchema,
  version: z.number().int(),
  rail: z.enum(["bank_transfer", "mobile_money", "ach", "wire", "interac"]),
  currency: z.string(),
  display_label: z.string(),
  is_current: z.boolean(),
  created_by: uuidSchema,
  created_at: z.string(),
  superseded_at: z.string().nullable(),
});

export type Contractor = z.output<typeof contractorSchema>;
export type PayoutMethodSummary = z.output<typeof payoutMethodSchema>;
export type ContractorOverview = Contractor & { currentPayoutMethod: PayoutMethodSummary | null };

const CONTRACTOR_COLUMNS =
  "id, organization_id, full_name, email, country_code, status, verification_status, created_by, updated_by, created_at, updated_at";
const PAYOUT_METHOD_COLUMNS = "id, version, rail, currency, display_label, is_current, created_by, created_at, superseded_at";

const overviewSchema = contractorSchema.extend({ payout_methods: z.array(payoutMethodSchema) });

function toOverview(row: z.output<typeof overviewSchema>): ContractorOverview {
  const { payout_methods: methods, ...contractor } = row;
  return { ...contractor, currentPayoutMethod: methods.find((method) => method.is_current) ?? null };
}

/** All contractors in an organization with their current payout method (masked). */
export async function listContractorOverviews(
  db: SupabaseClient,
  organizationId: string,
): Promise<ContractorOverview[]> {
  const { data, error } = await db
    .from("contractors")
    .select(`${CONTRACTOR_COLUMNS}, payout_methods:contractor_payout_methods(${PAYOUT_METHOD_COLUMNS})`)
    .eq("organization_id", organizationId)
    .eq("payout_methods.is_current", true)
    .order("full_name")
    .limit(1000);
  throwIfError(error);
  return z.array(overviewSchema).parse(data ?? []).map(toOverview);
}

/** Active contractors who have payout details, i.e. who can be added to a pay run. */
export async function listPayableContractors(
  db: SupabaseClient,
  organizationId: string,
): Promise<(ContractorOverview & { currentPayoutMethod: PayoutMethodSummary })[]> {
  const contractors = await listContractorOverviews(db, organizationId);
  return contractors.filter(
    (contractor): contractor is ContractorOverview & { currentPayoutMethod: PayoutMethodSummary } =>
      contractor.status === "active" && contractor.currentPayoutMethod !== null,
  );
}

const contractorPaymentSchema = z.object({
  id: uuidSchema,
  amount: z.string(),
  currency: z.string(),
  memo: z.string().nullable(),
  pay_run: z.object({
    id: uuidSchema,
    title: z.string(),
    period_month: z.string(),
    status: payRunStatusSchema,
  }),
});

export type ContractorPayment = z.output<typeof contractorPaymentSchema>;

export type ContractorDetail = {
  contractor: Contractor;
  payoutMethods: PayoutMethodSummary[];
  payments: ContractorPayment[];
};

/** One contractor with masked payout history and pay-run lines, or null if not visible. */
export async function getContractorDetail(
  db: SupabaseClient,
  contractorId: string,
): Promise<ContractorDetail | null> {
  const { data, error } = await db.from("contractors").select(CONTRACTOR_COLUMNS).eq("id", contractorId).maybeSingle();
  throwIfError(error);
  if (!data) {
    return null;
  }

  const [methods, payments] = await Promise.all([
    db
      .from("contractor_payout_methods")
      .select(PAYOUT_METHOD_COLUMNS)
      .eq("contractor_id", contractorId)
      .order("version", { ascending: false }),
    db
      .from("pay_run_items")
      .select("id, amount::text, currency, memo, pay_run:pay_runs(id, title, period_month, status)")
      .eq("contractor_id", contractorId)
      .order("created_at", { ascending: false })
      .limit(100),
  ]);
  throwIfError(methods.error);
  throwIfError(payments.error);

  return {
    contractor: contractorSchema.parse(data),
    payoutMethods: z.array(payoutMethodSchema).parse(methods.data ?? []),
    payments: z.array(contractorPaymentSchema).parse(payments.data ?? []),
  };
}

export function createContractor(db: SupabaseClient, input: CreateContractorInput): Promise<string> {
  return callRpc(
    db,
    "create_contractor",
    {
      p_organization_id: input.organizationId,
      p_full_name: input.fullName,
      p_email: input.email,
      p_country_code: input.countryCode,
    },
    uuidSchema,
  );
}

export async function updateContractor(db: SupabaseClient, input: UpdateContractorInput): Promise<void> {
  await callRpc(
    db,
    "update_contractor",
    {
      p_contractor_id: input.contractorId,
      p_full_name: input.fullName,
      p_email: input.email,
      p_country_code: input.countryCode,
    },
    z.null(),
  );
}

export async function archiveContractor(db: SupabaseClient, contractorId: string): Promise<void> {
  await callRpc(db, "archive_contractor", { p_contractor_id: contractorId }, z.null());
}

/** Stores a new immutable payout-method version and returns its ID. */
export function setPayoutMethod(db: SupabaseClient, input: SetPayoutMethodInput): Promise<string> {
  return callRpc(
    db,
    "set_contractor_payout_method",
    {
      p_contractor_id: input.contractorId,
      p_rail: input.payoutMethod.rail,
      p_currency: input.payoutMethod.currency,
      p_details: input.payoutMethod.details,
    },
    uuidSchema,
  );
}
