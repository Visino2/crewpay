/**
 * End-to-end support: creates users and test data in a LOCAL or disposable
 * Supabase project through the app's own database functions (the same RPCs
 * the UI uses). Never point this at production.
 */
import { randomBytes, randomUUID } from "node:crypto";

import { expect, type Browser, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const e2eEnv = {
  url: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  publishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
  secretKey: process.env.SUPABASE_SECRET_KEY ?? "",
  screenshotDir: process.env.CREWPAY_SCREENSHOT_DIR ?? "",
};

export const e2eEnabled =
  process.env.CREWPAY_RUN_E2E === "1" && Boolean(e2eEnv.url && e2eEnv.publishableKey && e2eEnv.secretKey);

const clientOptions = { auth: { persistSession: false, autoRefreshToken: false } };

export type TestUser = { id: string; email: string; password: string; name: string; client: SupabaseClient };

async function createUser(admin: SupabaseClient, label: string, name: string): Promise<TestUser> {
  const email = `e2e-${label}-${randomUUID().slice(0, 8)}@example.com`;
  const password = randomBytes(18).toString("base64url");
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: name },
  });
  if (error || !data.user) {
    throw error ?? new Error("createUser failed");
  }
  const client = createClient(e2eEnv.url, e2eEnv.publishableKey, clientOptions);
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) {
    throw signInError;
  }
  return { id: data.user.id, email, password, name, client };
}

export async function rpc<T = string>(user: TestUser, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await user.client.rpc(fn, args);
  if (error) {
    throw new Error(`${fn}: ${error.message} ${error.details ?? ""}`);
  }
  return data as T;
}

export type Workspace = {
  organizationId: string;
  admin: TestUser;
  preparer: TestUser;
  approver: TestUser;
  viewer: TestUser;
  outsider: TestUser;
  adminPreparedRunId: string;
};

const CONTRACTORS = [
  { name: "Ada Okafor", country: "NG", rail: "bank_transfer", currency: "NGN", details: { bank_id: "044", account_number: "0123456789", account_name: "Ada Okafor" } },
  { name: "Kwame Mensah", country: "GH", rail: "mobile_money", currency: "GHS", details: { phone_number: "+233241234567", mobile_money_operator_id: "7", account_name: "Kwame Mensah" } },
  { name: "Wanjiru Kamau", country: "KE", rail: "mobile_money", currency: "KES", details: { phone_number: "+254712345678", mobile_money_operator_id: "3", account_name: "Wanjiru Kamau" } },
  { name: "Priya Raman", country: "GB", rail: "bank_transfer", currency: "GBP", details: { account_number: "31926819", sort_code: "601613", account_name: "Priya Raman", country: "GB", street: "12 Market St", city: "Leeds", zip_code: "LS1 6DT" } },
  { name: "Lucas Moreau", country: "FR", rail: "bank_transfer", currency: "EUR", details: { iban: "FR7630006000011234567890189", bic_code: "AGRIFRPP", account_name: "Lucas Moreau", country: "FR", street: "8 Rue Oberkampf", city: "Paris", zip_code: "75011" } },
  { name: "Maya Chen", country: "CA", rail: "interac", currency: "CAD", details: { email: "maya.chen@example.com", first_name: "Maya", last_name: "Chen" } },
] as const;

/** A fresh organization with four roles and pay runs in every state. */
export async function seedWorkspace(): Promise<Workspace> {
  const admin = createClient(e2eEnv.url, e2eEnv.secretKey, clientOptions);
  const [owner, preparer, approver, viewer, outsider] = await Promise.all([
    createUser(admin, "admin", "Amara Nwosu"),
    createUser(admin, "preparer", "Tunde Adeyemi"),
    createUser(admin, "approver", "Grace Mwangi"),
    createUser(admin, "viewer", "Sam Okoro"),
    createUser(admin, "outsider", "Outside User"),
  ]);

  const organizationId = await rpc(owner, "create_organization", { p_name: "Northwind Studio (local test data)" });
  for (const [user, role] of [
    [preparer, "preparer"],
    [approver, "approver"],
    [viewer, "viewer"],
  ] as const) {
    const invitationId = await rpc(owner, "invite_member", { p_organization_id: organizationId, p_email: user.email, p_role: role });
    await rpc(user, "accept_invitation", { p_invitation_id: invitationId });
  }

  const ids: string[] = [];
  for (const contractor of CONTRACTORS) {
    const id = await rpc(preparer, "create_contractor", {
      p_organization_id: organizationId,
      p_full_name: contractor.name,
      p_email: `${contractor.name.split(" ")[0]!.toLowerCase()}@contractor.example`,
      p_country_code: contractor.country,
    });
    await rpc(preparer, "set_contractor_payout_method", {
      p_contractor_id: id,
      p_rail: contractor.rail,
      p_currency: contractor.currency,
      p_details: contractor.details,
    });
    ids.push(id);
  }
  await rpc(preparer, "create_contractor", {
    p_organization_id: organizationId,
    p_full_name: "Sofia Haddad",
    p_email: null,
    p_country_code: "MA",
  });

  const amounts = ["850000.00", "4200.00", "95000.00", "1850.00", "2400.00", "3100.00"];
  async function run(title: string, period: string, lineCount: number, by: TestUser = preparer) {
    const payRunId = await rpc(by, "create_pay_run", {
      p_organization_id: organizationId,
      p_title: title,
      p_period_month: period,
      p_funding_currency: "USD",
    });
    for (let index = 0; index < lineCount; index += 1) {
      await rpc(by, "upsert_pay_run_item", {
        p_pay_run_id: payRunId,
        p_contractor_id: ids[index],
        p_amount: amounts[index],
        p_memo: `INV-${period.slice(0, 7).replace("-", "")}-${index + 1}`,
      });
    }
    return payRunId;
  }
  async function submit(payRunId: string, by: TestUser = preparer) {
    const submissionId = await rpc(by, "submit_pay_run", { p_pay_run_id: payRunId });
    const { data } = await by.client.from("pay_run_submissions").select("snapshot_hash").eq("id", submissionId).single();
    return { p_pay_run_id: payRunId, p_submission_id: submissionId, p_snapshot_hash: data!.snapshot_hash };
  }

  await rpc(approver, "approve_pay_run", await submit(await run("September contractors", "2026-09-01", 6)));
  await rpc(approver, "approve_pay_run", await submit(await run("October contractors", "2026-10-01", 6)));
  await submit(await run("November contractors", "2026-11-01", 6));
  await rpc(approver, "reject_pay_run", {
    ...(await submit(await run("Design sprint bonus", "2026-10-01", 2))),
    p_comment: "Bonus for Kwame should be GHS 3,800 per the agreed scope.",
  });
  await rpc(preparer, "cancel_pay_run", { p_pay_run_id: await run("Duplicate October draft", "2026-10-01", 1) });
  await run("December retainers", "2026-12-01", 3);
  const adminPreparedRunId = await run("Q4 equipment stipends", "2026-11-01", 2, owner);
  await submit(adminPreparedRunId, owner);

  return { organizationId, admin: owner, preparer, approver, viewer, outsider, adminPreparedRunId };
}

export async function signIn(browser: Browser, user: TestUser, viewport = { width: 1440, height: 900 }): Promise<Page> {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/account$/);
  return page;
}

export async function screenshot(page: Page, name: string): Promise<void> {
  if (!e2eEnv.screenshotDir) {
    return;
  }
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${e2eEnv.screenshotDir}/${name}.png`, fullPage: true });
}
