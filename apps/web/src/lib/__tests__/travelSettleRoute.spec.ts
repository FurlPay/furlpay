// POST /api/travel/settle — the route that turns an on-chain payment into a
// confirmed booking.
//
// What only the ROUTE can get wrong (settlementProof.spec.ts already covers the
// verifier itself): who is allowed to call it, which trip they may touch, what
// status code each outcome earns, and whether one payment can confirm two
// trips. The status codes matter more than usual here — 402 tells a client to
// keep polling a payment that is still confirming, 409 tells it to stop. Get
// them backwards and either a valid booking is abandoned or a dead one is
// polled forever.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";

// The verifier is mocked: this suite is about the route's decisions, and
// travelSettlementProof.spec.ts already drives the real log-parsing logic
// against forged tokens, wrong recipients and short confirmations.
const verifyUsdcPayment = vi.fn();
vi.mock("@/lib/travel/settlementProof", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/travel/settlementProof")>();
  return { ...actual, verifyUsdcPayment };
});

// The payer binding (2026-10-02): settlement requires the caller's verified,
// EIP-191-linked wallet. Every test user has one unless a test says otherwise.
const LINKED_WALLET = "0x52908400098527886E0F7030069857D2E4169EE7";
const verifiedReceiver = vi.fn(async (_userId: string): Promise<string | null> => LINKED_WALLET);
vi.mock("@/lib/receiveAddress", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/receiveAddress")>();
  return { ...actual, verifiedReceiver };
});

const { POST } = await import("@/app/api/travel/settle/route");
const { signSession } = await import("@/lib/session");
const { findOrCreateUserByIdentity } = await import("@/lib/store");
const { addTrip, getTrip } = await import("@/lib/travel/store");

/**
 * A fresh, unique transaction hash.
 *
 * The route claims each proof single-use in KV, and that store is
 * process-global with a 30-day TTL — exactly as production behaves. A shared
 * constant would therefore be burned by the first test that settled with it
 * and every later test would see a legitimate `proof_already_used`. Each test
 * mints its own hash so the single-use behaviour is exercised deliberately
 * rather than leaking between cases.
 */
let txCounter = 0;
function freshTx(): string {
  txCounter += 1;
  return `0x${txCounter.toString(16).padStart(64, "0")}`;
}

async function actor() {
  const { account } = findOrCreateUserByIdentity({
    email: `settle-${randomUUID()}@furlpay.test`,
    name: "Settle User",
  });
  const token = await signSession({
    sub: account.user.id,
    safe: "0x0",
    roles: ["user"],
    jti: randomUUID(),
  });
  return { account, token };
}

/** A pending, priced trip owned by `userId`. */
function pendingTrip(userId: string, amountUsd = 500) {
  const id = `bk_test_${randomUUID()}`;
  return addTrip({
    id,
    userId,
    name: "Test Hotel",
    city: "Singapore",
    image: "from-sky-500/40 to-indigo-600/40",
    checkIn: "2026-12-01",
    checkOut: "2026-12-03",
    nights: 2,
    guests: 1,
    amountUsd,
    source: "travala",
    method: "USDC · x402 on Base",
    status: "pending",
    cashbackUsd: 0,
    createdAt: new Date().toISOString(),
  });
}

