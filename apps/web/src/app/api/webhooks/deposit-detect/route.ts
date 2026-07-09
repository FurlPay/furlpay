import { NextResponse } from "next/server";
import crypto from "crypto";
import { CHAINS, TOKENS, type Chain, type Token } from "@furlpay/types";
import { recordDepositEvent, markCredited } from "@/lib/services/deposits";
import { usdPrice } from "@/lib/services/swap";
import { db } from "@/lib/store";
import { log } from "@/lib/log";
import { limit } from "@/lib/rateLimit";
import { sendEmail } from "@/lib/email";
import { depositReceivedEmail } from "@/lib/emailTemplates";
import { lockLinkFor } from "@/lib/lockLink";

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

// Watched deposit addresses: the user's Safe plus an optional per-chain
// treasury override (TREASURY_ADDRESS_BSC, TREASURY_ADDRESS_ETHEREUM, …).
function isWatchedAddress(to: string, chain: Chain): boolean {
  const treasury = process.env[`TREASURY_ADDRESS_${chain.toUpperCase()}`];
  const watched = [db.user.safeAddress, treasury].filter(Boolean) as string[];
  return watched.some((w) => w.toLowerCase() === to.toLowerCase());
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

  if (!isWatchedAddress(to, chain)) {
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

  const event = await recordDepositEvent({ txHash, token, chain, amount, from, to, confirmations });

  // Credit the ledger exactly once per transaction, on the success transition.
  if (event.status === "success" && (await markCredited(txHash))) {
    const bal = db.tokenBalances.find((b) => b.token === token && b.chain === chain);
    if (bal) {
      bal.amount += amount;
      bal.usdValue = bal.amount * usdPrice(token);
    } else {
      db.tokenBalances.push({ token, chain, amount, usdValue: amount * usdPrice(token) });
    }
    log.info("deposit credited", { txHash, token, chain, amount });
    if (db.user.email) {
      // Keyed by txHash: markCredited already guarantees one credit, and the
      // idempotency key catches a redelivered webhook racing the KV guard.
      void sendEmail({
        to: db.user.email,
        category: "deposit",
        idempotencyKey: `deposit-${txHash}`,
        ...depositReceivedEmail({
          amount,
          token,
          chain,
          txHash,
          confirmations: event.confirmations,
          lockUrl: lockLinkFor(db.user.id) ?? undefined,
        }),
      });
    }
  }

  return NextResponse.json({ status: "processed", txHash, state: event.status, orderId: event.orderId });
}
