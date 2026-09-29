import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";

// ---------------------------------------------------------------------------
// Redelivery of a deposit webhook must credit exactly once.
//
// WHY THIS FILE EXISTS. An HTTP flood harness can prove that replays are
// refused or accepted, and that nothing 5xxs. It cannot prove the EFFECT was
// idempotent, because the interesting payload has to name a watched deposit
// address and the running server has none configured. So the flood tests
// measured verification, freshness, throttling and the body cap — all real —
// and the credit path was never reached. This is the test that reaches it.
//
// THE GUARANTEE BEING PINNED, stated precisely because it is easy to overclaim:
// this is NOT exactly-once delivery. Node providers retry, and they are right
// to. What the system provides is AT-LEAST-ONCE DELIVERY WITH IDEMPOTENT
// PROCESSING, keyed on the transaction hash: `markCredited` is a set-if-not-
// exists, so the first delivery to reach it wins and every later one is a no-op.
//
// THE RACE THAT MATTERS. Two deliveries of the same transaction arriving
// simultaneously — normal when a provider retries on a timeout that was really
// just slow. If the guard were read-then-write, both would observe "not yet
// credited" and both would credit. It is a single atomic operation precisely so
// that cannot happen, and this drives it concurrently to say so.
// ---------------------------------------------------------------------------

const SECRET = "whsec_deposit_replay_spec";
const WATCHED = "0x00000000000000000000000000000000000000ff";
const CHAIN = "bsc";

let POST: (req: Request) => Promise<Response>;
let markCredited: typeof import("@/lib/services/deposits").markCredited;

const sign = (body: string) =>
  crypto.createHmac("sha256", SECRET).update(body).digest("hex");

function delivery(txHash: string): Request {
  const body = JSON.stringify({
    network: CHAIN,
    event: "transfer",
    txHash,
    from: "0x1111111111111111111111111111111111111111",
    to: WATCHED,
    value: "1000000",
    asset: "USDT",
    confirmations: 30,
    timestamp: new Date().toISOString(),
  });
  return new Request("https://furlpay.test/api/webhooks/deposit-detect", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-qn-signature": sign(body),
      // A distinct source per test run so the pre-HMAC rate shield, which is
      // deliberately tight, does not mask the behaviour under test.
      "x-forwarded-for": `198.51.100.${1 + Math.floor(Math.random() * 200)}`,
    },
    body,
  });
}

const saved: Record<string, string | undefined> = {};

beforeAll(async () => {
  for (const k of ["DEPOSIT_WEBHOOK_SECRET", "TREASURY_ADDRESS_BSC"]) saved[k] = process.env[k];
  process.env.DEPOSIT_WEBHOOK_SECRET = SECRET;
  // Makes WATCHED a real deposit destination, which is what the running server
  // lacked and why the HTTP harness could not reach this path.
  process.env.TREASURY_ADDRESS_BSC = WATCHED;

  ({ POST } = await import("../route"));
  ({ markCredited } = await import("@/lib/services/deposits"));
});

afterAll(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("a watched deposit is credited exactly once", () => {
  it("reaches the credit path at all — the control", async () => {
    // If this returns `ignored_address`, every assertion below is vacuous.
    const res = await POST(delivery("0xcontrol_reaches_credit"));
    const body = (await res.json()) as Record<string, unknown>;
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.status, `handler short-circuited: ${JSON.stringify(body)}`).not.toBe(
      "ignored_address"
    );
  });

  it("credits once across three SEQUENTIAL redeliveries", async () => {
    const tx = "0xsequential_redelivery";
    for (let i = 0; i < 3; i++) {
      const res = await POST(delivery(tx));
      expect(res.status).toBe(200);
    }
    // The guard is a set-if-not-exists. After the handler has run, a further
    // attempt to claim the same hash must fail — which is exactly what stops
    // the second and third deliveries crediting.
    expect(await markCredited(tx), "the credit guard was still unclaimed").toBe(false);
  });

  it("credits once across ten CONCURRENT redeliveries", async () => {
    // The real shape of a provider retry storm: the same transaction arriving
    // several times at once. A read-then-write guard would let every one of
    // these observe "not credited" and all ten would credit.
    const tx = "0xconcurrent_redelivery";
    const results = await Promise.all(Array.from({ length: 10 }, () => POST(delivery(tx))));
    for (const r of results) expect(r.status).toBeLessThan(500);
    expect(await markCredited(tx), "the credit guard was still unclaimed").toBe(false);
  });

  it("a DIFFERENT transaction is still credited — the guard is per-transaction", async () => {
    // The failure that would make the above pass for the wrong reason: a guard
    // that blocks everything after the first deposit ever.
    const tx = "0xdistinct_transaction";
    const res = await POST(delivery(tx));
    expect(res.status).toBe(200);
    expect(await markCredited(tx)).toBe(false);
    // And an entirely unseen hash is still claimable.
    expect(await markCredited("0xnever_seen_at_all")).toBe(true);
  });
});

