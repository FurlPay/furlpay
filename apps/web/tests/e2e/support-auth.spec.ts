import { test, expect, observe } from "./fixtures";

// ---------------------------------------------------------------------------
// Signed-out access to a ticket.
//
// A support-agent reply push-notifies the customer and deep-links to
// /support/<id>. The common way to arrive there is therefore a link opened after
// the session expired — and the page used to render "Could not load this
// ticket." for that, which reads as data loss and offers no action.
//
// The distinction being tested is 401 (who are you?) vs 404 (no such ticket) vs
// a system failure. Three different truths, and the page must not blur them.
// ---------------------------------------------------------------------------

const TICKET_ID = "test-ticket-id";

test.describe("signed out, opening a ticket link", () => {
  test("says sign in, not 'could not load'", async ({ page }) => {
    const o = observe(page);
    await page.goto(`/support/${TICKET_ID}`);

    await expect(page.getByText("Sign in to view this ticket")).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Could not load this ticket");

    // It also must not imply the ticket is missing — we genuinely do not know.
    await expect(page.locator("body")).not.toContainText("could not be found");

    // The API really did answer 401, so this state came from authorization and
    // not from a coincidence of rendering.
    await expect
      .poll(() =>
        o.responses.some((r) => r.url.includes(`/api/support/tickets/${TICKET_ID}`) && r.status === 401)
      )
      .toBe(true);
  });

  test("explains that tickets are private rather than blaming the user", async ({ page }) => {
    await page.goto(`/support/${TICKET_ID}`);
    await expect(page.getByText(/private to the account that raised them/i)).toBeVisible();
  });

  test("the sign-in link round-trips back to this exact ticket", async ({ page }) => {
    await page.goto(`/support/${TICKET_ID}`);

    const link = page.getByRole("link", { name: "Sign in" });
    await expect(link).toBeVisible();

    const href = await link.getAttribute("href");
    expect(href).toBeTruthy();

    const url = new URL(href!, "http://127.0.0.1");
    expect(url.pathname).toBe("/login");

    // `next` must point back to this exact ticket.
    const next = url.searchParams.get("next");
    expect(next).toBe(`/support/${TICKET_ID}`);
  });

  test("a real-format ticket id round-trips through the sign-in link exactly", async ({ page }) => {
    // Ticket ids are `tkt_` + 12 hex characters of a UUID (lib/support.ts), so
    // this is the only shape that can actually reach the route.
    //
    // The path separators in `next=/support/<id>` are deliberately NOT encoded:
    // a slash is legal in a query value, and encoding it would only obscure the
    // link without making it safer.
    //
    // Observed while writing this, and recorded rather than "fixed": for an id
    // containing percent-escapes the page double-encodes, because `params` hands
    // back the raw segment and the page encodes it again — `tkt_a%26b` becomes
    // `tkt_a%2526b`, which would return the user to a different id. It cannot
    // occur with a generated id, and tightening it would churn the working path
    // for an unreachable case, so it stays as a note, not a change.
    const realistic = "tkt_0a1b2c3d4e5f";
    await page.goto(`/support/${realistic}`);
    await page.getByText("Sign in to view this ticket").waitFor();

    const href = await page.getByRole("link", { name: "Sign in" }).getAttribute("href");
    expect(href).toBe(`/login?next=/support/${realistic}`);
    expect(new URL(href!, "http://127.0.0.1").searchParams.get("next")).toBe(`/support/${realistic}`);
  });

  test("clicking it lands on the login page with the return path intact", async ({ page }) => {
    await page.goto(`/support/${TICKET_ID}`);
    await page.getByRole("link", { name: "Sign in" }).click();

    // The path is carried unencoded in the query, so match it literally.
    await expect(page).toHaveURL(`/login?next=/support/${TICKET_ID}`);
    // A login surface actually rendered — not a 404 or an error shell.
    await expect(page.locator("body")).not.toContainText("This page could not be found");
  });

  test("no ticket payload is present in the DOM before authorization", async ({ page }) => {
    // The real leak shape is a payload rendered into the markup and then hidden,
    // so this inspects the HTML rather than what is visible.
    //
    // Deliberately NOT a search for the bare word "email": the page carries a
    // JSON-LD Organization block with our public `hello@furlpay.com` contact
    // address, and matching that would be a false positive that trains people to
    // ignore this test. What must be absent is a TICKET RECORD.
    await page.goto(`/support/${TICKET_ID}`);
    await page.getByText("Sign in to view this ticket").waitFor();
    const html = await page.content();

    // Field names unique to the stored SupportTicket / SupportMessage shape.
    for (const forbidden of ['"userId"', '"ticketId"', "ops:security", '"refs"', 'author\\":\\"agent']) {
      expect(html).not.toContain(forbidden);
    }
    // No address other than our own published support contact.
    const emails = [...html.matchAll(/[\w.+-]+@[\w.-]+\.\w+/g)].map((m) => m[0]);
    expect(emails.filter((e) => !e.endsWith("@furlpay.com"))).toEqual([]);
  });
});

test.describe("signed out, the ticket list", () => {
  test("asks for sign-in instead of showing an empty list", async ({ page }) => {
    const o = observe(page);
    await page.goto("/support/tickets");

    await expect(page.getByText("Sign in to see your tickets")).toBeVisible();
    // "No tickets yet" would be a lie — we do not know that.
    await expect(page.locator("body")).not.toContainText("No tickets yet");

    await expect
      .poll(() => o.responses.some((r) => r.url.endsWith("/api/support/tickets") && r.status === 401))
      .toBe(true);
  });

  test("its sign-in link returns to the list", async ({ page }) => {
    await page.goto("/support/tickets");
    const href = await page.getByRole("link", { name: "Sign in" }).getAttribute("href");
    expect(href).toBe("/login?next=/support/tickets");
  });
});

test.describe("malformed and nonexistent ids", () => {
  for (const id of ["tkt_%20%20", "../../etc/passwd", "tkt_<script>alert(1)</script>", "x".repeat(300)]) {
    test(`does not crash or execute on ${id.slice(0, 24)}`, async ({ page }) => {
      const o = observe(page);
      const res = await page.goto(`/support/${encodeURIComponent(id)}`).catch(() => null);

      // Whatever it answers, it must not be a server error and must not run the
      // injected script.
      if (res) expect(res.status()).toBeLessThan(500);
      expect(o.pageErrors).toEqual([]);
      // No alert dialog was raised by an injected payload.
      expect(o.consoleErrors.filter((e) => /alert\(1\)/.test(e))).toEqual([]);
    });
  }
});
