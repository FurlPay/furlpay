import { createHmac, randomUUID } from "crypto";
import { kvSet } from "@/lib/kv";
import { checkUrl, pinnedFetch } from "@/lib/property/safeFetch";
import { getPartnerConfig, openWebhookSecret } from "./partnerConfig";
import type { RampOrder } from "./rampOrder";

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
// DELIVERY is best-effort, one attempt, 5 s. There is no retry queue yet, so
// the partner should also read GET /api/ramp/orders/:id; the last delivery
// result is kept for the partner's dashboard. A failed callback never fails
// the webhook that caused it.
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

export async function deliverPartnerWebhook(
  order: RampOrder,
  transport: typeof pinnedFetch = pinnedFetch
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
    { orderId: order.orderId, status: order.status, at: new Date().toISOString(), ...result },
    30 * 24 * 3600
  ).catch(() => {});
  return result;
}
