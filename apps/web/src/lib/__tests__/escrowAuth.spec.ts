// Regression: escrow POST must NOT fall back to the shared demo account in
// production. Previously the attribution chain ended with
//   (agentKeyId || NODE_ENV !== "production" ? getAccountDurable(DEMO_USER_ID) : undefined)
// which could attribute a hold to the demo account in prod. It is now dev-only.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { GET as escrowGET, POST as escrowPOST } from "@/app/api/escrow/route";
import { signSession } from "@/lib/session";
import { findOrCreateUserByIdentity } from "@/lib/store";

const realEnv = process.env.NODE_ENV;
const realSecret = process.env.FURLPAY_SESSION_SECRET;
beforeEach(() => {
  // In production mode session.ts refuses a weak/dev secret — give it a strong
  // one so the authenticated path can be exercised under NODE_ENV=production.
  (process.env as Record<string, string | undefined>).FURLPAY_SESSION_SECRET =
    "test-strong-session-secret-at-least-32-chars";
});
afterEach(() => {
  const e = process.env as Record<string, string | undefined>;
  e.NODE_ENV = realEnv;
  e.FURLPAY_SESSION_SECRET = realSecret;
});

function req(body: unknown, token?: string) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-forwarded-for": `10.5.0.${Math.floor(Math.random() * 250)}`,
  };
  if (token) headers.cookie = `furlpay_session=${token}`;
  return new NextRequest("https://furlpay.com/api/escrow", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

const hold = { action: "create", cardId: "card_x", merchant: "Hotel", amount: 100 };

describe("escrow — no demo-account fallback in production", () => {
  it("rejects an unauthenticated, unsigned hold in production (no demo fallback)", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    const res = await escrowPOST(req(hold));
    expect(res.status).toBe(401);
  });

  it("still works for an authenticated session", async () => {
    const { account } = findOrCreateUserByIdentity({ email: `esc-${randomUUID()}@furlpay.test` });
    const token = await signSession({ sub: account.user.id, safe: "0x0", roles: ["user"], jti: randomUUID() });
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    const res = await escrowPOST(req(hold, token));
    expect(res.status).toBe(200);
    expect((await res.json()).hold).toBeDefined();
  });
});

// Holds are per-account capabilities: another user must not be able to see,
// capture, or release them — a foreign hold id behaves like a missing one.
describe("escrow — hold ownership", () => {
  async function userToken() {
    const { account } = findOrCreateUserByIdentity({ email: `esc-${randomUUID()}@furlpay.test` });
    return {
      userId: account.user.id,
      token: await signSession({ sub: account.user.id, safe: "0x0", roles: ["user"], jti: randomUUID() }),
    };
  }

  function getReq(token: string) {
    return new NextRequest("https://furlpay.com/api/escrow", {
      headers: { cookie: `furlpay_session=${token}` },
    });
  }

  it("capture/release of another user's hold is rejected without confirming it exists", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    const alice = await userToken();
    const mallory = await userToken();

    const created = await escrowPOST(req(hold, alice.token));
    expect(created.status).toBe(200);
    const { hold: h } = await created.json();

    const capture = await escrowPOST(req({ action: "capture", id: h.id, finalAmount: 50 }, mallory.token));
    expect(capture.status).toBe(409);
    expect((await capture.json()).error).toMatch(/not found/);

    const release = await escrowPOST(req({ action: "release", id: h.id }, mallory.token));
    expect(release.status).toBe(409);

    // The owner can still settle it.
    const ownerCapture = await escrowPOST(req({ action: "capture", id: h.id, finalAmount: 50 }, alice.token));
    expect(ownerCapture.status).toBe(200);
  });

  it("GET lists only the caller's holds", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    const alice = await userToken();
    const bob = await userToken();

    const created = await escrowPOST(req(hold, alice.token));
    const { hold: h } = await created.json();

    const aliceList = await escrowGET(getReq(alice.token));
    const bobList = await escrowGET(getReq(bob.token));
    const aliceIds = (await aliceList.json()).holds.map((x: { id: string }) => x.id);
    const bobIds = (await bobList.json()).holds.map((x: { id: string }) => x.id);
    expect(aliceIds).toContain(h.id);
    expect(bobIds).not.toContain(h.id);
  });

  it("GET without a session is rejected in production (no demo fallback)", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    const res = await escrowGET(new NextRequest("https://furlpay.com/api/escrow"));
    expect(res.status).toBe(401);
  });
});
