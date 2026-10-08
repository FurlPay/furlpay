import { test, expect, type Page } from "@playwright/test";
import { signIn } from "./fixtures";

// Compliance workspace against the real development backend. The officer is the
// development seed account (compliance_officer outside production, via the
// dev-session helper); the applicant is a fresh mock-OTP account.
const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
const shots = process.env.E2E_SHOT_DIR;

test("@auth compliance overview: officer sees real figures, every module resolves", async ({ page, browser, isMobile }) => {
  test.setTimeout(180_000);
  const ctx = await browser.newContext(isMobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } });
  const officer = await ctx.newPage();
  await officer.goto("/api/auth/dev-session?next=/ops/compliance", { timeout: 90_000 });
  await expect(officer.getByRole("heading", { level: 1, name: /Secure identity/ })).toBeVisible({ timeout: 60_000 });
  const kpis = officer.getByTestId("compliance-kpis");
  await expect(kpis).toContainText("Businesses (KYB)");
  // No durable user store in local dev → shown as unavailable, not as a number.
  await expect(kpis).toContainText("No durable user store");
  await expect(kpis).toContainText("Settlement execution is not implemented");
  await expect(officer.getByRole("region", { name: "Compliance health" })).toContainText("/ 100");
  await expect(officer.getByRole("region", { name: "Capabilities" })).toContainText("Not available");
  await expect(officer.locator('nav[aria-label="Settlement"] [aria-current="page"]')).toHaveText(["Compliance"]);
  expect(await noOverflow(officer)).toBe(true);
  if (shots) await officer.screenshot({ path: `${shots}/compliance-overview-${isMobile ? 390 : 1440}.png`, fullPage: true });

  for (const id of ["kyc", "kyb", "aml", "fraud", "monitoring", "travel", "india", "policies", "reports", "settings"]) {
    await officer.goto(`/ops/compliance/${id}`);
    await expect(officer.getByRole("heading", { level: 1 }), id).toBeVisible();
    expect(await noOverflow(officer), id).toBe(true);
  }
  await officer.goto("/ops/compliance/constructor");
  await expect(officer.getByText(/not found|404/i).first()).toBeVisible();
  await ctx.close();

  // An applicant (no compliance role) gets 403 from the API and the denial state in the UI.
  await signIn(page.request, page.context(), `applicant-${crypto.randomUUID()}@example.test`);
  expect((await page.request.get("/api/compliance/overview")).status()).toBe(403);
  await page.goto("/ops/compliance");
  await expect(page.getByText("limited to FurlPay compliance officers")).toBeVisible();
});
