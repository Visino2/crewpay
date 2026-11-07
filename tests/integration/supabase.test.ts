/**
 * REQUIRES A REAL SUPABASE PROJECT with supabase/migrations applied.
 *
 * Opt in with CREWPAY_RUN_INTEGRATION=1 plus NEXT_PUBLIC_SUPABASE_URL,
 * NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY. Optional:
 * CREWPAY_MAILPIT_URL (local stack) to follow the real confirmation email, and
 * SUPABASE_JWT_SECRET (local stack only) to mint an expired token.
 *
 * Creates users and data, so point it at a local or disposable project only.
 */
import { createHmac, randomBytes, randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
const secretKey = process.env.SUPABASE_SECRET_KEY ?? "";
const mailpitUrl = process.env.CREWPAY_MAILPIT_URL ?? "";
const jwtSecret = process.env.SUPABASE_JWT_SECRET ?? "";
const enabled =
  process.env.CREWPAY_RUN_INTEGRATION === "1" && Boolean(url && publishableKey && secretKey);

const clientOptions = { auth: { persistSession: false, autoRefreshToken: false } };
const ngnDetails = { bank_id: "TESTBANK", account_number: "0000001234", account_name: "Test Contractor" };

type SignedInUser = { id: string; email: string; password: string; client: SupabaseClient };

function newEmail(label: string): string {
  return `crewpay-it-${label}-${randomUUID()}@example.com`;
}

function newClient(): SupabaseClient {
  return createClient(url, publishableKey, clientOptions);
}

function clientWithToken(token: string): SupabaseClient {
  return createClient(url, publishableKey, {
    ...clientOptions,
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

async function createSignedInUser(admin: SupabaseClient, label: string): Promise<SignedInUser> {
  const email = newEmail(label);
  const password = randomBytes(24).toString("base64url");
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) {
    throw error ?? new Error("createUser returned no user");
  }
  const client = newClient();
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) {
    throw signInError;
  }
  return { id: data.user.id, email, password, client };
}

class RpcError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly details?: string,
  ) {
    super(message);
  }
}

async function rpc<T = unknown>(client: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await client.rpc(fn, args);
  if (error) {
    throw new RpcError(`${error.message} ${error.details ?? ""}`.trim(), error.code, error.details ?? undefined);
  }
  return data as T;
}

