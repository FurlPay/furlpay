import { test, expect } from "@playwright/test";
import { signIn } from "./fixtures";

// Route manifest for the Settlement OS: every intended URL is a real page, a
// redirect to one, or a 404 — and none is reachable without a session.

const PAGES = [
  "/settlement",
  "/settlement/payments",
  "/settlement/payments/transactions",
  "/settlement/payments/receive",
  "/settlement/payments/links",
  "/settlement/payments/invoices",
  "/settlement/payments/checkout",
  "/settlement/payouts",
  "/settlement/payouts/send",
  "/settlement/payouts/batch",
  "/settlement/payouts/schedules",
  "/settlement/payouts/approvals",
  "/settlement/payouts/beneficiaries",
  "/settlement/treasury",
  "/settlement/treasury/balances",
  "/settlement/treasury/convert",
  "/settlement/treasury/rules",
  "/settlement/virtual-accounts",
  "/settlement/compliance",
  "/settlement/reconcile",
  "/settlement/developers",
  "/settlement/reports",
  "/settlement/settings",
  "/settlement/onboarding",
  "/settlement/onboarding/business-information",
  "/settlement/onboarding/identity",
  "/settlement/onboarding/business-details",
  "/settlement/onboarding/compliance",
  "/settlement/onboarding/treasury",
  "/settlement/onboarding/settlement",
  "/settlement/onboarding/review",
  "/ops/compliance/reviews",
];

const APIS: [string, string][] = [
  ["GET", "/api/settlement/onboarding"],
  ["PUT", "/api/settlement/onboarding"],
  ["POST", "/api/settlement/onboarding"],
  ["POST", "/api/settlement/onboarding/documents"],
  ["DELETE", "/api/settlement/onboarding/documents?id=00000000-0000-4000-8000-000000000000"],
  ["GET", "/api/settlement/onboarding/review"],
  ["POST", "/api/settlement/onboarding/review"],
  ["GET", "/api/settlement/onboarding/review/document?owner=x&id=00000000-0000-4000-8000-000000000000"],
  ["GET", "/api/settlement/workspace"],
  ["POST", "/api/settlement/workspace"],
  ["GET", "/api/settlement/transactions"],
];

test.describe("settlement routes — signed out", () => {
  test("every page sends the visitor to sign in, preserving the destination", async ({ playwright, baseURL }) => {
    const anon = await playwright.request.newContext({ baseURL });
    for (const path of PAGES) {
      const r = await anon.get(path, { maxRedirects: 0 });
      expect(r.status(), path).toBe(307);
      const to = new URL(r.headers()["location"], baseURL);
      // /login in production; /api/auth/dev-session only when FURLPAY_DEV_AUTO_LOGIN=1 on a dev server.
      expect(["/login", "/api/auth/dev-session"], path).toContain(to.pathname);
      expect(to.searchParams.get("next"), path).toBe(path);
    }
    await anon.dispose();
  });

  test("every settlement API refuses without a session", async ({ playwright, baseURL }) => {
    const anon = await playwright.request.newContext({ baseURL });
    for (const [method, path] of APIS) {
      const r = await anon.fetch(path, { method, maxRedirects: 0, ...(method === "GET" || method === "DELETE" ? {} : { data: {} }) });
      expect([401, 403], `${method} ${path}`).toContain(r.status());
    }
    await anon.dispose();
  });
});

test.describe("settlement routes — signed in", () => {
  test("@auth canonical pages render, aliases redirect once, unknown pages 404", async ({ request, context, page }) => {
    test.setTimeout(180_000);
    await signIn(request, context, `routes-${crypto.randomUUID()}@example.test`);
    for (const path of PAGES.filter((p) => !p.startsWith("/ops/"))) {
      const r = await page.request.get(path, { maxRedirects: 0, timeout: 90_000 });
      expect(r.status(), path).toBe(200);
    }
    const aliases: [string, string][] = [
      ["/settlement/onboarding/business", "/settlement/onboarding/business-information"],
      ["/settlement/onboarding/details", "/settlement/onboarding/business-details"],
      ["/settlement/onboarding/verify-identity", "/settlement/onboarding/identity"],
      ["/settlement/onboarding/review-activate", "/settlement/onboarding/review"],
      ["/settlement/rules", "/settlement/treasury/rules"],
      ["/settlement/activity", "/settlement/payments/transactions"],
    ];
    for (const [from, to] of aliases) {
      const r = await page.request.get(from, { maxRedirects: 0, timeout: 90_000 });
      expect(r.status(), from).toBe(308);
      expect(new URL(r.headers()["location"], "http://x").pathname, from).toBe(to);
    }
    for (const path of ["/settlement/payments/bogus", "/settlement/compliance/x", "/settlement/nope", "/settlement/onboarding/constructor", "/settlement/onboarding/review/x"]) {
      await page.goto(path);
      await expect(page.getByText(/not found|404/i).first(), path).toBeVisible();
    }
    // A signed-in applicant is not a compliance officer: the review API refuses.
    expect((await page.request.get("/api/settlement/onboarding/review")).status()).toBe(403);
    // No placeholder links anywhere in the shell.
    await page.goto("/settlement");
    expect(await page.locator('a[href="#"], a[href^="javascript:"]').count()).toBe(0);
  });
});
