// Billing checkout authz — drives the REAL route in sandbox mode (no Stripe
// keys → the route applies the upgrade directly and returns a sandbox url).

import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { POST as checkoutPOST } from "@/app/api/billing/checkout/route";
import { signSession } from "@/lib/session";
import { findOrCreateUserByIdentity, getAccount } from "@/lib/store";
import { deleteUserAccount } from "@/lib/accountDeletion";

async function actor() {
  const email = `bill-${randomUUID()}@furlpay.test`;
  const { account } = findOrCreateUserByIdentity({ email, name: "Billing User" });
  const token = await signSession({ sub: account.user.id, safe: "0x0", roles: ["user"], jti: randomUUID() });
  return { id: account.user.id, token };
}

function req(token: string | undefined, body: unknown) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-forwarded-for": `10.7.0.${Math.floor(Math.random() * 250)}`,
  };
  // Bearer (native) — the old cookie-only check would have rejected this.
  if (token) headers.authorization = `Bearer ${token}`;
  return new NextRequest("https://furlpay.com/api/billing/checkout", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

describe("POST /api/billing/checkout — authz", () => {
  it("authenticates a NATIVE Bearer session (not just a cookie)", async () => {
    const a = await actor();
    const res = await checkoutPOST(req(a.token, { plan: "pro" }));
    expect(res.status).toBe(200);
    // Sandbox: tier applied directly.
    expect(getAccount(a.id)?.user.tier).toBe("Pro");
  });

  it("401s an unauthenticated request", async () => {
    expect((await checkoutPOST(req(undefined, { plan: "pro" }))).status).toBe(401);
  });

  it("rejects an arbitrary/invalid plan (no client-supplied price)", async () => {
    const a = await actor();
    expect((await checkoutPOST(req(a.token, { plan: "free_hack" }))).status).toBe(400);
    expect((await checkoutPOST(req(a.token, { plan: "Standard" }))).status).toBe(400);
  });

  it("BLOCKS a deleted account's still-valid session (tombstone)", async () => {
    const a = await actor();
    await deleteUserAccount(a.id);
    const res = await checkoutPOST(req(a.token, { plan: "pro" }));
    expect(res.status).toBe(401); // requireUser's isAccountDeleted gate
  });
});
