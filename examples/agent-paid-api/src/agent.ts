import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// The agent.
//
// It does what an autonomous client actually does: asks, gets told the price,
// decides whether that fits its own authority, pays, and asks again. The
// interesting part is what it does NOT do — it never treats a 403 as a reason
// to pay again, which is the loop that empties a budget at machine speed.
//
// THE PAYMENT RAIL IS ONE FUNCTION. `signPayment` below builds the payload for
// the test rail. Swapping it for a real Solana signer changes this file and
// nothing else in FurlPay: the control plane never learns how a transaction is
// constructed, which is the whole point of keeping the rail replaceable.
// ---------------------------------------------------------------------------

const BASE = process.env.FURLPAY_EXAMPLE_URL ?? "http://localhost:4021";
const AGENT_ID = process.env.FURLPAY_DEMO_AGENT ?? "agent-demo";
const PRINCIPAL = process.env.FURLPAY_DEMO_PRINCIPAL ?? "principal_demo";

interface Requirements {
  scheme: string;
  network: string;
  maxAmountRequired: string;
  resource: string;
  payTo: string;
  asset: string;
  extra: { quoteId: string; binding: string; expiresAt: number; [k: string]: unknown };
}

/**
 * Build the payment payload.
 *
 * ON THE TEST RAIL the "signature" is a literal marker, never a base58 blob —
 * a real-looking signature in a demo is how a fake receipt escapes into a log
 * or a CSV and gets believed. The quote fields are echoed back untouched
 * because the SERVER re-derives and MACs them; an agent that could alter them
 * could pay a cheap price for an expensive resource.
 */
