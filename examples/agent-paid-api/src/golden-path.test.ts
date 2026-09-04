import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";

// ---------------------------------------------------------------------------
// The golden path, asserted rather than narrated.
//
// agent.ts PRINTS the story; this file FAILS THE BUILD when the story stops
// being true. The invariants below are the ones whose violation costs somebody
// money: a denial that says "pay again", a replay that charges twice, revenue
// that does not equal what was collected, a test reference that could pass for
// chain evidence.
//
// The server is imported with autostart off and driven over a real socket, so
// header handling, status codes and JSON bodies are exercised exactly as a
// paying client meets them.
// ---------------------------------------------------------------------------

const AGENT = "agent-test";
const PRINCIPAL = "principal_test";
const PRICE_ATOMIC = 1000n; // $0.001
const BUDGET_CALLS = 5; // $0.005 / $0.001

process.env.FURLPAY_EXAMPLE_AUTOSTART = "0";
process.env.FURLPAY_RAIL = "test";
process.env.FURLPAY_DEMO_AGENT = AGENT;
process.env.FURLPAY_DEMO_BUDGET = "0.005";

let server: Server;
let base: string;

before(async () => {
  const mod = await import("./server.js");
  mod.registerDemoAgent(AGENT, "0.005");
  server = createServer((req, res) => {
    mod.handle(req, res).catch((e: any) => {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "internal", message: String(e?.message ?? e) }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => server?.close());

interface Requirements {
  scheme: string;
  network: string;
  maxAmountRequired: string;
  payTo: string;
  asset: string;
  extra: Record<string, unknown>;
}

function signPayment(req: Requirements) {
  const now = Math.floor(Date.now() / 1000);
  return {
    x402Version: 1,
    scheme: req.scheme,
    network: req.network,
    payload: {
      signature: "TESTRAIL-unsigned",
      authorization: {
        from: AGENT,
        to: req.payTo,
        value: req.maxAmountRequired,
        validAfter: String(now - 60),
        validBefore: String(now + 600),
        nonce: `0x${randomUUID().replace(/-/g, "")}`,
      },
    },
    extra: req.extra,
  };
}

async function call(path: string, o: { payment?: unknown; key?: string } = {}) {
  const headers: Record<string, string> = { "x-furlpay-principal": PRINCIPAL };
  if (o.payment) headers["x-payment"] = Buffer.from(JSON.stringify(o.payment)).toString("base64");
  if (o.key) headers["idempotency-key"] = o.key;
  const res = await fetch(`${base}${path}`, { headers });
  return { status: res.status, body: (await res.json().catch(() => null)) as any };
}

/** Ask, read the price, pay, ask again: one paid call. */
async function paidCall(q: string, key?: string) {
  const path = `/search?q=${encodeURIComponent(q)}`;
  const challenge = await call(path, { key });
  if (challenge.status !== 402) return challenge;
  return call(path, { payment: signPayment(challenge.body.accepts[0]), key });
}

const admin = async (p: string) => (await fetch(`${base}${p}`)).json() as Promise<any>;

test("an unpaid request is challenged, not served", async () => {
  const r = await call("/search?q=hello");
  assert.equal(r.status, 402);
  const req = r.body.accepts[0];
  assert.equal(req.maxAmountRequired, String(PRICE_ATOMIC));
  // The quote is server-issued and bound. An agent that could mint its own
  // quoteId could name its own price.
  assert.ok(req.extra.quoteId, "challenge must carry a server-issued quoteId");
  assert.ok(req.extra.binding, "challenge must carry a binding MAC");
  assert.equal(r.body.results, undefined, "a 402 must not leak the paid resource");
});

test("a paid request is served and settles on the test rail", async () => {
  const r = await paidCall("hello");
  assert.equal(r.status, 200);
  assert.ok(r.body.paymentIntentId.startsWith("pi_"));
  assert.ok(r.body.ledgerTxId, "a served request must produce a ledger entry");
  assert.equal(r.body.rail, "test");
  // TEST REFERENCES MUST NEVER PASS FOR CHAIN EVIDENCE. base58 contains no
  // "-", so this reference cannot be mistaken for a Solana signature by a
  // log, a CSV, or a human skimming either.
  assert.match(r.body.settlementReference, /^TESTRAIL-/);
  assert.ok(r.body.settlementReference.includes("-"));
});

test("the same key replays the same intent and is charged once", async () => {
  const before = (await admin("/admin/ledger")).entries.length;
  const key = `test-${randomUUID()}`;
  const first = await paidCall("idempotent", key);
  const second = await paidCall("idempotent", key);

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(first.body.paymentIntentId, second.body.paymentIntentId);
  assert.equal(second.body.replayed, true);

  const after = (await admin("/admin/ledger")).entries.length;
  assert.equal(after - before, 1, "one logical payment must post exactly one ledger entry");
});

test("a reused key with a different request is refused, not replayed", async () => {
  const key = `reuse-${randomUUID()}`;
  const original = await paidCall("original", key);
  assert.equal(original.status, 200);
  const different = await paidCall("something-else-entirely", key);
  // Replaying here would hand back a receipt for a payment that was never
  // made for THIS request: a $1 charge answering a $1,000 one.
  assert.equal(different.status, 422);
  assert.equal(different.body.error, "idempotency_key_reused");
});

test("an exhausted budget is refused with 403, never 402", async () => {
  let allowed = 0;
  let denial: any = null;
  for (let i = 0; i < 50; i++) {
    const r = await paidCall(`bulk-${i}`);
    if (r.status === 200) allowed++;
    else {
      denial = r;
      break;
    }
  }
  assert.ok(denial, "the budget must eventually run out");
  // THE LOAD-BEARING ASSERTION. 402 means "pay and retry"; an agent reads that
  // as an instruction and loops forever, because it is a machine.
  assert.equal(denial.status, 403);
  assert.equal(denial.body.reason, "exceeds_total");

  const view = await admin("/admin/ledger");
  assert.equal(
    view.revenueAtomic,
    String(PRICE_ATOMIC * BigInt(BUDGET_CALLS)),
    "revenue must equal the budget exactly: no overspend, no leaked reservation"
  );
  assert.ok(BigInt(view.revenueAtomic) > 0n, "revenue is credit-normal and must be positive");
  assert.equal(view.entries.length, BUDGET_CALLS);
});

test("a revoked agent is refused immediately", async () => {
  await fetch(`${base}/admin/revoke?agent=${encodeURIComponent(AGENT)}`);
  const r = await paidCall("after-revoke");
  assert.equal(r.status, 403);
  assert.equal(r.body.reason, "revoked");
});

test("the audit log records every decision, including the refusals", async () => {
  const { events } = await admin("/admin/audit");
  const kinds = new Set(events.map((e: { type: string }) => e.type));
  for (const required of [
    "BUDGET_RESERVED",
    "BUDGET_COMMITTED",
    "SETTLEMENT_COMPLETED",
    "LEDGER_COMMITTED",
    "IDEMPOTENT_REPLAY",
    "POLICY_DENIED",
    "AGENT_REVOKED",
  ]) {
    assert.ok(kinds.has(required), `audit log is missing ${required}`);
  }
  const reserved = events.filter((e: any) => e.type === "BUDGET_RESERVED").length;
  const committed = events.filter((e: any) => e.type === "BUDGET_COMMITTED").length;
  const released = events.filter((e: any) => e.type === "BUDGET_RELEASED").length;
  // Every reservation is resolved. One left open is allowance that never
  // comes back.
  assert.equal(reserved, committed + released, "every reservation must be committed or released");
});
