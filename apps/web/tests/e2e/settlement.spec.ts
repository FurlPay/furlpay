import { test, expect, type Page } from "@playwright/test";
import { signIn, observe, hydrationErrors } from "./fixtures";

// Settlement OS against the real development backend: no demo mode, no mock
// data. Runs on the desktop and mobile projects.
async function enter(page: Page, request: Parameters<typeof signIn>[0], context: Parameters<typeof signIn>[1], next: string) {
  if (process.env.FURLPAY_E2E_DEV_SESSION === "1") await page.goto(`/api/auth/dev-session?next=${encodeURIComponent(next)}`, { timeout: 90_000 });
  else {
    await signIn(request, context, `settlement-${crypto.randomUUID()}@example.test`);
    await page.goto(next);
  }
}
const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);

test("@auth settlement onboarding: resume, validation and draft persistence", async ({ page, request, context }) => {
  test.setTimeout(120_000);
  await enter(page, request, context, "/settlement/onboarding");
  const observed = observe(page);
  await expect(page).toHaveURL(/\/settlement\/onboarding\/\w+/);
  if (!page.url().endsWith("/business")) await page.goto("/settlement/onboarding/business");
  await expect(page.getByRole("heading", { level: 1, name: "Business Information" })).toBeVisible();
  expect(await noOverflow(page)).toBe(true);

  // Required fields are enforced before anything is completed.
  const legal = page.locator("label.os-field", { hasText: "Legal Business Name" }).locator("input");
  await legal.fill("");
  await page.getByRole("button", { name: /^Continue/ }).click();
  await expect(page.locator(".os-field-error").first()).toBeVisible();
  await expect(page).toHaveURL(/\/business$/);

  // "Save and continue later" keeps an unfinished form on the server.
  const name = `QA Business ${Date.now()}`;
  await legal.fill(name);
  await page.getByRole("button", { name: "Save and continue later" }).click();
  await expect(page.getByRole("status")).toContainText("Progress saved");
  await page.reload();
  await expect(legal).toHaveValue(name);

  // A blocked step is not reachable by URL.
  await page.goto("/settlement/onboarding/review");
  await expect(page).not.toHaveURL(/\/review$/);

  expect(hydrationErrors(observed)).toEqual([]);
  expect(observed.pageErrors).toEqual([]);
});

test("@auth settlement overview: real data, navigation, search and drawer", async ({ page, request, context }) => {
  test.setTimeout(120_000);
  await enter(page, request, context, "/settlement");
  const observed = observe(page);
  await expect(page.getByRole("heading", { level: 1, name: "Settlement Overview" })).toBeVisible();
  // Every module resolves to data, an empty state or an unavailable state — never a spinner forever.
  for (const h of ["Settlement Activity", "Action Required", "System Health", "Recent Transactions", "Liquidity by Rail", "Settlement Rule"]) {
    await expect(page.getByRole("heading", { name: h })).toBeVisible();
  }
  await expect(page.locator(".os-kpi-value").first()).toBeVisible();
  expect(await noOverflow(page)).toBe(true);

  // Range control switches the chart's window.
  await page.getByRole("tab", { name: "7D" }).click();
  await expect(page.getByText("Settled volume over the last 7 days.")).toBeVisible();

  // Transaction search runs on the server; an impossible term yields the empty state.
  await page.getByLabel("Search transactions", { exact: true }).fill("zz-no-such-transaction-zz");
  await expect(page.getByText(/No transactions match/)).toBeVisible();
  await page.getByLabel("Search transactions", { exact: true }).fill("");
  const first = page.locator(".os-txid").first();
  if (await first.count()) {
    await first.click();
    const drawer = page.getByRole("dialog", { name: "Transaction details" });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText("Not recorded on this ledger entry")).toBeVisible();
    await page.keyboard.press("Escape");
  }

  // Sections are real routes inside the same shell.
  for (const [path, heading] of [
    ["/settlement/payments", "All Transactions"],
    ["/settlement/payments/receive", "Receive USDC"],
    ["/settlement/payouts/batch", "Batch Payouts"],
    ["/settlement/treasury/convert", "Convert & FX"],
    ["/settlement/virtual-accounts", "Virtual Accounts"],
    ["/settlement/compliance", "Compliance"],
    ["/settlement/reconcile", "Reconciliation"],
    ["/settlement/developers", "Developers"],
    ["/settlement/reports", "Reports & Exports"],
    ["/settlement/settings", "Settings"],
  ]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: heading, exact: true })).toBeVisible();
    expect(await noOverflow(page), `horizontal overflow in ${path}`).toBe(true);
  }
  // Unknown sections render the not-found page (status is 200 because app/loading.tsx streams first).
  await page.goto("/settlement/not-a-section");
  await expect(page.getByText("404", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Settlement Overview" })).toHaveCount(0);

  expect(hydrationErrors(observed)).toEqual([]);
  expect(observed.pageErrors).toEqual([]);
});