function signPayment(req: Requirements, agentId: string) {
  const now = Math.floor(Date.now() / 1000);
  return {
    x402Version: 1,
    scheme: req.scheme,
    network: req.network,
    payload: {
      signature: "TESTRAIL-unsigned",
      authorization: {
        from: agentId,
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

async function call(
  path: string,
  opts: { payment?: unknown; idempotencyKey?: string } = {}
): Promise<{ status: number; body: any; headers: Headers }> {
  const headers: Record<string, string> = { "x-furlpay-principal": PRINCIPAL };
  if (opts.payment) headers["x-payment"] = Buffer.from(JSON.stringify(opts.payment)).toString("base64");
  if (opts.idempotencyKey) headers["idempotency-key"] = opts.idempotencyKey;
  const res = await fetch(`${BASE}${path}`, { headers });
  return { status: res.status, body: await res.json().catch(() => null), headers: res.headers };
}

/** One paid call: ask, read the price, pay, ask again. */
async function paidCall(query: string, idempotencyKey?: string) {
  const path = `/search?q=${encodeURIComponent(query)}`;

  const challenge = await call(path, { idempotencyKey });
  if (challenge.status !== 402) return challenge;

  const req: Requirements = challenge.body.accepts[0];
  return call(path, { payment: signPayment(req, AGENT_ID), idempotencyKey });
}

const line = (s = "") => console.log(s);
const money = (atomic: string) => `$${(Number(atomic) / 1e6).toFixed(6)}`;

async function main() {
  line();
  line("FurlPay — agent paying for an API, per request");
  line(`  agent      ${AGENT_ID}`);
  line(`  principal  ${PRINCIPAL}`);
  line(`  server     ${BASE}`);
  line();

  // ── 1. the 402 ──────────────────────────────────────────────────────────
  line("[1] GET /search with no payment");
  const first = await call("/search?q=hello");
  line(`    -> ${first.status} ${first.status === 402 ? "Payment Required" : ""}`);
  if (first.status !== 402) {
    line("    unexpected: expected a 402 challenge");
    process.exit(1);
  }
  const req: Requirements = first.body.accepts[0];
  line(`    price      ${money(req.maxAmountRequired)}`);
  line(`    network    ${req.network}`);
  line(`    asset      ${req.asset}`);
  line(`    payTo      ${req.payTo}`);
  line();

  // ── 2. pay ──────────────────────────────────────────────────────────────
  line("[2] authorising payment and retrying");
  const paid = await call("/search?q=hello", { payment: signPayment(req, AGENT_ID) });
  line(`    -> ${paid.status} ${paid.status === 200 ? "OK" : JSON.stringify(paid.body)}`);
  if (paid.status !== 200) process.exit(1);
  line(`    paymentIntent  ${paid.body.paymentIntentId}`);
  line(`    ledger tx      ${paid.body.ledgerTxId}`);
  line(`    settlement     ${paid.body.settlementReference}   (rail: ${paid.body.rail})`);
  line(`    results        ${paid.body.results.length}`);
  line();

  // ── 3. idempotent retry ─────────────────────────────────────────────────
  line("[3] the same request again, same Idempotency-Key");
  const key = `demo-${randomUUID()}`;
  const once = await paidCall("idempotent", key);
  const twice = await paidCall("idempotent", key);
  line(`    first  -> ${once.status}  intent ${once.body.paymentIntentId}`);
  line(`    second -> ${twice.status}  intent ${twice.body.paymentIntentId} ${twice.body.replayed ? "(replayed)" : ""}`);
  line(
    once.body.paymentIntentId === twice.body.paymentIntentId
      ? "    SAME PaymentIntent — charged once."
      : "    DIFFERENT intents — this would be a double charge."
  );
  line();

  // ── 4. budget exhaustion ────────────────────────────────────────────────
  line("[4] spending the budget down until FurlPay refuses");
  let allowed = 0;
  let denied = 0;
  let firstDenial: any = null;
  for (let i = 0; i < 200; i++) {
    const r = await paidCall(`bulk-${i}`);
    if (r.status === 200) allowed++;
    else {
      denied++;
      firstDenial ??= r;
      break;
    }
  }
  line(`    allowed ${allowed}, then stopped`);
  if (firstDenial) {
    line(`    -> ${firstDenial.status} ${firstDenial.body?.reason ?? ""}`);
    line(
      firstDenial.status === 403
        ? "    403, not 402 — an exhausted agent is not told to pay again."
        : `    unexpected status ${firstDenial.status}`
    );
  }
  line();

  // ── 5. revocation ───────────────────────────────────────────────────────
  line("[5] revoking the agent");
  await fetch(`${BASE}/admin/revoke?agent=${encodeURIComponent(AGENT_ID)}`);
  const afterRevoke = await paidCall("after-revoke");
  line(`    -> ${afterRevoke.status} ${afterRevoke.body?.reason ?? ""}`);
  line(afterRevoke.status === 403 ? "    denied." : `    unexpected: ${afterRevoke.status}`);
  line();

  // ── 6. the audit trail ──────────────────────────────────────────────────
  const ledgerView = (await (await fetch(`${BASE}/admin/ledger`)).json()) as {
    entries: unknown[];
    revenueAtomic: string;
  };
  const auditView = (await (await fetch(`${BASE}/admin/audit`)).json()) as {
    events: { type: string }[];
  };
  line("[6] what the operator can see");
  line(`    ledger entries  ${ledgerView.entries.length}`);
  line(`    revenue         ${money(ledgerView.revenueAtomic)}`);
  line(`    audit events    ${auditView.events.length}`);
  const kinds = auditView.events.reduce((acc: Record<string, number>, e) => {
    acc[e.type] = (acc[e.type] ?? 0) + 1;
    return acc;
  }, {});
  for (const [k, v] of Object.entries(kinds)) line(`      ${String(k).padEnd(22)} ${v}`);
  line();
  line("Rail: TEST — no money moved. Set FURLPAY_RAIL=solana-devnet for real settlement.");
  line();
}

main().catch((e) => {
  console.error("\nagent failed:", e?.message ?? e);
  console.error("is the server running?  npm run dev");
  process.exit(1);
});
