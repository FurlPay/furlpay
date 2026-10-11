import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { signIn, observe, hydrationErrors } from "./fixtures";
import { business, details, identity, REQUIRED_DOCS, settlement, treasury } from "../../src/lib/settlement/__tests__/fixtures";

// Activation journey against the real development backend with two identities:
//   applicant — a fresh mock-OTP account (identity UNVERIFIED: no KYC provider
//               exists locally, so the identity gate can never pass here)
//   reviewer  — the development seed account (compliance_officer outside production)
// Step data is entered through the real onboarding API with test-only fixtures;
// Review & Activate, the reviewer queue and every decision are driven in the UI.
// Needs: INTEGRATION_MODE=mock and FURLPAY_DEV_AUTO_LOGIN=1 on a non-production dev server.

const API = "/api/settlement/onboarding";
const pdf = Buffer.from("%PDF-1.4\n%%EOF");
const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
const shots = process.env.E2E_SHOT_DIR;

async function put(r: APIRequestContext, step: string, data: unknown) {
  const res = await r.put(API, { data: { step, data, complete: true } });
  return { status: res.status(), body: await res.json() };
}

async function fill(r: APIRequestContext, legalName: string) {
  expect((await put(r, "business", { ...business, legalName })).status).toBe(200);
  for (const kind of REQUIRED_DOCS) {
    const res = await r.post(`${API}/documents`, { multipart: { kind, file: { name: `${kind}.pdf`, mimeType: "application/pdf", buffer: pdf } } });
    expect(res.status()).toBe(201);
  }
  expect((await put(r, "identity", identity)).status).toBe(200);
  expect((await put(r, "details", details)).status).toBe(200);
  const screen = await r.post(API, { data: { action: "screen" } });
  expect(screen.status()).toBe(200);
  expect((await screen.json()).state.screening.status).toBe("clear");
  expect((await r.post(API, { data: { action: "complete", step: "compliance" } })).status()).toBe(200);
  expect((await put(r, "treasury", treasury)).status).toBe(200);
}

