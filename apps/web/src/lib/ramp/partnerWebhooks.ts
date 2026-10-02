import { createHmac, randomUUID } from "crypto";
import { kvDel, kvGet, kvSet, kvZAdd, kvZRangeByScore, kvZRem } from "@/lib/kv";
import { checkUrl, pinnedFetch } from "@/lib/property/safeFetch";
import { getPartnerConfig, openWebhookSecret } from "./partnerConfig";
import { getRampOrder, type RampOrder } from "./rampOrder";

// ---------------------------------------------------------------------------
// Callback to a partner when one of its ramp orders changes state.
//
//   POST {webhookUrl}
//   Content-Type: application/json
//   X-FurlPay-Event-Id: <uuid>
//   X-FurlPay-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, `${t}.${body}`)>
//
// The timestamp is inside the signed string (Stripe's scheme) so a captured
// delivery cannot be replayed later: the partner rejects a stale `t`.
//
// SSRF. The URL is the partner's to choose, so it is resolved and checked
// against private, loopback, link-local and metadata ranges (safeFetch.ts),
// https only, and the socket is pinned to the address that was checked — a
// DNS answer cannot change between check and connect. Redirects are not
// followed.
//
// DELIVERY: one attempt inline (5 s), never blocking the provider webhook that
// caused it. A transport or non-2xx failure is queued (ramp:partner:retry) and
// retried by the ramp-maintenance cron at 1 min, 10 min, 1 h, 6 h — five
// attempts in all, each re-signed with a fresh timestamp and carrying
// X-FurlPay-Attempt. A retry is dropped if the order has moved on (the newer
// state has its own delivery). Configuration problems (no URL, no secret, a
// URL that resolves privately) are not retried. Partners should still read
// GET /api/ramp/orders/:id as the source of truth.
// ---------------------------------------------------------------------------

export interface PartnerEvent {
  event: "ramp.order.updated";
  eventId: string;
  occurredAt: string;
  orderId: string;
  status: RampOrder["status"];
  direction: RampOrder["direction"];
  fiatAmount: number | null;
  fiatCurrency: string | null;
  cryptoAsset: string;
  cryptoAmount: string | null;
  chain: string;
  txHash: string | null;
}

export function partnerEvent(order: RampOrder, now = new Date()): PartnerEvent {
  return {
    event: "ramp.order.updated",
    eventId: randomUUID(),
    occurredAt: now.toISOString(),
    orderId: order.orderId,
    status: order.status,
    direction: order.direction,
    fiatAmount: order.fiatAmountMinor ?? null,
    fiatCurrency: order.fiatCurrency ?? null,
    cryptoAsset: order.cryptoAsset,
    cryptoAmount: order.cryptoAmount ?? null,
    chain: order.chain,
    txHash: order.txHash ?? null,
  };
}

/** The signature header value. Exported so partners' verification can be tested against it. */
export function signPartnerPayload(secret: string, body: string, unixSeconds: number): string {
  const v1 = createHmac("sha256", secret).update(`${unixSeconds}.${body}`).digest("hex");
  return `t=${unixSeconds},v1=${v1}`;
}

export type DeliveryResult =
  | { delivered: true; status: number }
  | { delivered: false; reason: string };

/** Seconds to wait before attempt n+1, after attempt n (1-based) failed. */
export const RETRY_BACKOFF_S = [60, 600, 3_600, 21_600];
export const MAX_ATTEMPTS = RETRY_BACKOFF_S.length + 1;
const RETRY_INDEX = "ramp:partner:retry";
const retryKey = (member: string) => `ramp:partner:retry:${member}`;

interface QueuedRetry {
  orderId: string;
  status: RampOrder["status"];
  attempt: number; // the attempt number to make next
}

const RETRYABLE = (reason: string) => reason === "timeout" || reason === "transport_error" || reason.startsWith("http_");

export async function deliverPartnerWebhook(
  order: RampOrder,
  transport: typeof pinnedFetch = pinnedFetch,
  attempt = 1,
  now = Date.now()
): Promise<DeliveryResult> {
  if (!order.partnerId) return { delivered: false, reason: "not_a_partner_order" };
  const cfg = await getPartnerConfig(order.partnerId);
  if (!cfg.webhookUrl) return { delivered: false, reason: "no_webhook_configured" };

  let result: DeliveryResult;
  try {
    const secret = openWebhookSecret(cfg);
    if (!secret) return { delivered: false, reason: "no_signing_secret" };

    const url = new URL(cfg.webhookUrl);
    if (url.protocol !== "https:") return { delivered: false, reason: "https_required" };
    const check = await checkUrl(cfg.webhookUrl);
    if (!check.ok || !check.address) return { delivered: false, reason: check.reason ?? "url_refused" };

    const evt = partnerEvent(order);
    const body = JSON.stringify(evt);
    const res = await transport(url, check.address, {
      method: "POST",
      body,
      timeoutMs: 5_000,
      headers: {
        "content-type": "application/json",
        "content-length": String(Buffer.byteLength(body)),
        "user-agent": "FurlPay-Webhooks/1",
        "x-furlpay-event-id": evt.eventId,
        "x-furlpay-attempt": String(attempt),
        "x-furlpay-signature": signPartnerPayload(secret, body, Math.floor(Date.now() / 1000)),
      },
    });
    await res.body?.cancel().catch(() => {});
    result = res.status >= 200 && res.status < 300 ? { delivered: true, status: res.status } : { delivered: false, reason: `http_${res.status}` };
  } catch (e) {
    result = { delivered: false, reason: (e as Error).name === "TimeoutError" ? "timeout" : "transport_error" };
  }

  await kvSet(
    `ramp:partner:${order.partnerId}:lastDelivery`,
    { orderId: order.orderId, status: order.status, at: new Date().toISOString(), attempt, ...result },
    30 * 24 * 3600
  ).catch(() => {});

  if (!result.delivered && RETRYABLE(result.reason) && attempt < MAX_ATTEMPTS) {
    const member = `${order.orderId}:${order.status}`;
    const next: QueuedRetry = { orderId: order.orderId, status: order.status, attempt: attempt + 1 };
    await kvSet(retryKey(member), next, 2 * 24 * 3600);
    await kvZAdd(RETRY_INDEX, now + RETRY_BACKOFF_S[attempt - 1] * 1000, member);
  }
  return result;
}

export interface RetryRunResult {
  attempted: number;
  delivered: number;
  dropped: number;
}

/** Deliver every queued callback that is due. Called by the ramp-maintenance cron. */
export async function processPartnerRetries(
  now = Date.now(),
  limit = 100,
  transport: typeof pinnedFetch = pinnedFetch
): Promise<RetryRunResult> {
  const due = (await kvZRangeByScore(RETRY_INDEX, "-inf", now)).slice(0, limit);
  const out: RetryRunResult = { attempted: 0, delivered: 0, dropped: 0 };
  for (const member of due) {
    // Take the entry off the queue first: a failing attempt re-queues itself,
    // and two overlapping cron runs cannot both deliver it.
    if ((await kvZRem(RETRY_INDEX, [member])) === 0) continue;
    const queued = await kvGet<QueuedRetry>(retryKey(member));
    await kvDel(retryKey(member));
    const order = queued ? await getRampOrder(queued.orderId) : null;
    if (!queued || !order || order.status !== queued.status) {
      out.dropped++;
      continue;
    }
    out.attempted++;
    const r = await deliverPartnerWebhook(order, transport, queued.attempt, now);
    if (r.delivered) out.delivered++;
  }
  return out;
}
