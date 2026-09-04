import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID, createHash } from "node:crypto";
import { Gateway, type SpendPolicyHook } from "@furlpay/gateway";
import { SpendLimiter, authorize as reserveSpend, toMicros } from "@furlpay/agent-trust";
import { createIntent, recoveryFor, transition, isKeyReuse, matches, type PaymentIntent } from "@furlpay/payment-intent";
import { Ledger } from "@furlpay/ledger";
import { AuditLog } from "./audit.js";
import { TestPaymentRail } from "./test-rail.js";
import { formatAtomic, loadConfig } from "./config.js";

// ---------------------------------------------------------------------------
// The paid API. This is where seven FurlPay packages become one request path.
//
//   @furlpay/gateway         402, quote binding, replay claims, settlement
//   @furlpay/agent-trust     who may spend, how much, atomically
//   @furlpay/payment-intent  the durable record a retry recovers
//   @furlpay/ledger          double-entry accounting
//
// NOTHING IS REIMPLEMENTED HERE. Every safety property comes from the package
// that owns it; this file is wiring and an in-memory store, which is why it is
// short enough to read in one sitting.
//
// THE ORDER IS THE PRODUCT:
//
//   idempotency lookup  -> a retry finds the existing intent, and never pays twice
//   gateway.authorize   -> identity, quote binding, replay, THEN policy, THEN settle
//   commit              -> reservation committed and ledger written together
//
// The policy hook runs INSIDE gateway.authorize, after the payment's MAC and
// nonce have been checked. That ordering is the gateway's, not this file's,
// and it is the reason budget is charged to a proven payer rather than a
// claimed one.
// ---------------------------------------------------------------------------

const config = loadConfig();
const audit = new AuditLog();
const ledger = new Ledger();
const limiter = new SpendLimiter();

/** The two accounts this example posts between. Double-entry needs both. */
const AGENT_FUNDS = ledger.openAccount({ code: "1000", name: "Agent funds", type: "asset", currency: "USDC" });
const API_REVENUE = ledger.openAccount({ code: "4000", name: "API revenue", type: "revenue", currency: "USDC" });

// ── durable-shaped stores ──────────────────────────────────────────────────
//
// In memory for the example, addressed exactly as a table would be. The
// idempotency key is (principalId, idempotencyKey) — the composite that a real
// UNIQUE constraint would enforce, and the reason principal A's `order_123`
// cannot collide with principal B's.
const intents = new Map<string, PaymentIntent>();
const byIdempotency = new Map<string, string>();
/**
 * The composite an idempotency table would enforce as `UNIQUE (principal, key)`.
 *
 * The separator is NUL because it cannot occur in either component. A printable
 * one would let `("a b", "c")` and `("a", "b c")` collide into the same row —
 * one tenant replaying another tenant's receipt, which is the exact failure
 * this key exists to prevent.
 */
const idemKey = (principalId: string, key: string) => `${principalId}\0${key}`;

const rail = new TestPaymentRail({ network: config.network });

/** Prices live server-side. A price the agent supplies is a price the agent chooses. */
const PRICES: Record<string, number> = { "/search": Number(config.priceAtomic) };

const policy: SpendPolicyHook = {
  reserve({ agentId, endpoint }: { agentId: string; endpoint: string; amountAtomic: string }) {
    // The gateway passes the RESOURCE, which is a full URL. Prices are keyed by
    // path, because a price that changed with the host or the query string
    // would let the same endpoint cost different amounts depending on how it
    // was addressed.
    const path = pathOf(endpoint);
    const d = reserveSpend(limiter, { agentId, endpoint: path, prices: PRICES });
    if (!d.ok) {
      audit.record({ type: "POLICY_DENIED", agentId, endpoint: path, detail: d.reason });
      return { ok: false, reason: d.reason, message: d.message };
    }
    audit.record({
      type: "BUDGET_RESERVED",
      agentId,
      endpoint: path,
      reservationId: d.reservation.id,
      amountAtomic: String(d.reservation.amount),
    });
    return { ok: true, reservationId: d.reservation.id };
  },
  commit(reservationId: string) {
    limiter.commit(reservationId);
    audit.record({ type: "BUDGET_COMMITTED", reservationId });
  },
  release(reservationId: string) {
    limiter.release(reservationId);
    audit.record({ type: "BUDGET_RELEASED", reservationId });
  },
};

const gateway = new Gateway({
  // The gateway prices in MAJOR units and converts to atomic itself, so the
  // divisor here is the one place this example touches a fraction — and it
  // is display/protocol input, never an amount used for accounting.
  price: () => Number(config.priceAtomic) / 10 ** config.decimals,
  payTo: config.payTo,
  quoteSecret: config.quoteSecret,
  network: config.network,
  asset: config.asset,
  facilitator: rail,
  policy,
  description: () => "FurlPay example search API",
  onRejected: (info) => {
    audit.record({ type: "POLICY_DENIED", endpoint: info.resource, agentId: info.payer, detail: info.reason });
  },
});