/** Each request gets a fresh IP so the per-user rate limit is the only gate. */
function req(body: unknown, token?: string, ip?: string) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-forwarded-for": ip ?? `10.40.0.${Math.floor(Math.random() * 250)}`,
  };
  if (token) headers.authorization = `Bearer ${token}`;
  return new NextRequest("https://furlpay.com/api/travel/settle", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function okProof(txHash: string, paidAtomic = "500000000") {
  return {
    ok: true,
    txHash,
    network: "base",
    paidAtomic,
    confirmations: 12,
    requiredConfirmations: 12,
  };
}

/** The unspent hash for the test currently running. */
let currentTx: string;

beforeEach(() => {
  currentTx = freshTx();
  verifyUsdcPayment.mockReset();
  verifyUsdcPayment.mockResolvedValue(okProof(currentTx));
});

describe("auth and tenancy", () => {
  it("401s an unauthenticated request", async () => {
    const res = await POST(req({ tripId: "bk_x", txHash: currentTx, network: "base" }));
    expect(res.status).toBe(401);
  });

  it("404s a trip that does not exist", async () => {
    const { token } = await actor();
    const res = await POST(req({ tripId: "bk_nope", txHash: currentTx, network: "base" }, token));
    expect(res.status).toBe(404);
  });

  it("404s another user's trip rather than settling it (anti-IDOR)", async () => {
    // The owner's trip id is a real, valid id — the ONLY thing standing between
    // the attacker and it is the user scoping in getTrip. A 403 here would also
    // confirm the id exists, so 404 is the correct answer as well as the safe
    // one: booking ids stay non-enumerable.
    const owner = await actor();
    const attacker = await actor();
    const trip = pendingTrip(owner.account.user.id);

    const res = await POST(req({ tripId: trip.id, txHash: currentTx, network: "base" }, attacker.token));
    expect(res.status).toBe(404);

    // And the owner's trip is untouched.
    expect(getTrip(trip.id, owner.account.user.id)?.status).toBe("pending");
    expect(verifyUsdcPayment).not.toHaveBeenCalled();
  });
});

describe("body validation", () => {
  it("rejects a malformed txHash before reaching the chain", async () => {
    const { token, account } = await actor();
    const trip = pendingTrip(account.user.id);
    for (const bad of ["0xnope", "", "ab".repeat(32), `0x${"ab".repeat(31)}`]) {
      const res = await POST(req({ tripId: trip.id, txHash: bad, network: "base" }, token));
      expect(res.status).toBe(400);
    }
    expect(verifyUsdcPayment).not.toHaveBeenCalled();
  });

  it("rejects a missing or unsupported network", async () => {
    const { token, account } = await actor();
    const trip = pendingTrip(account.user.id);
    expect((await POST(req({ tripId: trip.id, txHash: currentTx }, token))).status).toBe(400);
    expect((await POST(req({ tripId: trip.id, txHash: currentTx, network: "solana" }, token))).status).toBe(400);
    expect((await POST(req({ tripId: trip.id, txHash: currentTx, network: "dogechain" }, token))).status).toBe(400);
  });

  it("400s when no booking id is supplied at all", async () => {
    const { token } = await actor();
    const res = await POST(req({ txHash: currentTx, network: "base" }, token));
    expect(res.status).toBe(400);
  });

  it("accepts either bookingId or tripId", async () => {
    const { token, account } = await actor();
    const a = pendingTrip(account.user.id);
    expect((await POST(req({ tripId: a.id, txHash: currentTx, network: "base" }, token))).status).toBe(200);

    const b = pendingTrip(account.user.id);
    const second = freshTx();
    verifyUsdcPayment.mockResolvedValue(okProof(second));
    expect((await POST(req({ bookingId: b.id, txHash: second, network: "base" }, token))).status).toBe(200);
  });

  it("409s a trip with no price to verify against", async () => {
    // Verifying a payment against an unknown expected amount is not
    // verification, so the route must refuse rather than accept anything.
    const { token, account } = await actor();
    const trip = pendingTrip(account.user.id, 0);
    const res = await POST(req({ tripId: trip.id, txHash: currentTx, network: "base" }, token));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("trip_not_priced");
    expect(verifyUsdcPayment).not.toHaveBeenCalled();
  });
});

describe("proof outcomes map to the right status code", () => {
  const cases = [
    { reason: "tx_not_found", status: 402, note: "still in the mempool — keep polling" },
    { reason: "insufficient_confirmations", status: 402, note: "will deepen — keep polling" },
    { reason: "tx_reverted", status: 409, note: "terminal" },
    { reason: "no_matching_transfer", status: 409, note: "counterfeit token / wrong recipient / underpaid" },
    { reason: "unsupported_network", status: 409, note: "terminal" },
    { reason: "malformed_tx_hash", status: 409, note: "terminal" },
  ] as const;

  for (const c of cases) {
    it(`${c.reason} -> ${c.status} (${c.note})`, async () => {
      const { token, account } = await actor();
      const trip = pendingTrip(account.user.id);
      verifyUsdcPayment.mockResolvedValue({ ok: false, reason: c.reason, detail: "nope" });

      const res = await POST(req({ tripId: trip.id, txHash: currentTx, network: "base" }, token));
      expect(res.status).toBe(c.status);

      const json = await res.json();
      expect(json.verified).toBe(false);
      expect(json.settled).toBe(false);
      expect(json.error).toBe(c.reason);

      // The booking must NOT be confirmed by a failed proof.
      expect(getTrip(trip.id, account.user.id)?.status).toBe("pending");
    });
  }

  it("passes confirmation progress through so a client can show it", async () => {
    const { token, account } = await actor();
    const trip = pendingTrip(account.user.id);
    verifyUsdcPayment.mockResolvedValue({
      ok: false,
      reason: "insufficient_confirmations",
      detail: "2 of 12",
      confirmations: 2,
      requiredConfirmations: 12,
    });
    const res = await POST(req({ tripId: trip.id, txHash: currentTx, network: "base" }, token));
    const json = await res.json();
    expect(json.confirmations).toBe(2);
    expect(json.requiredConfirmations).toBe(12);
  });

  it("verifies against the trip's own price, not a client-supplied amount", async () => {
    // A client that could name its own expected amount could pay $1 for a
    // $500 room. The route must derive the expectation from the stored trip.
    const { token, account } = await actor();
    const trip = pendingTrip(account.user.id, 500);
    await POST(
      req({ tripId: trip.id, txHash: currentTx, network: "base", expectedAtomic: "1", amountUsd: 1 }, token)
    );
    expect(verifyUsdcPayment).toHaveBeenCalledWith(
      expect.objectContaining({ expectedAtomic: "500000000" })
    );
  });

  it("binds the payment to the caller's linked wallet (no front-running a stranger's transfer)", async () => {
    const { token, account } = await actor();
    const trip = pendingTrip(account.user.id, 120);
    await POST(req({ tripId: trip.id, txHash: currentTx, network: "base" }, token));
    expect(verifyUsdcPayment).toHaveBeenCalledWith(expect.objectContaining({ expectedFrom: LINKED_WALLET }));
  });

  it("no linked wallet → 409 payer_wallet_not_linked, verifier never called, trip unchanged", async () => {
    const { token, account } = await actor();
    const trip = pendingTrip(account.user.id, 120);
    verifiedReceiver.mockResolvedValueOnce(null);
    verifyUsdcPayment.mockClear();
    const res = await POST(req({ tripId: trip.id, txHash: currentTx, network: "base" }, token));
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe("payer_wallet_not_linked");
    expect(verifyUsdcPayment).not.toHaveBeenCalled();
    expect(getTrip(trip.id, account.user.id)?.status).not.toBe("confirmed");
  });

  it("payer_mismatch from the verifier is terminal (409), not retryable", async () => {
    const { token, account } = await actor();
    const trip = pendingTrip(account.user.id, 120);
    verifyUsdcPayment.mockResolvedValueOnce({ ok: false, reason: "payer_mismatch", detail: "not from your wallet" });
    const res = await POST(req({ tripId: trip.id, txHash: currentTx, network: "base" }, token));
    expect(res.status).toBe(409);
    expect(getTrip(trip.id, account.user.id)?.status).not.toBe("confirmed");
  });
});

describe("success", () => {
  it("confirms the trip and returns the verified payment details", async () => {
    const { token, account } = await actor();
    const trip = pendingTrip(account.user.id);

    const res = await POST(req({ tripId: trip.id, txHash: currentTx, network: "base" }, token));
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json).toMatchObject({ verified: true, settled: true });
    expect(json.trip.status).toBe("confirmed");
    expect(json.proof).toMatchObject({
      txHash: currentTx,
      network: "base",
      paidAtomic: "500000000",
      confirmations: 12,
    });

    expect(getTrip(trip.id, account.user.id)?.status).toBe("confirmed");
  });
});

