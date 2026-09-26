import { test, expect, observe, hydrationErrors, realConsoleErrors, signIn, uniqueEmail } from "./fixtures";

// ---------------------------------------------------------------------------
// The cards page, in a real browser.
//
// WHAT THIS CAN AND CANNOT COVER, stated up front because the limit is real.
//
// The suite signs in through the app's own OTP flow, which calls
// `findOrCreateUserByIdentityDurable` and therefore lands on `emptyAccount()` —
// and `emptyAccount` has `cards: []` (lib/store.ts). Only the SEEDED demo account
// carries cards, and reaching it needs guest login, which is refused under
// NODE_ENV=production by design and which nothing here will re-enable.
//
// So this verifies the UNISSUED state in a browser: the page renders, hydrates,
// and shows a real empty state without throwing. That is genuinely the state a
// new customer sees, and it is the state the reveal flow reports as
// "unavailable" while no issuer is contracted. The copy deliberately does not
// promise card issuance, because that is not live — the claims linter enforces
// it, and caught an earlier draft of this very empty state.
//
// It does NOT verify the 3D card itself — the tilt, glare, holographic shimmer,
// flip or the step-up gate — because none of that renders without an issued card.
// Doing so would need a fixture that issues one, and inventing a card to make a
// test pass is the exact fabrication the component was just cleaned of.
// ---------------------------------------------------------------------------

test.describe("@auth cards page — unissued state", () => {
  test("renders and hydrates with no cards", async ({ page, request, context }) => {
    const o = observe(page);
    await signIn(request, context, uniqueEmail("cards"));

    const res = await page.goto("/cards");
    expect(res?.status()).toBe(200);

    // The API really did answer with an empty list, so this is the unissued
    // state and not a render that happened to look empty.
    await expect
      .poll(() => o.responses.some((r) => r.url.includes("/api/cards") && r.status === 200))
      .toBe(true);

    // Hydration is the whole point of running this in a browser rather than
    // curling it: the card component is client-side and pointer-driven.
    expect(hydrationErrors(o)).toEqual([]);
    expect(realConsoleErrors(o)).toEqual([]);
    expect(o.responses.filter((r) => r.status >= 500)).toEqual([]);
  });

  test("shows no card visual and no fabricated credentials", async ({ page, request, context }) => {
    await signIn(request, context, uniqueEmail("cards-empty"));
    await page.goto("/cards");
    await page.waitForLoadState("networkidle");

    const html = await page.content();

    // The values that used to be hardcoded defaults in Realistic3DCard.
    expect(html).not.toContain("842");
    expect(html).not.toContain("08/29");
    // No PAN-shaped literal anywhere in the markup.
    expect(html).not.toMatch(/\d{4}[\s-]\d{4}[\s-]\d{4}[\s-]\d{4}/);
    // And nothing leaked a stringified nullish value into the DOM.
    expect(await page.locator("body").innerText()).not.toMatch(/\bundefined\b|\bNaN\b/);
  });

  test("shows a real empty state, not an endless spinner", async ({ page, request, context }) => {
    // THE DEFECT THIS PINS, found by screenshotting the page rather than by an
    // assertion: `if (!cards.length) return <Spinner />` conflated "not fetched
    // yet" with "you have none". `cards` starts as [] and emptyAccount() seeds
    // `cards: []`, so EVERY new customer sat on a spinner forever — no card, no
    // empty state, no way to issue one.
    await signIn(request, context, uniqueEmail("cards-cta"));
    await page.goto("/cards");

    await expect(page.getByRole("heading", { name: /no cards yet/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /see card options/i })).toBeVisible();
    // The copy must not promise issuance, which is not live (claims linter).
    await expect(page.locator("body")).not.toContainText(/issue a virtual card/i);

    const body = await page.locator("body").innerText();
    expect(body).not.toContain("Application error");
  });

  test("no horizontal overflow", async ({ page, request, context }) => {
    await signIn(request, context, uniqueEmail("cards-overflow"));
    await page.goto("/cards");
    await page.waitForLoadState("networkidle");

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(2);
  });
});
