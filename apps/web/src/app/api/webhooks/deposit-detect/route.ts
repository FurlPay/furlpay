import { NextResponse } from "next/server";
import crypto from "crypto";
import type { Chain } from "@furlpay/types";
import { claimDepositNotification, recordDepositEvent } from "@/lib/services/deposits";
import { usdPrice } from "@/lib/services/swap";
import { getAccountDurable, newTx, recordTransaction } from "@/lib/store";
import { findLinkedWalletOwner } from "@/lib/linkedWalletStore";
import { depositKey, parseDepositPayload, type DepositFacts } from "@/lib/deposits/parseDeposit";
import { log } from "@/lib/log";
import { limit, rateLimitIdentity } from "@/lib/rateLimit";
import { normalizeIp, trustedClientIp } from "@/lib/clientIp";
import { sendEmail } from "@/lib/email";
import { depositReceivedEmail } from "@/lib/emailTemplates";
import { lockLinkFor } from "@/lib/lockLink";
import { occurredAtMs, recordApplied, staleEvent } from "@/lib/webhookOrdering";
import { audit } from "@/lib/audit";
import { withDurableWebhook } from "@/lib/withDurableWebhook";
import { raiseFinancialAlert } from "@/lib/ops/financialAlerts";

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
function ipAllowed(ip: string | null): boolean {
  const allow = (process.env.DEPOSIT_WEBHOOK_ALLOWED_IPS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (allow.length === 0) return true;
  return ip !== null && allow.map((a) => normalizeIp(a) ?? a).includes(ip);
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

// WHOSE DEPOSIT IS THIS, AND WHAT DOES IT MEAN? (audit P1-11 / P1-12)
//
// A per-user deposit address is a VERIFIED linked wallet — the user's own
// self-custody key (EIP-191-proven, lib/receiveAddress.ts). Coins that land
// there are ALREADY the user's, on-chain. The old handler ALSO added them to
// account.tokenBalances, an internal FurlPay balance: two claims on one asset,
// a double-spend the day any spend-from-balance rail goes live. For a
// self-custody address the chain is the source of truth, so this handler now
// records ACTIVITY (history + notification) and creates NO balance claim and
// NO ledger posting. A custodial credit needs a FurlPay-controlled deposit
// address, which does not exist yet; when it does, it is a financial effect
// (apply_financial_effect, key = depositKey()) — not a line in this handler.
//
// Resolution is DURABLE (findLinkedWalletOwner reads linked_wallets by its
// primary key). It used to scan only accounts loaded into this instance and
// answer 200 "ignored_address" for everyone else. Now:
//   - owner found              → record activity for that user
//   - the per-chain treasury   → UNATTRIBUTED: recorded and audited
//   - genuinely unknown        → 200 ignored_address (it is not ours)
//   - lookup failed            → 503, so the provider retries
type Recipient = { kind: "self_custody"; userId: string } | { kind: "treasury" };

async function resolveRecipient(to: string, chain: Chain): Promise<Recipient | null> {
  const userId = await findLinkedWalletOwner(to);
  if (userId) return { kind: "self_custody", userId };
  const treasury = process.env[`TREASURY_ADDRESS_${chain.toUpperCase()}`];
  if (treasury && treasury.toLowerCase() === to.toLowerCase()) return { kind: "treasury" };
  return null;
}

export async function POST(req: Request) {
  // Cheap pre-verification shield: node providers batch, so 240/min per IP is
  // generous for legit traffic while capping HMAC work from a flood.
  // A configured allowlist admits only an established address; without one,
  // the HMAC below is the control.
  if (!ipAllowed(trustedClientIp(req))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const rl = await limit(`webhooks.deposit:${rateLimitIdentity(req)}`, { limit: 240, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const rawBody = await req.text();
  if (!verifySignature(rawBody, req)) {
    return NextResponse.json({ error: "Unauthorized signature" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Exact facts or a 400 — no float amounts, no defaulted chain/token (P1-13).
  const parsed = parseDepositPayload(payload);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const f = parsed.facts;

  let recipient: Recipient | null;
  try {
    recipient = await resolveRecipient(f.to, f.chain);
  } catch (e) {
    log.error("deposit recipient lookup failed — asking provider to retry", {
      txHash: f.txHash,
      error: (e as Error).message.slice(0, 200),
    });
    void raiseFinancialAlert("recipient_lookup_failed", { chain: f.chain, txHash: f.txHash });
    return NextResponse.json({ error: "recipient_lookup_unavailable", txHash: f.txHash }, { status: 503 });
  }
  if (!recipient) {
    return NextResponse.json({ status: "ignored_address" });
  }
  const to = recipient;

  // ORDERING, which idempotency does not cover. Providers make no ordering
  // guarantee, so a delayed low-confirmation event for this transfer can
  // arrive AFTER a later high-confirmation one and walk its state backwards.
  const p = payload as Record<string, unknown>;
  const tx = (p.transaction && typeof p.transaction === "object" ? p.transaction : p) as Record<string, unknown>;
  const ordering = {
    resource: depositKey(f),
    occurredAtMs: occurredAtMs(p.timestamp ?? p.occurredAt ?? tx.timestamp ?? tx.blockTimestamp),
  };
  if (await staleEvent(ordering)) {
    return NextResponse.json({ status: "ignored_stale", txHash: f.txHash });
  }

  const event = await recordDepositEvent({
    txHash: f.txHash,
    token: f.token,
    chain: f.chain,
    // Display-only activity figure; the exact amount is f.amount.
    amount: Number(f.amount),
    from: f.from,
    to: f.to,
    confirmations: f.confirmations,
  });

  // Notify once per transfer, on the success transition. Nothing here moves
  // money, but a duplicate notification is still wrong, so the durable claim
  // (0022/0024) keys it on the transfer identity.
  if (event.status === "success") {
    const outcome = await withDurableWebhook<"notified" | "unattributed" | "skipped" | "mismatch" | "unavailable">({
      provider: "deposit-activity",
      eventId: depositKey(f),
      eventType: "deposit.observed",
      rawBody: JSON.stringify({
        chain: f.chain,
        txHash: f.txHash,
        logIndex: f.logIndex,
        token: f.token,
        to: f.to.toLowerCase(),
        amount: f.amount,
      }),
      onDuplicate: () => "skipped",
      onMismatch: () => {
        audit("webhook.payload_mismatch", "system", { provider: "deposit-activity", chain: f.chain, txHash: f.txHash });
        return "mismatch";
      },
      onUnavailable: () => "unavailable",
      handler: async () => notifyDeposit(to, f, event.confirmations),
    });
    if (outcome === "unavailable") {
      return NextResponse.json({ error: "deposit_store_unavailable", txHash: f.txHash }, { status: 503 });
    }
    if (outcome === "mismatch") {
      return NextResponse.json({ error: "payload_mismatch", txHash: f.txHash }, { status: 400 });
    }
  }

  await recordApplied(ordering);
  return NextResponse.json({ status: "processed", txHash: f.txHash, state: event.status, orderId: event.orderId });
}

async function notifyDeposit(
  recipient: Recipient,
  f: DepositFacts,
  confirmations: number
): Promise<"notified" | "unattributed"> {
  if (recipient.kind === "treasury") {
    audit("deposit.unattributed", "system", { chain: f.chain, txHash: f.txHash, token: f.token, amount: f.amount });
    log.warn("treasury deposit not attributable to a user", {
      txHash: f.txHash,
      token: f.token,
      chain: f.chain,
      amount: f.amount,
    });
    return "unattributed";
  }
  // Fast-path dedupe for the notice itself (KV; the durable claim above is the
  // authority where Postgres exists). Nothing financial depends on it.
  if (!(await claimDepositNotification(depositKey(f)))) return "notified";
  // SELF-CUSTODY: activity only. No tokenBalances change, no ledger posting —
  // the coins are in the user's own wallet and the chain is the record.
  const account = await getAccountDurable(recipient.userId);
  audit("deposit.self_custody_observed", recipient.userId, {
    chain: f.chain,
    txHash: f.txHash,
    token: f.token,
    amount: f.amount,
  });
  if (account) {
    recordTransaction(
      account.user.id,
      newTx({
        category: "transfer",
        direction: "in",
        title: `Received ${trimAmount(f.amount)} ${f.token}`,
        subtitle: `To your own wallet · ${f.chain} · ${f.txHash.slice(0, 10)}…`,
        // Display estimate only (activity row); the exact amount is in the title.
        amountUsd: Math.round(Number(f.amount) * usdPrice(f.token) * 100) / 100,
        token: f.token,
        chain: f.chain,
        status: "settled",
      })
    );
    if (account.user.email) {
      void sendEmail({
        to: account.user.email,
        category: "deposit",
        idempotencyKey: depositKey(f),
        ...depositReceivedEmail({
          amount: Number(f.amount),
          token: f.token,
          chain: f.chain,
          txHash: f.txHash,
          confirmations,
          lockUrl: lockLinkFor(account.user.id) ?? undefined,
        }),
      });
    }
  }
  return "notified";
}

/** "1000.500000000000000000" -> "1000.5" — exact, just without trailing zeros. */
function trimAmount(a: string): string {
  return a.includes(".") ? a.replace(/\.?0+$/, "") : a;
}
