// Reconciliation endpoint: GET /api/transactions/status
//
// A mobile client whose reply was lost to a timeout knows only the idempotency
// key it submitted under. This route resolves that key to the authoritative
// outcome the server already recorded, so the client can settle an unknown
// state instead of re-submitting and risking a second payment.
//
// The two properties that matter most, and are pinned here:
//   1. It can never read another user's record.
//   2. "No record" resolves to UNKNOWN, never to FAILED — the request may
//      simply never have arrived, and telling a user it failed invites them to
//      pay twice.

import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { signSession } from "@/lib/session";
import { findOrCreateUserByIdentity } from "@/lib/store";
import { withIdempotency } from "@/lib/idempotency";
import { GET } from "@/app/api/transactions/status/route";

async function actor(label: string) {
  const { account } = findOrCreateUserByIdentity({
    email: `recon-${label}-${randomUUID()}@furlpay.test`,
    name: "Recon User",
  });
  const token = await signSession({
    sub: account.user.id,
    safe: "0x0",
    roles: ["user"],
    jti: randomUUID(),
  });
  return { account, token };
}

function statusReq(token: string | undefined, query: string) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    // Vary the IP so the rate limiter does not bleed between cases.
    "x-forwarded-for": `10.9.0.${Math.floor(Math.random() * 250)}`,
  };
  if (token) headers.authorization = `Bearer ${token}`;
  return new NextRequest(`https://furlpay.com/api/transactions/status${query}`, {
    method: "GET",
    headers,
  });
}

/** Record a completed 2xx under a key, exactly as a money route would. */
async function recordCompleted(userId: string, scope: string, key: string, body: unknown) {
  await withIdempotency(key, scope, async () => NextResponse.json(body, { status: 200 }), {
    principal: userId,
  });
}

describe("authentication", () => {
  it("401s an unauthenticated caller", async () => {
    const res = await GET(statusReq(undefined, "?idempotencyKey=abcdefgh&scope=wallets.transfer"));
    expect(res.status).toBe(401);
  });
});

describe("input validation", () => {
  it("rejects a malformed idempotency key", async () => {
    const { token } = await actor("v1");
    const res = await GET(statusReq(token, "?idempotencyKey=short&scope=wallets.transfer"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_idempotency_key");
  });

  it("rejects a scope outside the allowlist", async () => {
    // `scope` selects a key-value namespace. Passing it through unvalidated
    // would let a caller aim the lookup at any namespace the app uses and
    // confirm the existence of keys in it.
    const { token } = await actor("v2");
    const res = await GET(statusReq(token, `?idempotencyKey=${randomUUID()}&scope=session.tokens`));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_scope");
  });

  it("rejects a traversal-shaped scope", async () => {
    const { token } = await actor("v3");
    const res = await GET(
      statusReq(token, `?idempotencyKey=${randomUUID()}&scope=${encodeURIComponent("../../idem")}`)
    );
    expect(res.status).toBe(400);
  });
});

describe("resolving a known outcome", () => {
  it("returns COMPLETED and replays the ORIGINAL body", async () => {
    // The client may never have received this body the first time. Returning it
    // verbatim is what lets it finish the exact flow it started — including
    // reading a transactionHash it never saw.
    const { account, token } = await actor("k1");
    const key = randomUUID();
    await recordCompleted(account.user.id, "wallets.transfer", key, {
      transactionHash: "0xdeadbeef",
    });

    const res = await GET(statusReq(token, `?idempotencyKey=${key}&scope=wallets.transfer`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.state).toBe("COMPLETED");
    expect(body.known).toBe(true);
    expect(body.result).toEqual({ transactionHash: "0xdeadbeef" });
  });

  it("returns UNKNOWN, not FAILED, for a key the server has no record of", async () => {
    // THE critical distinction. The request may never have arrived, or the 24h
    // window may have passed. "Failed" here is what makes a user pay twice.
    const { token } = await actor("k2");
    const res = await GET(
      statusReq(token, `?idempotencyKey=${randomUUID()}&scope=wallets.transfer`)
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.state).toBe("UNKNOWN");
    expect(body.known).toBe(false);
    expect(body.state).not.toBe("FAILED");
  });
});

describe("tenant isolation", () => {
  it("does not resolve another user's key", async () => {
    // The principal in the cache key is the AUTHENTICATED user's id, taken from
    // the session and never from the query string. A key belonging to someone
    // else simply reads as unknown.
    const alice = await actor("iso-a");
    const bob = await actor("iso-b");

    const key = randomUUID();
    await recordCompleted(alice.account.user.id, "wallets.transfer", key, {
      transactionHash: "0xalice",
    });

    // Alice can see her own record.
    const mine = await GET(statusReq(alice.token, `?idempotencyKey=${key}&scope=wallets.transfer`));
    expect((await mine.json()).state).toBe("COMPLETED");

    // Bob, holding the exact same key, learns nothing.
    const theirs = await GET(statusReq(bob.token, `?idempotencyKey=${key}&scope=wallets.transfer`));
    const body = await theirs.json();
    expect(body.state).toBe("UNKNOWN");
    expect(body.known).toBe(false);
    expect(JSON.stringify(body)).not.toContain("0xalice");
  });

  it("keeps records separate across scopes for the same user and key", async () => {
    // A key is only meaningful within its scope; a collision across scopes must
    // not resolve to the wrong operation's outcome.
    const { account, token } = await actor("iso-s");
    const key = randomUUID();
    await recordCompleted(account.user.id, "cards.order", key, { cardId: "card_1" });

    const wrongScope = await GET(
      statusReq(token, `?idempotencyKey=${key}&scope=wallets.transfer`)
    );
    expect((await wrongScope.json()).state).toBe("UNKNOWN");

    const rightScope = await GET(statusReq(token, `?idempotencyKey=${key}&scope=cards.order`));
    expect((await rightScope.json()).state).toBe("COMPLETED");
  });
});

describe("the route never mutates", () => {
  it("exposes only GET", async () => {
    // Reconciliation asks; it must never be able to submit. A POST export here
    // would turn recovery into a second payment path.
    const mod = await import("@/app/api/transactions/status/route");
    expect(typeof mod.GET).toBe("function");
    for (const verb of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect((mod as Record<string, unknown>)[verb]).toBeUndefined();
    }
  });

  it("does not create a record for a key it was merely asked about", async () => {
    // Asking must not claim the key — that would make the real request that
    // follows collide with a phantom claim and 409.
    const { account, token } = await actor("nm");
    const key = randomUUID();

    await GET(statusReq(token, `?idempotencyKey=${key}&scope=wallets.transfer`));

    // The key must still be free for a genuine first use.
    let ran = false;
    const res = await withIdempotency(
      key,
      "wallets.transfer",
      async () => {
        ran = true;
        return NextResponse.json({ ok: true }, { status: 200 });
      },
      { principal: account.user.id }
    );
    expect(ran).toBe(true);
    expect(res.status).toBe(200);
  });
});
