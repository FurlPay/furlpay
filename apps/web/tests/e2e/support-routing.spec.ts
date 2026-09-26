import { test, expect, observe, realConsoleErrors, hydrationErrors } from "./fixtures";

// ---------------------------------------------------------------------------
// Route precedence, in a real browser.
//
// The original defect: /support/new and /support/tickets were linked from the
// navbar before either route existed, so Next matched them against the dynamic
// [id] segment. The create page fetched GET /api/support/tickets/new, that
// 404'd, and the page rendered "Could not load this ticket." — an error accurate
// about what happened and useless about why.
//
// The build manifest already proves the segments are distinct. What a manifest
// cannot show is what the visitor actually sees after hydration, which is the
// gap these tests close.
// ---------------------------------------------------------------------------

const TICKET_ERROR = "Could not load this ticket";

test.describe("support routes render their own page", () => {
  test("/support is the support centre", async ({ page }) => {
    const o = observe(page);
    const res = await page.goto("/support");

    expect(res?.status()).toBe(200);
    await expect(page.locator("body")).toContainText("Support");
    await expect(page.locator("body")).not.toContainText(TICKET_ERROR);
    expect(hydrationErrors(o)).toEqual([]);
    expect(realConsoleErrors(o)).toEqual([]);
  });

  test("/support/new renders the create form, not the ticket detail page", async ({ page }) => {
    const o = observe(page);
    const res = await page.goto("/support/new");

    expect(res?.status()).toBe(200);
    // The regression, asserted the way a user would experience it.
    await expect(page.locator("body")).not.toContainText(TICKET_ERROR);
    await expect(page.getByRole("heading", { name: /create a support ticket/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /create ticket/i })).toBeVisible();

    // And the proof it was not swallowed by [id]: the detail page fetches the
    // ticket API on mount. Nothing may have asked for a ticket called "new".
    expect(o.responses.filter((r) => r.url.includes("/api/support/tickets/new"))).toEqual([]);
    expect(hydrationErrors(o)).toEqual([]);
  });

  test("/support/tickets renders the list, not ticket id 'tickets'", async ({ page }) => {
    const o = observe(page);
    const res = await page.goto("/support/tickets");

    expect(res?.status()).toBe(200);
    await expect(page.locator("body")).not.toContainText(TICKET_ERROR);
    await expect(page.getByRole("heading", { name: "Tickets", exact: true })).toBeVisible();

    expect(o.responses.filter((r) => r.url.includes("/api/support/tickets/tickets"))).toEqual([]);
    expect(hydrationErrors(o)).toEqual([]);
  });

  test("/support/<id> renders the detail page and does fetch that id", async ({ page }) => {
    const o = observe(page);
    const res = await page.goto("/support/tkt_does_not_exist");

    expect(res?.status()).toBe(200);
    // The dynamic segment IS supposed to resolve here, unlike the two above.
    await expect
      .poll(() => o.responses.some((r) => r.url.includes("/api/support/tickets/tkt_does_not_exist")))
      .toBe(true);
    expect(hydrationErrors(o)).toEqual([]);
  });
});

test.describe("navigation between support pages", () => {
  test("the Submit a ticket action reaches the form", async ({ page }) => {
    await page.goto("/support/tickets");
    await page.getByRole("link", { name: /submit a ticket/i }).first().click();

    await expect(page).toHaveURL(/\/support\/new$/);
    await expect(page.getByRole("heading", { name: /create a support ticket/i })).toBeVisible();
    await expect(page.locator("body")).not.toContainText(TICKET_ERROR);
  });

  test("client-side navigation does not reintroduce the precedence bug", async ({ page }) => {
    // A soft navigation goes through the router rather than the server, so it
    // can resolve differently from a cold load. Both must land on the form.
    const o = observe(page);
    await page.goto("/support");
    await page.evaluate(() => window.history.pushState({}, "", "/support/new"));
    await page.goto("/support/new");

    await expect(page.getByRole("heading", { name: /create a support ticket/i })).toBeVisible();
    expect(o.responses.filter((r) => r.url.includes("/api/support/tickets/new"))).toEqual([]);
  });
});

test.describe("no page scrolls sideways", () => {
  for (const path of ["/support", "/support/new", "/support/tickets"]) {
    test(`${path} has no horizontal overflow`, async ({ page }) => {
      await page.goto(path);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      // A couple of pixels can come from scrollbar rounding; a real overflow is
      // much larger and is what breaks a phone.
      expect(overflow).toBeLessThanOrEqual(2);
    });
  }
});
