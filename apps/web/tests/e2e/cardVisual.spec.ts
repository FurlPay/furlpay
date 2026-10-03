import { test, expect, observe, hydrationErrors, signIn } from "./fixtures";
import { DEMO_USER_EMAIL } from "@/lib/store";

// ---------------------------------------------------------------------------
// The 3D card, with an ISSUED card, in a real browser.
//
// THE FIXTURE IS THE ONE THAT ALREADY EXISTS. No new endpoint, no new seed data,
// no test-only route was added to reach this state — the repo already has a
// dev-only seeded account (`DEMO_USER_EMAIL` in lib/store.ts) that carries two
// cards, and it is reachable through the app's REAL OTP sign-in because
// `findUserByIdentity` resolves by email.
//
// WHY THAT CANNOT LEAK INTO PRODUCTION, by two independent guards:
//
//  1. Mock OTP — the only way this suite learns a code — is refused outright
//     when NODE_ENV=production (`assertLiveInProduction` in lib/auth/otp.ts).
//     Without it there is no code to submit and sign-in cannot complete.
//  2. `getDevelopmentDemoAccount()` returns undefined in production, always, and
//     lib/store.ts documents that as the deliberate single home of the guard.
//
// So nothing here weakens a production boundary: the test moved to where the
// fixture already lives, rather than the fixture moving toward production.
//
// The seeded card's `last4` is synthetic seed data that predates this work. The
// card's CVV / PAN / expiry are NOT seeded and are NOT passed — they stay masked,
// which is the honest state while no issuer is contracted.
//
// RATE LIMIT: otp/start allows 5 per 10 minutes PER RECIPIENT, and every test
// here signs in as the same demo email. Serial, with one shared context, or the
// later tests 429 and fail for a reason that has nothing to do with the card.
// ---------------------------------------------------------------------------

test.describe.configure({ mode: "serial" });

