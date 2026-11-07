/**
 * DEMO DATA ONLY. Seeds a clearly labelled, fictional demo organization using
 * the app's own database functions (the same RPCs the UI calls, so every
 * security rule applies). Prints sign-in details; passwords are generated
 * per run and never stored.
 *
 *   npm run demo:seed                 # local stack from `supabase start`
 *   npm run demo:seed -- --hosted-demo
 *
 * --hosted-demo targets a dedicated hosted DEMO project. It reads
 * CREWPAY_SEED_SUPABASE_URL (https://<ref>.supabase.co),
 * CREWPAY_SEED_PUBLISHABLE_KEY and CREWPAY_SEED_SECRET_KEY from the
 * environment, never writes them to disk, and refuses any other URL shape.
 * Never point it at a project holding real customer data.
 */
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const hosted = process.argv.includes("--hosted-demo");

function localStatus(): Record<string, string> {
  return Object.fromEntries(
    execFileSync("supabase", ["status", "-o", "env"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
      .split("\n")
      .map((line) => /^([A-Z_]+)="?(.*?)"?$/.exec(line.trim()))
      .filter((match): match is RegExpExecArray => match !== null)
      .map((match) => [match[1], match[2]]),
  ) as Record<string, string>;
}

const status = hosted
  ? {
      API_URL: process.env.CREWPAY_SEED_SUPABASE_URL ?? "",
      PUBLISHABLE_KEY: process.env.CREWPAY_SEED_PUBLISHABLE_KEY ?? "",
      SECRET_KEY: process.env.CREWPAY_SEED_SECRET_KEY ?? "",
    }
  : localStatus();

const url = status.API_URL ?? "";
const allowed = hosted ? /^https:\/\/[a-z0-9]{20}\.supabase\.co$/ : /^http:\/\/(127\.0\.0\.1|localhost):\d+$/;
if (!allowed.test(url)) {
  throw new Error(
    hosted
      ? `Refusing to seed: CREWPAY_SEED_SUPABASE_URL must be https://<project-ref>.supabase.co (got ${url || "nothing"}).`
      : `Refusing to seed: Supabase URL is not local (${url || "missing"}). Run "supabase start" first.`,
  );
}
const publishableKey = status.PUBLISHABLE_KEY ?? "";
const secretKey = status.SECRET_KEY ?? "";
if (!publishableKey || !secretKey) {
  throw new Error("Refusing to seed: the publishable key and secret key are both required.");
}
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, secretKey, options);
const run = randomBytes(2).toString("hex");

type User = { email: string; password: string; name: string; role: string; client: SupabaseClient };

async function createUser(role: string, name: string): Promise<User> {
  const email = `${role}.${run}@demo.example.com`;
  const password = randomBytes(9).toString("base64url");
  const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: name } });
  if (error) throw error;
  const client = createClient(url, publishableKey, options);
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return { email, password, name, role, client };
}

async function rpc(user: User, fn: string, args: Record<string, unknown>): Promise<string> {
  const { data, error } = await user.client.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message} ${error.details ?? ""}`);
  return data as string;
}

const owner = await createUser("admin", "Amara Nwosu");
const preparer = await createUser("preparer", "Tunde Adeyemi");
const approver = await createUser("approver", "Grace Mwangi");
const viewer = await createUser("viewer", "Sam Okoro");

const organizationId = await rpc(owner, "create_organization", { p_name: "Northwind Studio (DEMO DATA)" });
for (const user of [preparer, approver, viewer]) {
  const invitationId = await rpc(owner, "invite_member", { p_organization_id: organizationId, p_email: user.email, p_role: user.role });
  await rpc(user, "accept_invitation", { p_invitation_id: invitationId });
}

// Fictional contractors and test account numbers only.
const contractors = [
  ["Ada Okafor", "NG", "bank_transfer", "NGN", { bank_id: "044", account_number: "0123456789", account_name: "Ada Okafor" }, "850000.00"],
  ["Kwame Mensah", "GH", "mobile_money", "GHS", { phone_number: "+233241234567", mobile_money_operator_id: "7", account_name: "Kwame Mensah" }, "4200.00"],
  ["Wanjiru Kamau", "KE", "mobile_money", "KES", { phone_number: "+254712345678", mobile_money_operator_id: "3", account_name: "Wanjiru Kamau" }, "95000.00"],
  ["Priya Raman", "GB", "bank_transfer", "GBP", { account_number: "31926819", sort_code: "601613", account_name: "Priya Raman", country: "GB", street: "12 Market St", city: "Leeds", zip_code: "LS1 6DT" }, "1850.00"],
  ["Lucas Moreau", "FR", "bank_transfer", "EUR", { iban: "FR7630006000011234567890189", bic_code: "AGRIFRPP", account_name: "Lucas Moreau", country: "FR", street: "8 Rue Oberkampf", city: "Paris", zip_code: "75011" }, "2400.00"],
] as const;

const lines: { id: string; amount: string }[] = [];
for (const [name, country, rail, currency, details, amount] of contractors) {
  const id = await rpc(preparer, "create_contractor", {
    p_organization_id: organizationId,
    p_full_name: name,
    p_email: `${name.split(" ")[0]!.toLowerCase()}@contractor.example`,
    p_country_code: country,
  });
  await rpc(preparer, "set_contractor_payout_method", { p_contractor_id: id, p_rail: rail, p_currency: currency, p_details: details });
  lines.push({ id, amount });
}

async function payRun(title: string, period: string) {
  const id = await rpc(preparer, "create_pay_run", { p_organization_id: organizationId, p_title: title, p_period_month: period, p_funding_currency: "USD" });
  for (const [index, line] of lines.entries()) {
    await rpc(preparer, "upsert_pay_run_item", { p_pay_run_id: id, p_contractor_id: line.id, p_amount: line.amount, p_memo: `INV-${period.slice(0, 7).replace("-", "")}-${index + 1}` });
  }
  return id;
}
async function submit(id: string) {
  const submissionId = await rpc(preparer, "submit_pay_run", { p_pay_run_id: id });
  const { data } = await preparer.client.from("pay_run_submissions").select("snapshot_hash").eq("id", submissionId).single();
  return { p_pay_run_id: id, p_submission_id: submissionId, p_snapshot_hash: data!.snapshot_hash };
}

await rpc(approver, "approve_pay_run", await submit(await payRun("September contractors", "2026-09-01")));
await rpc(approver, "approve_pay_run", await submit(await payRun("October contractors", "2026-10-01")));
await submit(await payRun("November contractors", "2026-11-01"));

// Local only: the hosted app gets its configuration from Vercel instead.
if (!hosted && !existsSync(".env.local")) {
  writeFileSync(
    ".env.local",
    `# Local demo values from "supabase status" (public; git-ignored).\nNEXT_PUBLIC_APP_URL=http://localhost:3000\nNEXT_PUBLIC_SUPABASE_URL=${url}\nNEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${publishableKey}\n`,
  );
  console.log("Wrote .env.local with the local Supabase URL and publishable key.");
}

console.log(
  `\nDemo organization "Northwind Studio (DEMO DATA)" is ready. Sign in at ${hosted ? "the deployed app's /sign-in" : "http://localhost:3000/sign-in"}\n`,
);
console.table([owner, preparer, approver, viewer].map(({ role, name, email, password }) => ({ role, name, email, password })));
console.log("Approve the November run as the approver. Nothing is paid: payouts are not connected.");
if (hosted) {
  console.log("Share only the preparer, approver and viewer accounts with judges. Keep the admin account private.\n");
}
