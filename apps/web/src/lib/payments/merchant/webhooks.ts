import { randomBytes } from "crypto";
import { sbDelete, sbRpc, sbSelect, sbUpdate, sbUpsert } from "@/lib/supabase";
import { checkUrl, pinnedFetch } from "@/lib/property/safeFetch";
import { openSealedWebhookSecret, sealWebhookSecret } from "@/lib/ramp/partnerConfig";
import { signPartnerPayload } from "@/lib/ramp/partnerWebhooks";
import { requireStorage } from "./repository";

// ---------------------------------------------------------------------------
// Merchant webhooks: delivers the 0040 outbox (payment.succeeded, invoice.paid)
// to the merchant's HTTPS endpoint (migration 0041).
//
//   POST <url>                       Content-Type: application/json
//   X-FurlPay-Event-Id: <outbox id>  (same on every retry: dedupe on it)
//   X-FurlPay-Attempt: <n>
//   X-FurlPay-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, `${t}.${body}`)>
//
// Same signature scheme and SSRF posture as partner webhooks
// (lib/ramp/partnerWebhooks.ts): https only, the host is resolved and checked
// against private/loopback/metadata ranges and the socket pinned to that
// address, redirects not followed. At-least-once; 5 attempts at 1 min, 10 min,
// 1 h, 6 h. The ledger, not the webhook, is the source of truth.
// ---------------------------------------------------------------------------

export const MAX_ATTEMPTS = 5;
export const BACKOFF_S = [60, 600, 3_600, 21_600];
const LEASE_S = 120;
const aad = (merchantId: string) => `merchant:${merchantId}`;

type Endpoint = { merchant_id: string; url: string; secret_enc: string; secret_last4: string; created_at?: string; updated_at?: string };
export type OutboxRow = { id: string; merchant_id: string; intent_id: string; type: string; payload: Record<string, unknown>; created_at: string; attempts: number };

/** A public view of the endpoint: never the secret. */
export async function getEndpoint(merchantId: string) {
  requireStorage();
  const [row] = await sbSelect<Endpoint>("merchant_webhook_endpoints", `merchant_id=eq.${encodeURIComponent(merchantId)}&limit=1`);
  return row ? { url: row.url, secretLast4: row.secret_last4, updatedAt: row.updated_at ?? null } : null;
}

/** Creates or replaces the endpoint and rotates the secret. The plaintext secret is returned ONCE. */
export async function setEndpoint(merchantId: string, url: string): Promise<{ url: string; secret: string; secretLast4: string } | { refused: string }> {
  requireStorage();
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") return { refused: "Webhook URLs must use https." };
  const check = await checkUrl(url);
  if (!check.ok) return { refused: "That URL resolves to an address FurlPay will not call (private, local or unresolvable)." };
  const secret = `whsec_${randomBytes(24).toString("base64url")}`;
  await sbUpsert<Endpoint>("merchant_webhook_endpoints", {
    merchant_id: merchantId,
    url: parsed.toString(),
    secret_enc: sealWebhookSecret(secret, aad(merchantId)),
    secret_last4: secret.slice(-4),
    updated_at: new Date().toISOString(),
  });
  return { url: parsed.toString(), secret, secretLast4: secret.slice(-4) };
}

export async function deleteEndpoint(merchantId: string) {
  requireStorage();
  await sbDelete("merchant_webhook_endpoints", `merchant_id=eq.${encodeURIComponent(merchantId)}`);
}

export type Delivery = { id: string; delivered: boolean; reason?: string };

/** One delivery pass over due outbox events. Safe to run concurrently (claims use SKIP LOCKED + a lease). */
export async function deliverDue(limit = 20, transport: typeof pinnedFetch = pinnedFetch, now = () => Date.now()): Promise<Delivery[]> {
  requireStorage();
  const rows = await sbRpc<OutboxRow[]>("merchant_outbox_claim", { p_limit: limit, p_lease_seconds: LEASE_S, p_max_attempts: MAX_ATTEMPTS });
  const out: Delivery[] = [];
  for (const row of rows ?? []) {
    const result = await deliverOne(row, transport, now);
    out.push({ id: row.id, ...result });
    if (result.delivered) {
      await sbUpdate("merchant_payment_outbox", `id=eq.${row.id}&delivered_at=is.null`, { delivered_at: new Date(now()).toISOString(), last_error: null });
    } else {
      // attempts was already incremented by the claim.
      const wait = BACKOFF_S[Math.min(row.attempts - 1, BACKOFF_S.length - 1)];
      await sbUpdate("merchant_payment_outbox", `id=eq.${row.id}&delivered_at=is.null`, { last_error: result.reason ?? "failed", next_attempt_at: new Date(now() + wait * 1000).toISOString() });
    }
  }
  return out;
}

export async function deliverOne(row: OutboxRow, transport: typeof pinnedFetch, now: () => number): Promise<{ delivered: boolean; reason?: string }> {
  const [endpoint] = await sbSelect<Endpoint>("merchant_webhook_endpoints", `merchant_id=eq.${encodeURIComponent(row.merchant_id)}&limit=1`);
  if (!endpoint) return { delivered: false, reason: "no_endpoint" };
  let secret: string | null;
  try {
    secret = openSealedWebhookSecret(endpoint.secret_enc, aad(row.merchant_id));
  } catch {
    return { delivered: false, reason: "secret_unreadable" };
  }
  if (!secret) return { delivered: false, reason: "secret_unreadable" };
  const url = new URL(endpoint.url);
  if (url.protocol !== "https:") return { delivered: false, reason: "https_required" };
  const check = await checkUrl(endpoint.url);
  if (!check.ok || !check.address) return { delivered: false, reason: check.reason ?? "url_refused" };
  const body = JSON.stringify({ id: row.id, type: row.type, created: row.created_at, data: row.payload });
  try {
    const res = await transport(url, check.address, {
      method: "POST",
      body,
      timeoutMs: 5_000,
      headers: {
        "content-type": "application/json",
        "content-length": String(Buffer.byteLength(body)),
        "user-agent": "FurlPay-Webhooks/1",
        "x-furlpay-event-id": row.id,
        "x-furlpay-attempt": String(row.attempts),
        "x-furlpay-signature": signPartnerPayload(secret, body, Math.floor(now() / 1000)),
      },
    });
    await res.body?.cancel().catch(() => {});
    return res.status >= 200 && res.status < 300 ? { delivered: true } : { delivered: false, reason: `http_${res.status}` };
  } catch (e) {
    return { delivered: false, reason: (e as Error).name === "TimeoutError" ? "timeout" : "transport_error" };
  }
}