describe("single-use proof claiming", () => {
  it("refuses to confirm a SECOND trip with the same transaction hash", async () => {
    // The attack: pay once for a cheap room, then replay that hash against
    // every other pending booking. The KV claim is what stops it.
    const { token, account } = await actor();
    const first = pendingTrip(account.user.id);
    const second = pendingTrip(account.user.id);

    expect((await POST(req({ tripId: first.id, txHash: currentTx, network: "base" }, token))).status).toBe(200);

    const res = await POST(req({ tripId: second.id, txHash: currentTx, network: "base" }, token));
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toBe("proof_already_used");
    // The proof WAS valid — it has simply been spent. Saying `verified: true,
    // settled: false` is the honest pair; claiming it failed verification
    // would send a support agent looking at the chain for a problem that is
    // not there.
    expect(json.verified).toBe(true);
    expect(json.settled).toBe(false);

    expect(getTrip(second.id, account.user.id)?.status).toBe("pending");
  });

  it("does not let one user's spent proof be reused by another", async () => {
    const a = await actor();
    const b = await actor();
    const tripA = pendingTrip(a.account.user.id);
    const tripB = pendingTrip(b.account.user.id);

    expect((await POST(req({ tripId: tripA.id, txHash: currentTx, network: "base" }, a.token))).status).toBe(200);

    const res = await POST(req({ tripId: tripB.id, txHash: currentTx, network: "base" }, b.token));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("proof_already_used");
  });

  it("scopes the claim by network, so the same hash on two chains is two proofs", async () => {
    // Tx hashes are not globally unique across chains. Keying the claim on the
    // hash alone would reject a legitimate Arbitrum payment because an
    // unrelated Base tx happened to share its hash.
    const { token, account } = await actor();
    const onBase = pendingTrip(account.user.id);
    const onArb = pendingTrip(account.user.id);

    expect((await POST(req({ tripId: onBase.id, txHash: currentTx, network: "base" }, token))).status).toBe(200);

    verifyUsdcPayment.mockResolvedValue({ ...okProof(currentTx), network: "arbitrum" });
    const res = await POST(req({ tripId: onArb.id, txHash: currentTx, network: "arbitrum" }, token));
    expect(res.status).toBe(200);
  });
});

