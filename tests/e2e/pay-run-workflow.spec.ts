/**
 * REQUIRES the app running against a LOCAL Supabase stack with migrations
 * applied. Opt in with CREWPAY_RUN_E2E=1 plus NEXT_PUBLIC_SUPABASE_URL,
 * NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY.
 * Optional: CREWPAY_SCREENSHOT_DIR to save screenshots.
 */
import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

import { e2eEnabled, screenshot, seedWorkspace, signIn, type Workspace } from "./support";

test.describe.configure({ mode: "serial" });
test.skip(!e2eEnabled, "Set CREWPAY_RUN_E2E=1 and local Supabase variables to run end-to-end tests.");

let workspace: Workspace;
let newRunUrl = "";

test.beforeAll(async () => {
  workspace = await seedWorkspace();
});

test("signed-out visitors are sent to sign-in", async ({ page }) => {
  await page.goto(`/orgs/${workspace.organizationId}/pay-runs`);
  await expect(page).toHaveURL(/\/sign-in\?next=/);
  await screenshot(page, "01-sign-in");
});

test("a preparer adds a contractor, prepares a pay run and submits it", async ({ browser }) => {
  const page = await signIn(browser, workspace.preparer);
  await screenshot(page, "02-account");
  await page.getByRole("link", { name: /Northwind Studio/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: /Northwind Studio/ })).toBeVisible();
  await screenshot(page, "03-dashboard");

  // Contractor with payout details: the account number is never shown again.
  await page.getByRole("link", { name: "Contractors" }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Contractors" })).toBeVisible();
  await screenshot(page, "04-contractors");
  await page.getByRole("link", { name: "Add contractor" }).click();
  await page.getByLabel("Full name").fill("Zainab Bello");
  await page.getByLabel("Email (optional)").fill("zainab@contractor.example");
  await page.getByLabel("Country of residence").selectOption("NG");
  await page.getByRole("button", { name: "Add contractor" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Zainab Bello" })).toBeVisible();
  await page.getByRole("button", { name: "Add payout details" }).first().click();
  await page.getByLabel("Account holder name").fill("Zainab Bello");
  await page.getByLabel("Bank ID").fill("058");
  await page.getByLabel("Account number (NUBAN)").fill("0987654321");
  await page.getByRole("button", { name: "Save payout details" }).click();
  await expect(page.getByText("NGN bank ****4321").first()).toBeVisible();
  expect(await page.content()).not.toContain("0987654321");
  await screenshot(page, "05-contractor-detail");

  // Draft pay run with a precise amount.
  await page.getByRole("link", { name: "Pay runs" }).first().click();
  await page.getByRole("link", { name: "New pay run" }).first().click();
  await page.getByLabel("Title").fill("E2E December top-up");
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "E2E December top-up" })).toBeVisible();
  newRunUrl = page.url();

  await page.getByLabel("Contractor").selectOption({ label: "Zainab Bello · NGN bank ****4321" });
  await page.getByLabel("Amount they receive").fill("250000.05");
  await page.getByLabel("Reference (optional)").fill("INV-E2E-1");
  await page.getByRole("button", { name: "Add line" }).click();
  await expect(page.locator("tbody").getByRole("cell", { name: "NGN 250,000.05" })).toBeVisible();

  await page.getByLabel("Contractor").selectOption({ label: "Ada Okafor · NGN bank ****6789" });
  await page.getByLabel("Amount they receive").fill("0.10");
  await page.getByRole("button", { name: "Add line" }).click();
  await expect(page.locator("tbody").getByRole("cell", { name: "NGN 0.10" })).toBeVisible();
  // Exact decimal total: 250000.05 + 0.10, with no floating-point drift.
  await expect(page.locator("tfoot").getByRole("cell", { name: "NGN 250,000.15" })).toBeVisible();

  // Nothing selected after a line is added: the form explains instead of failing silently.
  await page.getByRole("button", { name: "Add line" }).click();
  await expect(page.getByText("Choose a contractor")).toBeVisible();
  await page.getByLabel("Contractor").selectOption({ label: "Kwame Mensah · GHS mobile money ****4567" });
  await expect(page.locator("#amount-currency")).toHaveText("GHS");
  await page.getByLabel("Amount they receive").fill("12.345");
  await page.getByRole("button", { name: "Add line" }).click();
  await expect(page.getByText("Enter an amount with up to 2 decimal places")).toBeVisible();
  await screenshot(page, "06-pay-run-draft");

  await page.getByRole("link", { name: "Review and submit" }).click();
  await expect(page.getByRole("heading", { name: "Review before submitting" })).toBeVisible();
  await expect(page.getByText("Fees and FX not available")).toBeVisible();
  await screenshot(page, "07-review");
  await page.getByRole("button", { name: "Submit for approval" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Submit for approval" }).click();
  await expect(page.getByText("Awaiting approval").first()).toBeVisible();
  await expect(page.getByText("Snapshot fingerprint")).toBeVisible();
  // A preparer has no approve controls.
  await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0);
});

