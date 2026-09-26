import type { APIRequestContext, BrowserContext, Page } from "@playwright/test";
import { test, expect, signIn, uniqueEmail } from "./fixtures";

// ---------------------------------------------------------------------------
// Cross-user authorization, driven by two REAL identities in two real browser
// contexts — created through the app's own OTP sign-in, not injected sessions.
//
// The status codes asserted here were read off the routes first, not guessed:
//
//   GET/PATCH /api/support/tickets/[id]        non-owner -> 404
//   POST      /api/support/tickets/[id]/messages non-owner -> 404
//   POST      /api/support/tickets/[id]/agent   non-admin -> 403
//
// 404 rather than 403 for ownership is deliberate: a 403 would confirm the
// ticket exists and turn ids into an existence oracle. 403 on /agent is a
// different question — not "does this ticket exist" but "may you act as
// support" — so it does not leak anything by answering plainly.
//
// One ticket is created here. POST /api/support/tickets allows 5 per 10 minutes
// per IP, and that budget is shared with support-ticket.spec.ts.
// ---------------------------------------------------------------------------

test.describe.configure({ mode: "serial" });

test.describe("@auth cross-user isolation", () => {
  let ctxA: BrowserContext;
  let ctxB: BrowserContext;
  let pageA: Page;
  let pageB: Page;
  let reqB: APIRequestContext;
  let ticketA = "";
  let userA = "";
  let userB = "";
  const subjectA = `E2E private ticket ${Date.now()}`;

  test.beforeAll(async ({ browser, playwright, baseURL }) => {
    ctxA = await browser.newContext();
    ctxB = await browser.newContext();
    pageA = await ctxA.newPage();
    pageB = await ctxB.newPage();

    const reqA = await playwright.request.newContext({ baseURL });
    userA = (await signIn(reqA, ctxA, uniqueEmail("userA"))).userId;
    await reqA.dispose();

    // B's API context keeps B's cookies, so API probes below are genuinely B.
    reqB = await playwright.request.newContext({ baseURL });
    userB = (await signIn(reqB, ctxB, uniqueEmail("userB"))).userId;
  });

  test.afterAll(async () => {
    await reqB?.dispose();
    await ctxA?.close();
    await ctxB?.close();
  });

  test("the two identities are genuinely different accounts", async () => {
    expect(userA).toBeTruthy();
    expect(userB).toBeTruthy();
    expect(userA).not.toBe(userB);
  });

  test("user A creates a ticket", async () => {
    await pageA.goto("/support/new");
    await pageA.locator("#subject").fill(subjectA);
    await pageA.locator("#body").fill("Private to user A. User B must never see this text.");
    await pageA.getByRole("button", { name: /create ticket/i }).click();

    await expect(pageA).toHaveURL(/\/support\/tkt_[0-9a-f-]+\?created=1/, { timeout: 20_000 });
    ticketA = new URL(pageA.url()).pathname.split("/").pop()!;
    expect(ticketA).toMatch(/^tkt_/);
  });

  test("user B cannot open it in a browser", async () => {
    await pageB.goto(`/support/${ticketA}`);

    // B is signed in, so this is an authorization outcome, not a sign-in prompt.
    await expect(pageB.getByText("That ticket could not be found.")).toBeVisible({ timeout: 15_000 });
    // And crucially, none of A's content reaches B's DOM.
    const html = await pageB.content();
    expect(html).not.toContain(subjectA);
    expect(html).not.toContain("User B must never see this text");
  });

  test("user B gets 404 from the detail API, not 403", async () => {
    const res = await reqB.get(`/api/support/tickets/${ticketA}`);
    expect(res.status()).toBe(404);
    expect(await res.text()).not.toContain(subjectA);
  });

  test("user B does not see it in their own list", async () => {
    const res = await reqB.get("/api/support/tickets");
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { tickets?: { id: string }[] };
    const ids = (body.tickets ?? []).map((t) => t.id);
    expect(ids).not.toContain(ticketA);

    // The rendered list must not contain it either.
    await pageB.goto("/support/tickets");
    await expect(pageB.locator("body")).not.toContainText(subjectA);
  });

  test("user B cannot post a message to it", async () => {
    const res = await reqB.post(`/api/support/tickets/${ticketA}/messages`, {
      data: { body: "Injected by user B." },
    });
    expect(res.status()).toBe(404);

    // And the message never landed: A still cannot see it.
    await pageA.goto(`/support/${ticketA}`);
    await expect(pageA.locator("article").first()).toBeVisible({ timeout: 15_000 });
    await expect(pageA.locator("body")).not.toContainText("Injected by user B.");
  });

  test("user B cannot change its status", async () => {
    const res = await reqB.patch(`/api/support/tickets/${ticketA}`, { data: { status: "closed" } });
    expect(res.status()).toBe(404);
  });

  test("user B cannot act as support via /agent", async () => {
    const res = await reqB.post(`/api/support/tickets/${ticketA}/agent`, {
      data: { body: "I am FurlPay Support.", status: "closed" },
    });
    // 403 from requireRole — a different question from ownership, answered plainly.
    expect(res.status()).toBe(403);

    await pageA.goto(`/support/${ticketA}`);
    await expect(pageA.locator("article").first()).toBeVisible({ timeout: 15_000 });
    await expect(pageA.locator("body")).not.toContainText("I am FurlPay Support.");
  });

  test("the owner cannot post as FurlPay Support by setting author in the body", async () => {
    // Impersonation, which is the mass-assignment case that actually matters
    // here: `author` is hardcoded server-side on message creation, so a customer
    // must not be able to make their own words appear as a support reply.
    //
    // Run as A on A's OWN ticket, deliberately: B is a non-owner and would get
    // 404 before `author` was ever looked at, which would prove nothing about
    // whether the field is honoured. It also avoids creating another ticket —
    // the create budget is 5/10min per IP and shared with support-ticket.spec.ts.
    const marker = `E2E impersonation probe ${Date.now()}`;
    const res = await pageA.request.post(`/api/support/tickets/${ticketA}/messages`, {
      data: { body: marker, author: "agent" },
    });
    // 201, not 200 — this creates a resource. Asserting 200 here was a test bug
    // that briefly looked like a broken flow.
    expect(res.status()).toBe(201);

    // The Zod schema is `{ body }` and Zod strips unknown keys, so `author` never
    // reaches the handler; `addMessage` then hardcodes author: "user".
    const { message } = (await res.json()) as { message?: { author?: string } };
    expect(message?.author).toBe("user");

    // And it renders as the customer, not as support or the AI.
    await pageA.goto(`/support/${ticketA}`);
    const posted = pageA.locator("article", { hasText: marker });
    await expect(posted).toBeVisible({ timeout: 15_000 });
    await expect(posted.getByText("Customer")).toBeVisible();
    await expect(posted.getByText("Support", { exact: true })).toHaveCount(0);
    await expect(posted.getByText("AI — not a human")).toHaveCount(0);
  });

  test("a body-supplied status is ignored on a customer reply", async () => {
    const res = await pageA.request.patch(`/api/support/tickets/${ticketA}`, {
      data: { status: "nonsense-status" },
    });
    // The enum rejects it rather than storing it.
    expect([400, 422]).toContain(res.status());
  });

  test("an unauthenticated caller gets 401, not data", async ({ playwright, baseURL }) => {
    const anon = await playwright.request.newContext({ baseURL });
    for (const path of ["/api/support/tickets", `/api/support/tickets/${ticketA}`]) {
      const res = await anon.get(path);
      expect(res.status()).toBe(401);
      expect(await res.text()).not.toContain(subjectA);
    }
    const post = await anon.post(`/api/support/tickets/${ticketA}/agent`, { data: { body: "x" } });
    expect([401, 403]).toContain(post.status());
    await anon.dispose();
  });
});
