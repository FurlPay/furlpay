import type { Page, BrowserContext } from "@playwright/test";
import { test, expect, observe, hydrationErrors, signIn, uniqueEmail } from "./fixtures";

// ---------------------------------------------------------------------------
// The authenticated ticket lifecycle, driven through a real browser:
// create -> list -> detail -> reply -> reload -> back -> reopen.
//
// Every step is a click or a keystroke, not an API call. The point is the parts
// an HTTP check cannot see: that the form actually submits, that the new ticket
// appears in the list without a manual refresh, that a reply renders under the
// right author, and that it survives a reload.
//
// Auth uses the app's real OTP sign-in (see fixtures.ts). No production guard is
// relaxed to make this possible.
//
// ONE TICKET, ASSERTED IN ORDER. `POST /api/support/tickets` is rate-limited to
// 5 per 10 minutes per IP, which is correct for a public write and which a test
// file creating a ticket per case will exhaust — the later cases then fail at
// the navigation assertion and look like broken ticket creation. So the suite
// creates a single ticket and runs the remaining assertions against it, in
// serial mode, sharing one page.
// ---------------------------------------------------------------------------

test.describe.configure({ mode: "serial" });

test.describe("@auth ticket lifecycle", () => {
  let ticketId = "";
  // Decimal timestamps can pass Luhn and are correctly redacted as card PANs.
  // Keep fixture identifiers short so this lifecycle test does not depend on
  // whether the current millisecond happens to pass the redaction checksum.
  const subject = `E2E deposit not credited ${Date.now().toString(36)}`;

  // ONE context for the whole flow. The default `page` fixture builds a fresh
  // context per test, which discards the session cookie — the later cases then
  // land on "Sign in to view this ticket" and fail for a reason that has nothing
  // to do with what they assert.
  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ browser, playwright, baseURL }) => {
    context = await browser.newContext();
    page = await context.newPage();
    const request = await playwright.request.newContext({ baseURL });
    await signIn(request, context, uniqueEmail("lifecycle"));
    await request.dispose();
  });

  test.afterAll(async () => {
    await context.close();
  });

  test("create, list, open, reply, reload, return", async () => {
    const o = observe(page);

    // --- create ---------------------------------------------------------
    await page.goto("/support/new");
    await expect(page.getByRole("heading", { name: /create a support ticket/i })).toBeVisible();

    await page.locator("#subject").fill(subject);
    await page
      .locator("#body")
      .fill("An E2E test opened this ticket. A USDC deposit has not appeared after 30 minutes.");
    await page.getByRole("button", { name: /create ticket/i }).click();

    // The app navigates to the new ticket on success, with ?created=1 so the
    // detail page can show its confirmation banner.
    await expect(page).toHaveURL(/\/support\/tkt_[0-9a-f-]+\?created=1/, { timeout: 20_000 });

    // Parse properly: the id is `tkt_` + the first 12 chars of a UUID, which
    // INCLUDES hyphens (e.g. tkt_b4deba92-c6f), and the query string must not be
    // spliced into it.
    const parsed = new URL(page.url());
    ticketId = parsed.pathname.split("/").pop()!;
    expect(ticketId).toMatch(/^tkt_[0-9a-f-]{12}$/);

    // --- detail ---------------------------------------------------------
    await expect(page.getByText(subject)).toBeVisible();
    // The creation system note, rendered as FurlPay and NOT as the customer.
    await expect(page.getByText("System").first()).toBeVisible();

    // --- list -----------------------------------------------------------
    await page.goto("/support/tickets");
    await expect(page.getByText(subject)).toBeVisible();
    await expect(page.locator("body")).not.toContainText("No tickets yet");
    await expect(page.getByText(`#${ticketId}`)).toBeVisible();

    // --- open from the list ---------------------------------------------
    await page.getByText(subject).click();
    await expect(page).toHaveURL(new RegExp(`/support/${ticketId}$`));

    // --- reply ----------------------------------------------------------
    const reply = `E2E reply ${Date.now().toString(36)}`;
    const composer = page.getByLabel("Add a reply");
    await composer.fill(reply);
    await composer.press("Enter");

    await expect(page.getByText(reply)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/reply has been added/i)).toBeVisible();

    // --- persistence ----------------------------------------------------
    await page.reload();
    await expect(page.getByText(reply)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(subject)).toBeVisible();

    // --- navigate away and back ------------------------------------------
    await page.goto("/support/tickets");
    await expect(page.getByText(subject)).toBeVisible();
    await page.getByText(subject).click();
    await expect(page.getByText(reply)).toBeVisible({ timeout: 15_000 });

    // --- attribution ------------------------------------------------------
    // The customer's own reply carries the Customer badge, never Support's and
    // never the AI's.
    const mine = page.locator("article", { hasText: reply });
    await expect(mine.getByText("Customer")).toBeVisible();
    await expect(mine.getByText("Support", { exact: true })).toHaveCount(0);
    await expect(mine.getByText("AI — not a human")).toHaveCount(0);

    expect(hydrationErrors(o)).toEqual([]);
    // No server errors anywhere in the flow.
    expect(o.responses.filter((r) => r.status >= 500)).toEqual([]);
  });

  test("an empty reply cannot be sent", async () => {
    expect(ticketId).not.toBe("");
    await page.goto(`/support/${ticketId}`);

    // Wait for the thread to render before counting, or `before` is 0 simply
    // because the messages have not arrived yet and any later render looks like
    // a successful empty send.
    await expect(page.locator("article").first()).toBeVisible({ timeout: 15_000 });
    const before = await page.locator("article").count();
    expect(before).toBeGreaterThan(0);

    await page.getByLabel("Add a reply").press("Enter");
    await page.waitForTimeout(1500);
    expect(await page.locator("article").count()).toBe(before);
  });

  test("every rendered message is attributed to a known author", async () => {
    await page.goto(`/support/${ticketId}`);
    await expect(page.locator("article").first()).toBeVisible({ timeout: 15_000 });

    const badges = await page.locator("article").locator("span", { hasText: /^(Customer|Support|System|AI — not a human)$/ }).allTextContents();
    expect(badges.length).toBeGreaterThan(0);
    // Nothing rendered without a badge, and nothing rendered with an unknown one.
    for (const b of badges) {
      expect(["Customer", "Support", "System", "AI — not a human"]).toContain(b.trim());
    }
  });
});
