import { NextResponse } from "next/server";
import crypto from "crypto";
import { CHAINS, TOKENS, type Chain, type Token } from "@furlpay/types";
import { recordDepositEvent, markCredited } from "@/lib/services/deposits";
import { usdPrice } from "@/lib/services/swap";
import { findUserByLinkedWallet, persistAccount, type UserAccount } from "@/lib/store";
import { log } from "@/lib/log";
import { limit } from "@/lib/rateLimit";
import { sendEmail } from "@/lib/email";
import { depositReceivedEmail } from "@/lib/emailTemplates";
import { lockLinkFor } from "@/lib/lockLink";
import { occurredAtMs, recordApplied, staleEvent } from "@/lib/webhookOrdering";
import { audit } from "@/lib/audit";

// POST /api/webhooks/deposit-detect — address-activity webhooks from QuickNode
// Streams (x-qn-signature) or Alchemy Notify (x-alchemy-signature). Both sign
// the raw body with HMAC-SHA256; comparison is constant-time. Node runtime
// for crypto.
export const runtime = "nodejs";

// Reject payloads whose provider timestamp is stale. Signature verification
// alone leaves a replay window: an intercepted signed payload stays valid
// forever (idempotency stops double-credits, but not probing). Providers send
// the timestamp in seconds or milliseconds — normalize both. No header at all
// is allowed (not every sender includes one); a present-but-stale one is not.
const MAX_WEBHOOK_AGE_MS = 5 * 60_000;

function timestampFresh(req: Request): boolean {
  const raw =
    req.headers.get("x-qn-timestamp") ?? req.headers.get("x-alchemy-webhook-timestamp");
  if (!raw) return true;
  const n = Number(raw);
  if (!Number.isFinite(n)) return false;
  const ms = n > 1e12 ? n : n * 1000;
  return Math.abs(Date.now() - ms) <= MAX_WEBHOOK_AGE_MS;
}