/** A resource URL reduced to the path the price table is keyed by. */
function pathOf(resource: string): string {
  try {
    return new URL(resource).pathname;
  } catch {
    // Already a path, or unparseable. Returning it unchanged means an
    // unrecognised value fails closed at the price lookup rather than here.
    return resource;
  }
}

/** Canonical request hash. Same request must hash the same however it arrives. */
/**
 * Canonical fingerprint of the request an Idempotency-Key was issued for.
 *
 * THE QUERY STRING IS PART OF THE REQUEST. Hashing only the pathname would
 * make `/search?q=cheap` and `/search?q=expensive` the same request, so a
 * reused key would replay the first receipt for the second call — handing the
 * caller proof of a payment they never made. Pricing is keyed by path (see
 * `pathOf`) because a price must not vary with the query; identity is keyed by
 * path AND query because the resource does.
 *
 * Parameters are sorted so that `?a=1&b=2` and `?b=2&a=1` are recognised as
 * the same request, which they are; a caller must not be able to defeat
 * idempotency by reordering.
 */
function hashRequest(method: string, url: string, body: string): string {
  const u = new URL(url, "http://x");
  const params = [...u.searchParams.entries()].sort(([a, av], [b, bv]) =>
    a === b ? av.localeCompare(bv) : a.localeCompare(b)
  );
  const canonicalQuery = params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
  return createHash("sha256")
    .update(`${method}\n${u.pathname}\n${canonicalQuery}\n${body}`)
    .digest("hex")
    .slice(0, 32);
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", `http://localhost:${config.port}`);

  // Operator surfaces. Not paid — an operator reading their own ledger is not
  // an agent buying a resource.
  if (url.pathname === "/admin/ledger") return json(res, 200, ledgerView());
  if (url.pathname === "/admin/audit") return json(res, 200, { events: audit.all() });
  if (url.pathname === "/admin/revoke") {
    const agentId = url.searchParams.get("agent") ?? "";
    limiter.revoke(agentId);
    audit.record({ type: "AGENT_REVOKED", agentId });
    return json(res, 200, { revoked: agentId });
  }
  if (url.pathname !== "/search") return json(res, 404, { error: "not_found" });

  const body = await readBody(req);
  const principalId = header(req, "x-furlpay-principal") ?? "principal_demo";
  const idempotencyKey = header(req, "idempotency-key");
  const requestId = header(req, "x-request-id") ?? randomUUID();
  const requestHash = hashRequest(req.method ?? "GET", url.toString(), body);

  // ── 1. idempotency: has this exact request already happened? ────────────
  if (idempotencyKey) {
    const existingId = byIdempotency.get(idemKey(principalId, idempotencyKey));
    const existing = existingId ? intents.get(existingId) : undefined;
    if (existing) {
      if (isKeyReuse(existing, { principalId, idempotencyKey, requestHash })) {
        // Same key, different request. Replaying the first result here would
        // hand the caller a receipt for something they did not ask for.
        return json(res, 422, {
          error: "idempotency_key_reused",
          message: "This Idempotency-Key was already used for a different request.",
        });
      }
      if (matches(existing, { principalId, idempotencyKey, requestHash })) {
        const recovery = recoveryFor(existing);
        audit.record({
          type: "IDEMPOTENT_REPLAY",
          principalId,
          agentId: existing.agentId,
          paymentIntentId: existing.paymentIntentId,
          detail: recovery.action,
        });
        if (recovery.action === "replay") {
          return json(res, 200, { ...searchResult(url), paymentIntentId: existing.paymentIntentId, replayed: true });
        }
        // reconcile / in_progress: a signature may exist, so this must NOT
        // start a second payment. The honest answer is 409 plus the intent id.
        return json(res, 409, {
          error: "payment_in_progress",
          message: "An earlier attempt for this key may already have paid. Reconcile it before retrying.",
          paymentIntentId: existing.paymentIntentId,
          recovery: recovery.action,
        });
      }
    }
  }

  // ── 2. the gateway: 402, or identity + policy + reservation + settle ────
  const decision = await gateway.authorize({
    method: req.method ?? "GET",
    url: url.toString(),
    // Node gives string[] for repeated headers; the gateway wants one value
    // per name. Taking the FIRST is deliberate: a duplicated payment header
    // is a smuggling attempt, and concatenating them would let the second
    // copy alter how the first parses.
    headers: flattenHeaders(req.headers),
    body,
  });

  if (decision.kind === "challenge") {
    // No PaymentIntent yet: nothing has been reserved and no money can move.
    // Creating one here would litter the store with a row per unpaid probe.
    return json(res, 402, decision.body, decision.headers);
  }
  if (decision.kind === "deny") {
    // 403. Policy said no; paying again cannot change that.
    return json(res, 403, decision.body, decision.headers);
  }
  if (decision.kind === "reject") {
    return json(res, 400, decision.body, decision.headers);
  }

  // ── 3. allowed and settled. Record the intent, ledger and audit. ────────
  const receipt = decision.receipt;
  const agentId = receipt.payer;

  let intent = createIntent({
    paymentIntentId: `pi_${randomUUID()}`,
    principalId,
    agentId,
    requestId,
    idempotencyKey: idempotencyKey ?? requestId,
    requestHash,
    merchant: config.payTo,
    resource: receipt.resource,
    endpoint: url.pathname,
    amountAtomic: receipt.amountAtomic,
    currency: "USDC",
    asset: config.asset,
    network: receipt.network,
    payee: config.payTo,
    ttlSeconds: 300,
  });

  // The gateway has already done all of this; the intent records that it
  // happened, in order, so an auditor sees the journey and not just the end.
  intent = transition(intent, "POLICY_CHECKED");
  intent = transition(intent, "BUDGET_RESERVED");
  intent = transition(intent, "PAYMENT_REQUIRED");
  intent = transition(intent, "PAYMENT_SUBMITTED", {
    payer: agentId,
    transactionSignature: receipt.transaction || undefined,
  });
  intent = transition(intent, "PAYMENT_OBSERVED");
  intent = transition(intent, "PAYMENT_CONFIRMED", { confirmationState: "confirmed" });
  intent = transition(intent, "SETTLED", { settlementState: "settled" });
  intent = transition(intent, "COMMITTED");

  intents.set(intent.paymentIntentId, intent);
  if (idempotencyKey) byIdempotency.set(idemKey(principalId, idempotencyKey), intent.paymentIntentId);

  // One logical payment, one accounting event. The ledger's own invariant
  // (debits == credits) is enforced inside the package.
  // From the OPERATOR's books: funds received are an asset (debit), and the
  // sale is revenue (credit). Reversing these makes revenue read negative —
  // which is exactly what the first run of this example did, and is why the
  // sides are spelled out rather than left to intuition.
  const tx = ledger.post(`${intent.paymentIntentId} ${url.pathname}`, [
    { accountId: AGENT_FUNDS.id, side: "debit", amount: Number(receipt.amountAtomic) },
    { accountId: API_REVENUE.id, side: "credit", amount: Number(receipt.amountAtomic) },
  ]);

  audit.record({
    type: "SETTLEMENT_COMPLETED",
    principalId,
    agentId,
    paymentIntentId: intent.paymentIntentId,
    requestId,
    endpoint: url.pathname,
    amountAtomic: receipt.amountAtomic,
    detail: receipt.transaction || "(no on-chain reference)",
  });
  audit.record({ type: "LEDGER_COMMITTED", paymentIntentId: intent.paymentIntentId, detail: tx.id });

  return json(res, 200, {
    ...searchResult(url),
    paymentIntentId: intent.paymentIntentId,
    ledgerTxId: tx.id,
    settlementReference: receipt.transaction,
    rail: config.rail,
  }, decision.headers);
}