test("@auth activation: preflight gates, compliance review, identity stays blocking", async ({ page, request, context, browser }) => {
  test.setTimeout(240_000);
  await signIn(request, context, `activation-${crypto.randomUUID()}@example.test`);
  const legalName = `Northwind Analytics ${Date.now()}`;
  await fill(page.request, legalName);
  const observed = observe(page);

  // Split editor (UI): 100% enforced client-side, preview updates live.
  await page.goto("/settlement/onboarding/settlement");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.getByText("Custom Split", { exact: true }).first().click();
  const pcts = page.getByLabel("Percentage");
  const pct = pcts.first();
  const cont = page.getByRole("button", { name: /^Continue/ });
  const totalBox = page.getByTestId("split-total");
  await pct.fill("90");
  await expect(totalBox).toContainText("90%");
  await expect(totalBox).toContainText("10% remaining");
  await expect(page.getByText("Your settlement rules must total 100% (currently 90%).")).toBeVisible();
  await expect(cont).toBeDisabled();
  const legend = page.locator(".os-donut-legend");
  await expect(legend).toContainText("900 USDC (90%)");
  await page.getByLabel("Example payment amount in USDC").fill("2000");
  await expect(legend).toContainText("1,800 USDC (90%)");
  await pct.fill("100");
  await expect(cont).toBeEnabled();
  await expect(totalBox).toContainText("Ready");
  await expect(legend).toContainText("2,000 USDC (100%)");
  // Template 80/15/5 → valid; 80/30/5 → 15% over; delete a rule → recalculated.
  await page.getByLabel("Use a template").selectOption({ label: "Marketplace split (80 / 15 / 5)" });
  await expect(pcts).toHaveCount(3);
  await expect(totalBox).toContainText("100%");
  await expect(cont).toBeEnabled();
  await pcts.nth(1).fill("30");
  await expect(totalBox).toContainText("115%");
  await expect(totalBox).toContainText("15% over allocation");
  if (shots) await page.locator(".os-section").nth(1).screenshot({ path: `${shots}/split-over.png` });
  await expect(cont).toBeDisabled();
  await page.getByRole("button", { name: "Delete rule" }).nth(1).click();
  await expect(pcts).toHaveCount(2);
  await expect(totalBox).toContainText("85%");
  await expect(totalBox).toContainText("15% remaining");
  // Adding a rule takes exactly the unallocated share, never more.
  await page.getByRole("button", { name: /Add Split Rule/ }).click();
  await expect(pcts).toHaveCount(3);
  await expect(pcts.nth(2)).toHaveValue("15");
  await expect(totalBox).toContainText("Ready");
  // Negative and empty values are flagged and block Continue.
  await pcts.nth(2).fill("-1");
  await expect(page.getByText("Percentages cannot be negative.")).toBeVisible();
  await expect(cont).toBeDisabled();
  await pcts.nth(2).fill("");
  await expect(page.getByText("Enter a percentage.")).toBeVisible();
  await expect(cont).toBeDisabled();
  await expect(page.locator('nav[aria-label="Settlement"] [aria-current="page"]')).toHaveCount(0); // onboarding: no top tab

  // Failure path: invalid settlement rules (95%) are refused by the server.
  expect((await put(page.request, "settlement", settlement([80, 15]))).status).toBe(422);
  expect((await put(page.request, "settlement", settlement([80, 15, 5]))).status).toBe(200);

  // Failure path: identity pending + compliance review pending → Activate disabled with a reason.
  await page.goto("/settlement/onboarding/review");
  await expect(page.getByRole("heading", { level: 1, name: "Review & Activate" })).toBeVisible();
  const activate = page.getByRole("button", { name: /Activate Account/ });
  await expect(activate).toBeDisabled();
  await expect(page.getByTestId("activate-reason")).toContainText(/Identity verification|compliance review|Documents/i);
  await expect(page.getByText("Compliance review approved · Pending")).toBeVisible();
  await expect(page.getByText(/Identity verified · Not configured/)).toBeVisible();
  await expect(page.getByText("Configured — not executing").first()).toBeVisible();
  // The server refuses activation outright, independent of the disabled button.
  const refused = await page.request.post(API, { data: { action: "activate" } });
  expect(refused.status()).toBe(409);
  expect((await refused.json()).blockers).toEqual(expect.arrayContaining(["identity_verification_pending", "compliance_review_pending", "documents_pending_review"]));

  // An applicant cannot open the reviewer workspace.
  expect((await page.request.get(`${API}/review`)).status()).toBe(403);

  // Reviewer (separate browser context = separate session) approves documents and the case.
  const rc = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const reviewer = await rc.newPage();
  await reviewer.goto("/api/auth/dev-session?next=/ops/compliance/reviews", { timeout: 90_000 });
  await expect(reviewer.getByRole("heading", { name: "Onboarding reviews" })).toBeVisible({ timeout: 30_000 });
  await expect(reviewer.locator('nav[aria-label="Settlement"] [aria-current="page"]')).toHaveText(["Compliance"]);
  await reviewer.getByRole("button", { name: new RegExp(legalName) }).click();
  await expect(reviewer.getByRole("heading", { level: 2, name: legalName })).toBeVisible();
  // Approving the case before the documents is refused with a reason.
  await reviewer.getByRole("button", { name: "Approve case" }).click();
  await expect(reviewer.getByText(/Approve the required documents first/)).toBeVisible();
  for (let i = 0; i < REQUIRED_DOCS.length; i++) {
    const approve = reviewer.getByRole("button", { name: "Approve", exact: true }).and(reviewer.locator(":not([disabled])")).first();
    await approve.click();
    await expect(reviewer.getByRole("button", { name: "Approve", exact: true }).and(reviewer.locator("[disabled]"))).toHaveCount(i + 1);
  }
  await reviewer.getByLabel(/Reason/).fill("Documents legible and consistent; screening clear.");
  await reviewer.getByRole("button", { name: "Approve case" }).click();
  await expect(reviewer.getByText("Approve case", { exact: false }).last()).toBeVisible();
  await expect(reviewer.locator("ol.os-list li").first()).toContainText(/Approve case/i);
  if (shots) await reviewer.screenshot({ path: `${shots}/reviewer-1440.png`, fullPage: true });
  expect(await noOverflow(reviewer)).toBe(true);
  await rc.close();

  // Back to the applicant: review approved, documents approved — identity alone still blocks.
  await page.reload();
  await expect(page.getByText("Compliance review approved · Complete")).toBeVisible();
  await expect(page.getByText("Documents approved · Complete")).toBeVisible();
  await expect(activate).toBeDisabled();
  await expect(page.getByTestId("activate-reason")).toHaveText(/^Identity verification/);
  const still = await page.request.post(API, { data: { action: "activate" } });
  expect((await still.json()).blockers).toEqual(["identity_verification_pending", "identity_provider_not_configured"]);

  // Viewport sweep of the preflight screen.
  for (const width of [1440, 1280, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: width < 500 ? 844 : 900 });
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "Review & Activate" })).toBeVisible();
    expect(await noOverflow(page), `horizontal overflow at ${width}px`).toBe(true);
    if (shots) await page.screenshot({ path: `${shots}/review-${width}.png`, fullPage: true });
  }

  expect(hydrationErrors(observed)).toEqual([]);
  expect(observed.pageErrors).toEqual([]);
});
