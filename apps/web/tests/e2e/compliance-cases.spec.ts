import { test, expect, type Page } from "@playwright/test";
import { signIn } from "./fixtures";
import { business, identity, REQUIRED_DOCS } from "../../src/lib/settlement/__tests__/fixtures";

// Case management, monitoring and reports against the real development backend.
// Applicant: a fresh mock-OTP account. Officer: the development seed account.
const API = "/api/settlement/onboarding";
const pdf = Buffer.from("%PDF-1.4\n%%EOF");
const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
const shots = process.env.E2E_SHOT_DIR;

test("@auth compliance cases: review submission opens one case; officer works it to resolution; monitoring and reports", async ({ page, request, context, browser, isMobile }) => {
  test.setTimeout(240_000);
  const applicant = await signIn(request, context, `cases-${crypto.randomUUID()}@example.test`);
  const legalName = `Casework Ltd ${Date.now()}`;
  expect((await page.request.put(API, { data: { step: "business", data: { ...business, legalName }, complete: true } })).status()).toBe(200);
  for (const kind of REQUIRED_DOCS) expect((await page.request.post(`${API}/documents`, { multipart: { kind, file: { name: `${kind}.pdf`, mimeType: "application/pdf", buffer: pdf } } })).status()).toBe(201);
  expect((await page.request.put(API, { data: { step: "identity", data: identity, complete: true } })).status()).toBe(200); // → review pending
  // The applicant cannot see cases.
  expect((await page.request.get("/api/compliance/cases")).status()).toBe(403);

  const ctx = await browser.newContext(isMobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } });
  const officer = await ctx.newPage();
  await officer.goto("/api/auth/dev-session?next=/ops/compliance/cases", { timeout: 90_000 });
  await expect(officer.getByRole("heading", { level: 1, name: "Case Management" })).toBeVisible({ timeout: 60_000 });
  // Exactly one case for this submission, even after a second sync.
  const list = async () => (await (await officer.request.get("/api/compliance/cases?status=all")).json()).cases.filter((c: { title: string }) => c.title.includes(legalName));
  expect(await list()).toHaveLength(1);
  await officer.getByRole("button", { name: "Refresh" }).click();
  expect(await list()).toHaveLength(1);

  await officer.getByRole("button", { name: new RegExp(legalName) }).click();
  const detail = officer.getByRole("region", { name: "Case detail" });
  await expect(detail.getByRole("heading", { level: 2, name: new RegExp(legalName) })).toBeVisible();
  await expect(detail).toContainText("Linked onboarding case");
  const reason = detail.getByLabel(/Reason \/ note/);
  await detail.getByRole("button", { name: "Triage" }).click();
  await expect(detail.getByRole("button", { name: "Triage" })).toHaveCount(0);
  await expect(detail.getByRole("button", { name: "Escalate" })).toBeVisible();
  // Reason-gated actions stay disabled until a reason is given.
  await expect(detail.getByRole("button", { name: "Escalate" })).toBeDisabled();
  await reason.fill("Needs senior review of ownership chain");
  await detail.getByRole("button", { name: "Escalate" }).click();
  await expect(detail.getByRole("button", { name: "Start investigation" })).toBeVisible();
  await detail.getByRole("button", { name: "Start investigation" }).click();
  await expect(detail.getByRole("button", { name: "Request decision" })).toBeVisible(); // status is now INVESTIGATING
  await reason.fill("Documents consistent; ownership verified against filing");
  await detail.getByRole("button", { name: "Resolve" }).click();
  // The case cannot claim resolved while the onboarding review is still pending.
  await expect(detail).toContainText("Decide the onboarding review first");

  // A manually opened case resolves through the same workflow.
  const manual = await officer.request.post("/api/compliance/cases", { data: { type: "fraud", subjectType: "individual", subjectId: applicant.userId, title: `Login anomaly ${legalName}`, severity: "high", reason: "Customer reported unrecognised login" } });
  expect(manual.status()).toBe(201);
  await officer.getByRole("button", { name: "Refresh" }).click();
  await officer.getByRole("button", { name: new RegExp(`Login anomaly ${legalName}`) }).click();
  await detail.getByRole("button", { name: "Triage" }).click();
  await expect(detail.getByRole("button", { name: "Triage" })).toHaveCount(0);
  await reason.fill("Pattern matches credential stuffing");
  await detail.getByRole("button", { name: "Escalate" }).click();
  await expect(detail.getByRole("button", { name: "Start investigation" })).toBeVisible();
  await detail.getByRole("button", { name: "Start investigation" }).click();
  await expect(detail.getByRole("button", { name: "Request decision" })).toBeVisible();
  await reason.fill("Documents consistent; sessions revoked and customer confirmed");
  await detail.getByRole("button", { name: "Resolve" }).click();
  await expect(detail).toContainText("Resolved: No action — Documents consistent");
  const timeline = detail.getByRole("list", { name: "Case timeline" });
  for (const a of ["Opened", "Triage", "Escalate", "Start", "Resolve"]) await expect(timeline).toContainText(a);
  expect(await noOverflow(officer)).toBe(true);
  if (shots) await officer.screenshot({ path: `${shots}/cases-${isMobile ? 390 : 1440}.png`, fullPage: true });

  // Monitoring back-test on the applicant's (empty) ledger: evaluated, nothing opened.
  await officer.goto("/ops/compliance/monitoring");
  await expect(officer.getByRole("region", { name: "Monitoring rules" })).toContainText("Structuring");
  await expect(officer.getByRole("region", { name: "Monitoring rules" })).toContainText("Ledger rows do not record the counterparty address");
  await officer.getByLabel("Account id").fill(applicant.userId);
  await officer.getByRole("button", { name: "Evaluate" }).click();
  await expect(officer.getByTestId("monitoring-result")).toContainText("back-test, no cases opened");

  // Reports: the download link serves a CSV with this case in it, without PII.
  await officer.goto("/ops/compliance/reports");
  const href = await officer.getByRole("link", { name: "Download CSV" }).getAttribute("href");
  const csv = await officer.request.get(href!);
  expect(csv.status()).toBe(200);
  expect(csv.headers()["content-type"]).toContain("text/csv");
  const text = await csv.text();
  expect(text).toContain(legalName);
  expect(text).not.toContain("avery@example.test");
  expect(text).not.toContain("1988-10-15");
  await ctx.close();
});