function base64url(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

describe.skipIf(!enabled)("Supabase integration (real project)", () => {
  let admin: SupabaseClient;
  let alice: SignedInUser; // admin
  let preparer: SignedInUser;
  let approver: SignedInUser;
  let viewer: SignedInUser;
  let outsider: SignedInUser; // admin of another organization
  let organizationId: string;
  let otherOrganizationId: string;

  async function addMember(user: SignedInUser, role: string) {
    const invitationId = await rpc<string>(alice.client, "invite_member", {
      p_organization_id: organizationId,
      p_email: user.email,
      p_role: role,
    });
    await rpc(user.client, "accept_invitation", { p_invitation_id: invitationId });
  }

  async function createContractor(by: SignedInUser, orgId = organizationId, name = "Test Contractor") {
    const contractorId = await rpc<string>(by.client, "create_contractor", {
      p_organization_id: orgId,
      p_full_name: name,
      p_email: null,
      p_country_code: "NG",
    });
    await rpc(by.client, "set_contractor_payout_method", {
      p_contractor_id: contractorId,
      p_rail: "bank_transfer",
      p_currency: "NGN",
      p_details: ngnDetails,
    });
    return contractorId;
  }

  async function createRun(by: SignedInUser, contractorId: string, amount = "1000.00") {
    const payRunId = await rpc<string>(by.client, "create_pay_run", {
      p_organization_id: organizationId,
      p_title: "Integration run",
      p_period_month: "2026-11-01",
      p_funding_currency: "USD",
    });
    await rpc(by.client, "upsert_pay_run_item", {
      p_pay_run_id: payRunId,
      p_contractor_id: contractorId,
      p_amount: amount,
      p_memo: null,
    });
    return payRunId;
  }

  async function submit(by: SignedInUser, payRunId: string) {
    const submissionId = await rpc<string>(by.client, "submit_pay_run", { p_pay_run_id: payRunId });
    const { data, error } = await by.client
      .from("pay_run_submissions")
      .select("snapshot, snapshot_hash")
      .eq("id", submissionId)
      .single();
    expect(error).toBeNull();
    return {
      args: { p_pay_run_id: payRunId, p_submission_id: submissionId, p_snapshot_hash: data!.snapshot_hash as string },
      snapshot: data!.snapshot as { items: Record<string, unknown>[]; totals: Record<string, unknown>[] },
    };
  }

  async function runStatus(payRunId: string) {
    const { data } = await alice.client.from("pay_runs").select("status").eq("id", payRunId).single();
    return data?.status;
  }

  beforeAll(async () => {
    admin = createClient(url, secretKey, clientOptions);
    [alice, preparer, approver, viewer, outsider] = await Promise.all([
      createSignedInUser(admin, "alice"),
      createSignedInUser(admin, "preparer"),
      createSignedInUser(admin, "approver"),
      createSignedInUser(admin, "viewer"),
      createSignedInUser(admin, "outsider"),
    ]);
    organizationId = await rpc<string>(alice.client, "create_organization", { p_name: "Integration Org" });
    otherOrganizationId = await rpc<string>(outsider.client, "create_organization", { p_name: "Other Org" });
    await addMember(preparer, "preparer");
    await addMember(approver, "approver");
    await addMember(viewer, "viewer");
  });

  describe("registration and sessions", () => {
    it("registers a user who must confirm their email before signing in", async () => {
      const email = newEmail("signup");
      const password = randomBytes(18).toString("base64url");
      const anon = newClient();

      const { data, error } = await anon.auth.signUp({
        email,
        password,
        options: { data: { full_name: "Signup Tester" } },
      });
      expect(error).toBeNull();
      expect(data.session).toBeNull();
      expect(data.user?.id).toBeTruthy();

      const { error: earlySignIn } = await newClient().auth.signInWithPassword({ email, password });
      expect(earlySignIn?.code).toBe("email_not_confirmed");

      if (mailpitUrl) {
        // Follow the real email: the template must point at /auth/confirm.
        const search = await fetch(`${mailpitUrl}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`);
        const { messages } = (await search.json()) as { messages: { ID: string }[] };
        expect(messages.length).toBe(1);
        const message = (await (await fetch(`${mailpitUrl}/api/v1/message/${messages[0]!.ID}`)).json()) as {
          HTML: string;
        };
        const href = /href="([^"]+)"/.exec(message.HTML)?.[1]?.replaceAll("&amp;", "&");
        const link = new URL(href!);
        expect(link.pathname).toBe("/auth/confirm");
        expect(link.searchParams.get("type")).toBe("email");

        const confirm = newClient();
        const { data: verified, error: verifyError } = await confirm.auth.verifyOtp({
          type: "email",
          token_hash: link.searchParams.get("token_hash")!,
        });
        expect(verifyError).toBeNull();
        expect(verified.session?.user.email).toBe(email);
      } else {
        await admin.auth.admin.updateUserById(data.user!.id, { email_confirm: true });
      }

      // Once confirmed, the user can sign in and the profile trigger has run.
      const confirmed = newClient();
      const { error: signInError } = await confirmed.auth.signInWithPassword({ email, password });
      expect(signInError).toBeNull();
      const { data: profile } = await confirmed
        .from("user_profiles")
        .select("email, full_name")
        .eq("id", data.user!.id)
        .single();
      expect(profile).toEqual({ email, full_name: "Signup Tester" });
    });

    it("verifies tokens and rejects tampered ones", async () => {
      const { data: claims } = await alice.client.auth.getClaims();
      expect(claims?.claims.sub).toBe(alice.id);

      const { data: session } = await alice.client.auth.getSession();
      const token = session.session!.access_token;
      const tampered = `${token.slice(0, -4)}${token.slice(-4) === "AAAA" ? "BBBB" : "AAAA"}`;
      const { error } = await clientWithToken(tampered).from("organizations").select("id");
      // PostgREST rejects the request outright (HTTP 401) instead of treating it as anonymous.
      expect(error?.code).toBe("PGRST301");
    });

    it.skipIf(!jwtSecret)("rejects an expired token", async () => {
      const now = Math.floor(Date.now() / 1000);
      const header = base64url({ alg: "HS256", typ: "JWT" });
      const payload = base64url({ sub: alice.id, role: "authenticated", aud: "authenticated", iat: now - 7200, exp: now - 3600 });
      const signature = createHmac("sha256", jwtSecret).update(`${header}.${payload}`).digest("base64url");
      const { error } = await clientWithToken(`${header}.${payload}.${signature}`).from("organizations").select("id");
      expect(error?.message).toMatch(/expired/i);
    });

    it("revokes the refresh token on sign-out", async () => {
      const session = newClient();
      await session.auth.signInWithPassword({ email: viewer.email, password: viewer.password });
      const { data } = await session.auth.getSession();
      const refreshToken = data.session!.refresh_token;
      const accessToken = data.session!.access_token;

      await session.auth.signOut({ scope: "local" });
      const { error } = await newClient().auth.refreshSession({ refresh_token: refreshToken });
      expect(error).not.toBeNull();

      // Access tokens are stateless JWTs: record whether the Data API still
      // accepts one after sign-out (expected until it expires).
      const { error: afterSignOut } = await clientWithToken(accessToken).from("organizations").select("id");
      console.info(`[integration] access token after sign-out accepted by Data API: ${afterSignOut === null}`);
    });

    it("gives anonymous clients no access", async () => {
      const anon = newClient();
      const { data, error } = await anon.from("organizations").select("id");
      expect(data ?? []).toHaveLength(0);
      expect(error?.code).toBe("42501");
      await expect(rpc(anon, "create_organization", { p_name: "Anon Org" })).rejects.toThrow();
    });
  });

  describe("organizations and isolation", () => {
    it("records memberships with the expected roles", async () => {
      const { data } = await viewer.client
        .from("organization_members")
        .select("user_id, role")
        .eq("organization_id", organizationId);
      const roles = Object.fromEntries((data ?? []).map((row) => [row.user_id, row.role]));
      expect(roles).toEqual({
        [alice.id]: "admin",
        [preparer.id]: "preparer",
        [approver.id]: "approver",
        [viewer.id]: "viewer",
      });
    });

    it("hides other organizations and rejects actions on them", async () => {
      const { data } = await outsider.client.from("organizations").select("id");
      expect((data ?? []).map((row) => row.id)).toEqual([otherOrganizationId]);
      await expect(
        rpc(outsider.client, "invite_member", {
          p_organization_id: organizationId,
          p_email: "intruder@example.com",
          p_role: "admin",
        }),
      ).rejects.toThrow("not_found");
    });

    it("blocks direct table writes", async () => {
      const { error: insertError } = await outsider.client
        .from("organization_members")
        .insert({ organization_id: organizationId, user_id: outsider.id, role: "admin" });
      expect(insertError?.code).toBe("42501");
      const { error: updateError } = await alice.client
        .from("pay_runs")
        .update({ status: "approved" })
        .eq("organization_id", organizationId);
      expect(updateError?.code).toBe("42501");
    });
  });

  describe("contractors and payout details", () => {
    it("lets preparers manage contractors but not viewers or approvers", async () => {
      await expect(createContractor(preparer)).resolves.toBeTruthy();
      for (const user of [viewer, approver]) {
        await expect(
          rpc(user.client, "create_contractor", {
            p_organization_id: organizationId,
            p_full_name: "Blocked",
            p_email: null,
            p_country_code: "NG",
          }),
        ).rejects.toThrow("not_authorized");
      }
    });

    it("never returns raw payout details, only a masked label", async () => {
      const contractorId = await createContractor(preparer, organizationId, "Masked Contractor");
      for (const user of [alice, preparer, approver, viewer]) {
        const { error } = await user.client.from("contractor_payout_methods").select("details");
        expect(error?.code).toBe("42501");
      }
      const { data } = await viewer.client
        .from("contractor_payout_methods")
        .select("display_label")
        .eq("contractor_id", contractorId)
        .single();
      expect(data?.display_label).toBe("NGN bank ****1234");
    });

    it("keeps contractors inside their organization", async () => {
      const contractorId = await createContractor(preparer);
      const { data } = await outsider.client.from("contractors").select("id").eq("id", contractorId);
      expect(data).toEqual([]);

      const foreignRun = await rpc<string>(outsider.client, "create_pay_run", {
        p_organization_id: otherOrganizationId,
        p_title: "Foreign run",
        p_period_month: "2026-11-01",
        p_funding_currency: "USD",
      });
      await expect(
        rpc(outsider.client, "upsert_pay_run_item", {
          p_pay_run_id: foreignRun,
          p_contractor_id: contractorId,
          p_amount: "10.00",
          p_memo: null,
        }),
      ).rejects.toThrow("not_found");
    });
  });

  describe("pay runs, snapshots and approvals", () => {
    it("supports editing a draft and freezes a snapshot on submission", async () => {
      const contractorId = await createContractor(preparer, organizationId, "Editable");
      const payRunId = await createRun(preparer, contractorId, "100.00");
      const itemId = await rpc<string>(preparer.client, "upsert_pay_run_item", {
        p_pay_run_id: payRunId,
        p_contractor_id: contractorId,
        p_amount: "250.75",
        p_memo: "November invoice",
      });
      const second = await createContractor(preparer, organizationId, "Removed Later");
      const secondItem = await rpc<string>(preparer.client, "upsert_pay_run_item", {
        p_pay_run_id: payRunId,
        p_contractor_id: second,
        p_amount: "5.00",
        p_memo: null,
      });
      await rpc(preparer.client, "remove_pay_run_item", { p_item_id: secondItem });

      const { snapshot } = await submit(preparer, payRunId);
      expect(snapshot.items).toHaveLength(1);
      expect(snapshot.items[0]).toMatchObject({ item_id: itemId, amount: "250.75", memo: "November invoice" });
      expect(snapshot.totals).toEqual([{ currency: "NGN", amount: "250.75", items: 1 }]);
      expect(JSON.stringify(snapshot)).not.toContain(ngnDetails.account_number);

      await expect(
        rpc(preparer.client, "upsert_pay_run_item", {
          p_pay_run_id: payRunId,
          p_contractor_id: contractorId,
          p_amount: "1.00",
          p_memo: null,
        }),
      ).rejects.toThrow("invalid_state");
    });

    it("rejects a mismatched hash and self-approval, then accepts an independent approver", async () => {
      const contractorId = await createContractor(alice, organizationId, "Admin Prepared");
      const payRunId = await createRun(alice, contractorId);
      const { args } = await submit(alice, payRunId);

      await expect(
        rpc(approver.client, "approve_pay_run", { ...args, p_snapshot_hash: "0".repeat(64) }),
      ).rejects.toThrow("snapshot_mismatch");
      await expect(rpc(alice.client, "approve_pay_run", args)).rejects.toThrow("self_approval_forbidden");
      await expect(rpc(preparer.client, "approve_pay_run", args)).rejects.toThrow("not_authorized");
      // The approver did not enter these payout details either, so this succeeds.
      await expect(rpc(approver.client, "approve_pay_run", args)).resolves.toBeTruthy();
      expect(await runStatus(payRunId)).toBe("approved");
    });

    it("requires a comment to reject and allows reopening", async () => {
      const contractorId = await createContractor(preparer, organizationId, "Rejected");
      const payRunId = await createRun(preparer, contractorId);
      const { args } = await submit(preparer, payRunId);
      await expect(rpc(approver.client, "reject_pay_run", { ...args, p_comment: " " })).rejects.toThrow(
        "invalid_input",
      );
      await rpc(approver.client, "reject_pay_run", { ...args, p_comment: "Wrong amount" });
      expect(await runStatus(payRunId)).toBe("rejected");
      await rpc(preparer.client, "reopen_pay_run", { p_pay_run_id: payRunId });
      expect(await runStatus(payRunId)).toBe("draft");
    });

    it("gives the service-role key no direct table access to bypass the workflow", async () => {
      const contractorId = await createContractor(preparer, organizationId, "Tamper Target");
      const payRunId = await createRun(preparer, contractorId);
      await submit(preparer, payRunId);

      const { error: readError } = await admin.from("contractors").select("id").eq("id", contractorId);
      expect(readError?.code).toBe("42501");
      const { error: updateError } = await admin
        .from("contractors")
        .update({ full_name: "Someone Else" })
        .eq("id", contractorId);
      expect(updateError?.code).toBe("42501");
      const { error: statusError } = await admin.from("pay_runs").update({ status: "approved" }).eq("id", payRunId);
      expect(statusError?.code).toBe("42501");
      const { error: rpcError } = await admin.rpc("approve_pay_run", {
        p_pay_run_id: payRunId,
        p_submission_id: randomUUID(),
        p_snapshot_hash: "0".repeat(64),
      });
      expect(rpcError).not.toBeNull();
      expect(await runStatus(payRunId)).toBe("pending_approval");
    });

    it("returns a pending run to draft when payout details change", async () => {
      const contractorId = await createContractor(preparer, organizationId, "Details Change");
      const payRunId = await createRun(preparer, contractorId);
      const { args } = await submit(preparer, payRunId);
      await rpc(preparer.client, "set_contractor_payout_method", {
        p_contractor_id: contractorId,
        p_rail: "bank_transfer",
        p_currency: "NGN",
        p_details: { ...ngnDetails, account_number: "0000009999" },
      });
      expect(await runStatus(payRunId)).toBe("draft");
      await expect(rpc(approver.client, "approve_pay_run", args)).rejects.toThrow("invalid_state");
    });
  });

  describe("history and CSV export (Step 3 data layer)", () => {
    it("lists history only to members and exports masked, injection-safe CSV", async () => {
      // A reference that would run as a formula if a spreadsheet opened it unescaped.
      const contractorId = await createContractor(preparer, organizationId, "Export Contractor");
      const payRunId = await createRun(preparer, contractorId, "1250.50");
      await rpc(preparer.client, "upsert_pay_run_item", {
        p_pay_run_id: payRunId,
        p_contractor_id: contractorId,
        p_amount: "1250.50",
        p_memo: "=HYPERLINK(\"http://evil.example\")",
      });
      const { args } = await submit(preparer, payRunId);
      await rpc(approver.client, "approve_pay_run", args);

      const { listPayRunSummaries } = await import("@/features/pay-runs/data");
      const viewerRuns = await listPayRunSummaries(viewer.client, organizationId);
      expect(viewerRuns.find((run) => run.id === payRunId)?.status).toBe("approved");
      expect(await listPayRunSummaries(outsider.client, organizationId)).toEqual([]);

      const { exportOrganizationHistory } = await import("@/features/pay-runs/export");
      const { csv } = await exportOrganizationHistory(
        viewer.client,
        { id: viewer.id, email: viewer.email },
        organizationId,
      );
      const row = csv.split("\r\n").find((line) => line.includes(payRunId) && line.includes("Export Contractor"));
      expect(row).toBeDefined();
      expect(row).toContain('"Approved"');
      expect(row).toContain('"Not sent"');
      expect(row).toContain('"NGN bank ****1234"');
      expect(row).toContain('"1250.50"');
      expect(row).toContain(`"'=HYPERLINK(""http://evil.example"")"`);
      expect(csv).not.toContain(ngnDetails.account_number);

      await expect(
        exportOrganizationHistory(outsider.client, { id: outsider.id, email: outsider.email }, organizationId),
      ).rejects.toMatchObject({ code: "not_found" });
    });
  });

  describe("audit trail", () => {
    it("is written for sensitive actions and readable only by admins and approvers", async () => {
      const { data: entries } = await alice.client
        .from("audit_logs")
        .select("action, actor_id")
        .eq("organization_id", organizationId);
      const actions = new Set((entries ?? []).map((entry) => entry.action));
      for (const action of [
        "organization.created",
        "member.invited",
        "member.joined",
        "contractor.created",
        "payout_method.set",
        "pay_run.submitted",
        "pay_run.approved",
        "pay_run.rejected",
        "pay_run.invalidated",
      ]) {
        expect(actions, action).toContain(action);
      }

      const { data: approverView } = await approver.client.from("audit_logs").select("id").limit(1);
      expect(approverView?.length).toBe(1);
      for (const user of [preparer, viewer, outsider]) {
        const { data } = await user.client.from("audit_logs").select("id").eq("organization_id", organizationId);
        expect(data).toEqual([]);
      }
    });

    it("cannot be changed through the Data API, even with the service role", async () => {
      const { error: userInsert } = await alice.client
        .from("audit_logs")
        .insert({ organization_id: organizationId, action: "fake.entry", entity_type: "pay_run" });
      expect(userInsert?.code).toBe("42501");

      const { error: serviceDelete } = await admin.from("audit_logs").delete().eq("organization_id", organizationId);
      expect(serviceDelete).not.toBeNull();
      const { error: serviceUpdate } = await admin
        .from("audit_logs")
        .update({ action: "tampered.entry" })
        .eq("organization_id", organizationId);
      expect(serviceUpdate).not.toBeNull();
    });
  });
});