test.describe("@auth issued card — 3D visual", () => {
  let page: import("@playwright/test").Page;
  let context: import("@playwright/test").BrowserContext;

  test.beforeAll(async ({ browser, playwright, baseURL }) => {
    context = await browser.newContext();
    page = await context.newPage();
    const request = await playwright.request.newContext({ baseURL });
    await signIn(request, context, DEMO_USER_EMAIL);
    await request.dispose();
  });

  test.afterAll(async () => {
    await context?.close();
  });

  const cardLocator = () => page.getByRole("button", { name: /Everyday Virtual/i }).first();

  test("renders the issued card with no fabricated credentials", async () => {
    const o = observe(page);
    await page.goto("/cards");
    await expect(cardLocator()).toBeVisible({ timeout: 20_000 });

    const body = await page.locator("body").innerText();

    // Real seeded data renders.
    expect(body).toContain("Everyday Virtual");
    expect(body).toContain("4417"); // seeded synthetic last4
    expect(body).toContain("USD"); // settlement currency
    expect(body).toContain("VISA");

    // Credentials we do NOT hold stay masked — the whole point of the masking
    // work. Expiry and CVV are not seeded and must not be invented.
    expect(body).toContain("••/••");
    expect(body).toContain("•••");

    // The values that were once hardcoded defaults.
    expect(body).not.toContain("842");
    expect(body).not.toContain("08/29");
    // No full PAN, and no stringified nullish leaking through the masking.
    expect(body).not.toMatch(/\d{4}[\s-]\d{4}[\s-]\d{4}[\s-]\d{4}/);
    expect(body).not.toMatch(/\bundefined\b|\bnull\b|\bNaN\b/);

    expect(hydrationErrors(o)).toEqual([]);
    expect(o.responses.filter((r) => r.status >= 500)).toEqual([]);
  });

  test("one card fills the slide — the neighbour is not clipped", async () => {
    // THE DEFECT THIS PINS, found by screenshotting at 1440x900: the track had
    // `px-5`, so each `basis-full` slide resolved against the track's CONTENT box
    // (440 − 40 = 400) and came out narrower than the scroll viewport. The next
    // card peeked in and sat clipped at the edge. The gutter moved onto the
    // slides.
    await page.goto("/cards");
    await expect(cardLocator()).toBeVisible({ timeout: 20_000 });

    const m = await page.evaluate(() => {
      const track = document.querySelector<HTMLElement>(".snap-x");
      if (!track) return null;
      const tw = track.getBoundingClientRect().width;
      const slides = [...track.children].map((s) => s.getBoundingClientRect().width);
      return { tw, slides };
    });

    expect(m).not.toBeNull();
    // Every slide is exactly one scroll viewport wide.
    for (const w of m!.slides) expect(Math.abs(w - m!.tw)).toBeLessThanOrEqual(1);
  });

  test("is reachable and activatable by keyboard", async () => {
    await page.goto("/cards");
    const card = cardLocator();
    await expect(card).toBeVisible({ timeout: 20_000 });

    await card.focus();
    expect(await card.evaluate((el) => el === document.activeElement)).toBe(true);

    // Enter reaches the handler: the card enters its authorizing state, and it
    // does not open, because the step-up cannot complete headlessly. That is the
    // correct fail-closed outcome, not a broken test.
    //
    // HOW LONG the authorizing state lasts depends on the device: on desktop the
    // passkey ceremony stays pending, but on the mobile project there is no
    // platform authenticator, so the gate refuses within milliseconds
    // (app/cards/page.tsx: isFingerprintAvailable() → false). Polling for the
    // transient label raced that refusal. Every label the card ever shows is
    // recorded instead, so the test asserts the state was entered AND that the
    // card stayed closed afterwards.
    await card.evaluate((el) => {
      const seen: string[] = [el.getAttribute("aria-label") ?? ""];
      (window as unknown as { __cardLabels: string[] }).__cardLabels = seen;
      new MutationObserver(() => seen.push(el.getAttribute("aria-label") ?? "")).observe(el, {
        attributes: true,
        attributeFilter: ["aria-label"],
      });
    });
    await page.keyboard.press("Enter");
    await expect
      .poll(async () => page.evaluate(() => (window as unknown as { __cardLabels: string[] }).__cardLabels.join("\n")), {
        timeout: 10_000,
      })
      .toMatch(/confirming your identity/i);
    // Fail closed: whatever the gate did, the card never turned to its back face.
    await expect(card).toHaveAttribute("aria-label", /showing front/i);
    expect(await page.evaluate(() => (window as unknown as { __cardLabels: string[] }).__cardLabels.some((l) => /showing back/i.test(l)))).toBe(false);
  });

  test("the accessible name states real state, not an input device", async () => {
    await page.goto("/cards");
    const card = cardLocator();
    await expect(card).toBeVisible({ timeout: 20_000 });

    const label = await card.getAttribute("aria-label");
    expect(label).toContain("Everyday Virtual");
    expect(label).toContain("Visa");
    expect(label).toMatch(/showing front/i);
    expect(label).toMatch(/activate to turn over/i);
    // "Click to flip" is wrong for exactly the users a label serves.
    expect(label).not.toMatch(/click/i);

    expect(await card.getAttribute("aria-pressed")).toBe("false");
  });

  test("tilts under pointer movement", async () => {
    await page.goto("/cards");
    const card = cardLocator();
    await expect(card).toBeVisible({ timeout: 20_000 });

    const before = await card.evaluate((el) => (el as HTMLElement).style.transform);
    const box = (await card.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.2);
    await page.waitForTimeout(150);
    const after = await card.evaluate((el) => (el as HTMLElement).style.transform);

    // Behavioural, not a timing assertion: the transform changed and now carries
    // a non-zero rotation.
    expect(after).not.toBe(before);
    expect(after).toMatch(/rotateX\(-?\d/);
  });
});

test.describe("@auth issued card — reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("suppresses tilt but keeps the card usable", async ({ page, playwright, context, baseURL }) => {
    const request = await playwright.request.newContext({ baseURL });
    await signIn(request, context, DEMO_USER_EMAIL);
    await request.dispose();

    await page.goto("/cards");
    const card = page.getByRole("button", { name: /Everyday Virtual/i }).first();
    await expect(card).toBeVisible({ timeout: 20_000 });

    // Tilt is pure decoration and must not move.
    const before = await card.evaluate((el) => (el as HTMLElement).style.transform);
    const box = (await card.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.2);
    await page.waitForTimeout(200);
    const after = await card.evaluate((el) => (el as HTMLElement).style.transform);
    expect(after).toBe(before);
    expect(after).toMatch(/rotateX\(0deg\)/);

    // The flip transition collapses to effectively instant, but is NOT removed:
    // the face change is the only way to see the back of the card.
    const transition = await card.evaluate((el) => (el as HTMLElement).style.transition);
    expect(transition).toContain("0.01s");

    // Still focusable and still announces itself.
    await card.focus();
    expect(await card.evaluate((el) => el === document.activeElement)).toBe(true);
    expect(await card.getAttribute("aria-label")).toMatch(/activate to turn over/i);
  });
});