describe("the guard itself is atomic, not read-then-write", () => {
  it("exactly ONE of 50 concurrent claims on the same hash succeeds", async () => {
    // The previous test proves the guard ends up claimed. This proves the
    // stronger and more important thing: only one claimant ever won it.
    //
    // A read-then-write guard passes the previous test and fails this one —
    // every concurrent caller would observe "not yet credited" and all 50 would
    // proceed to credit. That is the duplicate-ledger-entry race, measured
    // rather than argued.
    const tx = "0xatomicity_probe";
    const wins = await Promise.all(Array.from({ length: 50 }, () => markCredited(tx)));
    const won = wins.filter(Boolean).length;
    expect(won, `${won} concurrent claimants would each have credited this deposit`).toBe(1);
  });

  it("a second wave against an already-claimed hash wins nothing", async () => {
    const tx = "0xatomicity_probe";
    const wins = await Promise.all(Array.from({ length: 20 }, () => markCredited(tx)));
    expect(wins.filter(Boolean)).toHaveLength(0);
  });
});

describe("verification still gates the credit path", () => {
  it("an unsigned delivery to a WATCHED address is refused", async () => {
    // The dangerous combination: a real destination and no signature.
    const body = JSON.stringify({
      network: CHAIN,
      event: "transfer",
      txHash: "0xunsigned_watched",
      to: WATCHED,
      value: "1000000",
      timestamp: new Date().toISOString(),
    });
    const res = await POST(
      new Request("https://furlpay.test/api/webhooks/deposit-detect", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.250" },
        body,
      })
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
    // And nothing was credited, so the hash is still claimable.
    expect(await markCredited("0xunsigned_watched")).toBe(true);
  });

  it("a tampered amount with the original signature is refused", async () => {
    const original = JSON.stringify({
      network: CHAIN,
      event: "transfer",
      txHash: "0xtampered_amount",
      to: WATCHED,
      value: "1000000",
      timestamp: new Date().toISOString(),
    });
    const sig = sign(original);
    const tampered = original.replace('"value":"1000000"', '"value":"9999999999"');
    const res = await POST(
      new Request("https://furlpay.test/api/webhooks/deposit-detect", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-qn-signature": sig,
          "x-forwarded-for": "198.51.100.251",
        },
        body: tampered,
      })
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await markCredited("0xtampered_amount")).toBe(true);
  });

  it("fails closed when the secret is unset", async () => {
    // Not a 500, and above all not an acceptance: no secret means no way to
    // verify, which means refuse.
    const prev = process.env.DEPOSIT_WEBHOOK_SECRET;
    const prevQn = process.env.QUICKNODE_WEBHOOK_SECRET;
    delete process.env.DEPOSIT_WEBHOOK_SECRET;
    delete process.env.QUICKNODE_WEBHOOK_SECRET;
    try {
      const res = await POST(delivery("0xno_secret_configured"));
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
      expect(await markCredited("0xno_secret_configured")).toBe(true);
    } finally {
      if (prev !== undefined) process.env.DEPOSIT_WEBHOOK_SECRET = prev;
      if (prevQn !== undefined) process.env.QUICKNODE_WEBHOOK_SECRET = prevQn;
    }
  });
});