test("an approver reviews the frozen snapshot and approves it, without marking it paid", async ({ browser }) => {
  const page = await signIn(browser, workspace.approver);
  await page.goto(`/orgs/${workspace.organizationId}/approvals`);
  await screenshot(page, "08-approvals");
  await page.getByRole("link", { name: /E2E December top-up/ }).click();
  await expect(page.getByRole("heading", { name: "Your decision" })).toBeVisible();
  await screenshot(page, "09-approval-review");
  await page.getByRole("button", { name: "Approve" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Approve pay run" }).click();
  await expect(page.getByRole("note").filter({ hasText: /^Approved by Grace Mwangi/ })).toContainText(
    "No money has been sent",
  );
  await expect(page.getByText("Not sent").first()).toBeVisible();
  await expect(page.getByText(/\bpaid\b/i).filter({ hasNotText: /not paid|not been paid|No money/i })).toHaveCount(0);
});

test("an admin who prepared a run is told someone else must decide", async ({ browser }) => {
  const page = await signIn(browser, workspace.admin);
  await page.goto(`/orgs/${workspace.organizationId}/pay-runs/${workspace.adminPreparedRunId}`);
  await expect(page.getByText("Someone else must decide")).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0);
  await page.goto(`/orgs/${workspace.organizationId}/team`);
  await expect(page.getByRole("button", { name: "Invite" })).toBeVisible();
  await screenshot(page, "10-team");
});

test("a viewer has read-only access and can export history as CSV", async ({ browser }) => {
  const page = await signIn(browser, workspace.viewer);
  await page.goto(`/orgs/${workspace.organizationId}`);
  await expect(page.getByRole("link", { name: "New pay run" })).toHaveCount(0);
  await page.goto(`/orgs/${workspace.organizationId}/pay-runs/new`);
  await expect(page.getByText("Not found")).toBeVisible();
  await page.goto(newRunUrl);
  await expect(page.getByRole("button", { name: /Approve|Withdraw|Submit/ })).toHaveCount(0);

  await page.goto(`/orgs/${workspace.organizationId}/history`);
  await screenshot(page, "11-history");
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Export CSV" }).click();
  const csv = await readFile(await (await download).path(), "utf8");
  expect(csv).toContain('"E2E December top-up"');
  expect(csv).toContain('"Not sent"');
  expect(csv).toContain('"NGN bank ****4321"');
  expect(csv).not.toContain("0987654321");
});

test("someone outside the organization gets not found, including for the export", async ({ browser }) => {
  const page = await signIn(browser, workspace.outsider);
  await page.goto(`/orgs/${workspace.organizationId}`);
  await expect(page.getByText("Not found")).toBeVisible();
  const response = await page.request.get(`/orgs/${workspace.organizationId}/history/export`);
  expect(response.status()).toBe(404);
});

test("the workspace is usable on a phone", async ({ browser }) => {
  const page = await signIn(browser, workspace.approver, { width: 390, height: 844 });
  await page.goto(`/orgs/${workspace.organizationId}`);
  await expect(page.getByRole("button", { name: "Open navigation" })).toBeVisible();
  await screenshot(page, "12-mobile-dashboard");
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.getByRole("link", { name: "Approvals" })).toBeVisible();
  await screenshot(page, "13-mobile-navigation");
});