describe("idempotency", () => {
  it("returns an already-confirmed trip without re-verifying or burning a proof", async () => {
    const { token, account } = await actor();
    const trip = pendingTrip(account.user.id);

    const first = await POST(req({ tripId: trip.id, txHash: currentTx, network: "base" }, token));
    expect(first.status).toBe(200);
    expect(verifyUsdcPayment).toHaveBeenCalledTimes(1);

    // A dropped response and a client retry must not need a second payment.
    const retry = await POST(req({ tripId: trip.id, txHash: currentTx, network: "base" }, token));
    expect(retry.status).toBe(200);
    const json = await retry.json();
    expect(json).toMatchObject({ verified: true, settled: true, alreadyConfirmed: true });

    // The whole point: no second chain read, no second claim.
    expect(verifyUsdcPayment).toHaveBeenCalledTimes(1);
  });

  it("is idempotent even for a demo trip that was already confirmed", async () => {
    const { token, account } = await actor();
    // The per-user seed includes confirmed demo trips.
    const demoId = `bk_demo_tokyo_${account.user.id}`;
    const res = await POST(req({ tripId: demoId, txHash: currentTx, network: "base" }, token));
    expect(res.status).toBe(200);
    expect((await res.json()).alreadyConfirmed).toBe(true);
    expect(verifyUsdcPayment).not.toHaveBeenCalled();
  });
});

describe("rate limiting", () => {
  it("429s once the per-user budget is exhausted", async () => {
    // Keyed by user, not IP: proof submission is the brute-forceable step and
    // NAT puts many honest users behind one address. Same IP throughout to
    // prove the user key is what bites.
    const { token, account } = await actor();
    const ip = "10.99.0.7";
    const statuses: number[] = [];

    for (let i = 0; i < 25; i += 1) {
      const trip = pendingTrip(account.user.id);
      const loopTx = freshTx();
      verifyUsdcPayment.mockResolvedValue(okProof(loopTx));
      const res = await POST(
        req({ tripId: trip.id, txHash: loopTx, network: "base" }, token, ip)
      );
      statuses.push(res.status);
    }

    expect(statuses).toContain(429);
    // The budget is 20/min, so the first 20 must not be rate limited.
    expect(statuses.slice(0, 20).every((s) => s !== 429)).toBe(true);
  });
});