function searchResult(url: URL) {
  const q = url.searchParams.get("q") ?? "";
  return { query: q, results: [`result for "${q}"`, `another result for "${q}"`] };
}

function ledgerView() {
  return {
    entries: ledger.listTransactions().map((t) => ({
      ledgerTxId: t.id,
      at: t.ts,
      memo: t.memo,
      amountAtomic: String(t.postings[0]?.amount ?? 0),
    })),
    revenueAtomic: String(ledger.balanceOf(API_REVENUE.id)),
  };
}

function flattenHeaders(h: IncomingMessage["headers"]): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(h)) out[k] = Array.isArray(v) ? v[0] : v;
  return out;
}

function header(req: IncomingMessage, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
  });
}

function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify(body, null, 2));
}

// ── agent registration ─────────────────────────────────────────────────────
export function registerDemoAgent(agentId: string, budgetUsd: string): void {
  limiter.register(agentId, {
    maxPerRequest: toMicros("0.01"),
    maxTotal: toMicros(budgetUsd),
  });
}

/** Funds received from agents. An asset to the operator, so debit-normal. */
export { AGENT_FUNDS, API_REVENUE };

export { audit, ledger, limiter, gateway, config, intents, byIdempotency, idemKey };

if (process.env.FURLPAY_EXAMPLE_AUTOSTART !== "0") {
  registerDemoAgent(process.env.FURLPAY_DEMO_AGENT ?? "agent-demo", process.env.FURLPAY_DEMO_BUDGET ?? "5");
  createServer((req, res) => {
    handle(req, res).catch((e) => {
      // An unhandled error must never look like a paid success.
      json(res, 500, { error: "internal", message: String(e?.message ?? e) });
    });
  }).listen(config.port, () => {
    console.log(`\nFurlPay example paid API`);
    console.log(`  listening   http://localhost:${config.port}`);
    console.log(`  rail        ${config.rail === "test" ? "TEST RAIL (no money moves)" : "SOLANA DEVNET"}`);
    console.log(`  price       $${formatAtomic(config.priceAtomic, config.decimals)} per /search`);
    console.log(`  agent       ${process.env.FURLPAY_DEMO_AGENT ?? "agent-demo"}, budget $${process.env.FURLPAY_DEMO_BUDGET ?? "5"}\n`);
  });
}

export { handle };