// Optional source-IP allowlist (defense in depth on top of the HMAC). Set
// DEPOSIT_WEBHOOK_ALLOWED_IPS to a comma-separated list to enable; unset
// means disabled, so the HMAC remains the primary and sufficient gate.
function ipAllowed(ip: string): boolean {
  const allow = (process.env.DEPOSIT_WEBHOOK_ALLOWED_IPS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return allow.length === 0 || allow.includes(ip);
}

function verifySignature(payload: string, req: Request): boolean {
  const secret = process.env.DEPOSIT_WEBHOOK_SECRET || process.env.QUICKNODE_WEBHOOK_SECRET || "";
  if (!secret) return false;
  const signature =
    req.headers.get("x-qn-signature") ?? req.headers.get("x-alchemy-signature") ?? "";
  if (!signature) return false;
  if (!timestampFresh(req)) return false;
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// WHOSE DEPOSIT IS THIS? This used to watch only the seeded DEMO account's
// `safeAddress` (a placeholder no key controls — see lib/receiveAddress.ts)
// plus the shared treasury, and credited EVERY matching deposit — treasury
// ones included — to the demo account's balances and emailed the demo address.
// No real user's deposit was ever attributed to them.
//
// Resolution is now:
//   - a VERIFIED linked wallet (EIP-191-proven, the only payable per-user
//     address; lib/receiveAddress.ts) -> that user's account
//   - the per-chain treasury -> UNATTRIBUTED: recorded and audited, credited to
//     nobody, because a shared address carries no evidence of whose money it is
//   - anything else -> ignored
//
// KNOWN LIMIT: findUserByLinkedWallet scans accounts loaded in THIS instance.
// A deposit for an account another instance holds is ignored (never wrongly
// credited). Closing that needs a durable address index — PGA2-R01 in
// docs/audit/PRODUCTION_GAP_AUDIT.md.
type Recipient = { kind: "user"; account: UserAccount } | { kind: "treasury" };

function resolveRecipient(to: string, chain: Chain): Recipient | null {
  const account = findUserByLinkedWallet(to);
  if (account) return { kind: "user", account };
  const treasury = process.env[`TREASURY_ADDRESS_${chain.toUpperCase()}`];
  if (treasury && treasury.toLowerCase() === to.toLowerCase()) return { kind: "treasury" };
  return null;
}

export async function POST(req: Request) {
  // Cheap pre-verification shield: node providers batch, so 240/min per IP is
  // generous for legit traffic while capping HMAC work from a flood.
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!ipAllowed(ip)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const rl = await limit(`webhooks.deposit:${ip}`, { limit: 240, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const rawBody = await req.text();
  if (!verifySignature(rawBody, req)) {
    return NextResponse.json({ error: "Unauthorized signature" }, { status: 401 });
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const tx = payload.transaction ?? payload;
  const txHash: string = String(tx.hash ?? tx.txHash ?? "");
  const to: string = String(tx.to ?? "");
  const from: string = String(tx.from ?? "");
  if (!txHash || !to) {
    return NextResponse.json({ error: "Missing transaction fields" }, { status: 400 });
  }

  const chain = String(payload.network ?? tx.network ?? "bsc").toLowerCase() as Chain;
  if (!CHAINS.includes(chain)) {
    return NextResponse.json({ error: `Unsupported network "${chain}"` }, { status: 400 });
  }
  const token = String(payload.token ?? tx.token ?? "USDT").toUpperCase() as Token;
  if (!TOKENS.includes(token)) {
    return NextResponse.json({ error: `Unsupported token "${token}"` }, { status: 400 });
  }

  const recipient = resolveRecipient(to, chain);
  if (!recipient) {
    return NextResponse.json({ status: "ignored_address" });
  }

  // Amount: prefer a normalized value; else convert raw base units using the
  // payload's decimals (BEP-20 stables are 18-decimal, unlike 6 elsewhere).
  const amount =
    payload.amount != null
      ? Number(payload.amount)
      : Number(tx.value ?? 0) / 10 ** Number(payload.decimals ?? 18);
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
  }

  const confirmations = Number(
    payload.confirmations ?? (tx.blockNumber != null && tx.blockNumber !== null ? 1 : 0)
  );

  // ORDERING, which idempotency does not cover. Providers make no ordering
  // guarantee, so a delayed low-confirmation event for this transaction can
  // arrive AFTER a later high-confirmation one — different event ids, both
  // genuinely new, both claimed successfully — and walk the deposit's state
  // backwards. Keyed on the TRANSACTION because that is the thing being
  // changed; the event id is what webhookGuard already dedupes.
  const ordering = {
    resource: `deposit:${chain}:${txHash.toLowerCase()}`,
    occurredAtMs: occurredAtMs(
      payload.timestamp ?? payload.occurredAt ?? tx.timestamp ?? tx.blockTimestamp
    ),
  };
  if (await staleEvent(ordering)) {
    return NextResponse.json({ status: "ignored_stale", txHash });
  }

  const event = await recordDepositEvent({ txHash, token, chain, amount, from, to, confirmations });

  // Credit the ledger exactly once per transaction, on the success transition.
  if (event.status === "success" && recipient.kind === "treasury") {
    // Recorded (recordDepositEvent above) and audited, credited to no one.
    audit("deposit.unattributed", "system", { chain, txHash, token, amount });
    log.warn("treasury deposit not attributable to a user", { txHash, token, chain, amount });
  } else if (event.status === "success" && recipient.kind === "user" && (await markCredited(txHash))) {
    const account = recipient.account;
    const bal = account.tokenBalances.find((b) => b.token === token && b.chain === chain);
    if (bal) {
      bal.amount += amount;
      bal.usdValue = bal.amount * usdPrice(token);
    } else {
      account.tokenBalances.push({ token, chain, amount, usdValue: amount * usdPrice(token) });
    }
    void persistAccount(account.user.id);
    log.info("deposit credited", { txHash, token, chain, amount, userId: account.user.id });
    if (account.user.email) {
      // Keyed by txHash: markCredited already guarantees one credit, and the
      // idempotency key catches a redelivered webhook racing the KV guard.
      void sendEmail({
        to: account.user.email,
        category: "deposit",
        idempotencyKey: `deposit-${txHash}`,
        ...depositReceivedEmail({
          amount,
          token,
          chain,
          txHash,
          confirmations: event.confirmations,
          lockUrl: lockLinkFor(account.user.id) ?? undefined,
        }),
      });
    }
  }

  await recordApplied(ordering);
  return NextResponse.json({ status: "processed", txHash, state: event.status, orderId: event.orderId });
}
