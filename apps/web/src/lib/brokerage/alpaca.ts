// ---------------------------------------------------------------------------
// The Alpaca adapter.
//
// Verified against Alpaca's documented Trading API (2026): orders are created
// at POST /v2/orders with a caller-supplied `client_order_id`, read back by
// that id at GET /v2/orders:by_client_order_id, and their lifecycle is
// published as `accepted`, `pending_new`, `new`, `partial_fill`, `fill`,
// `canceled`, `rejected`, `expired` and several others. This file's whole job
// is to turn that vocabulary into the closed set in ./types.ts without ever
// guessing at a status it does not recognise.
//
// THE PART THAT PREVENTS DOUBLE ORDERS. `client_order_id` is Alpaca's
// idempotency mechanism: submitting a second order with an id already in use is
// refused with a 422. That refusal is the SUCCESS case for a retry — it proves
// the first attempt landed — so `placeOrder` catches it and reads the existing
// order back rather than surfacing an error. Without that branch, the safe
// outcome (provider protected us) is indistinguishable from a real failure, and
// a client that retries on error would keep retrying forever.
//
// AND THE PART THAT PREVENTS PHANTOM ORDERS. A timeout is not a failure. The
// request may have been received and executed, so it raises
// BrokerageIndeterminateError, which callers must resolve by READING state
// back — never by assuming nothing happened and trying again.
// ---------------------------------------------------------------------------

import {
  BrokerageIndeterminateError,
  BrokerageRejectedError,
  type BrokerageAccount,
  type BrokerageOrder,
  type BrokeragePosition,
  type BrokerageProvider,
  type BrokerageQuote,
  type OrderStatus,
  type OrderType,
  type PlaceOrderInput,
  type TimeInForce,
} from "./types";

const TIMEOUT_MS = 10_000;

/**
 * Alpaca's order statuses, mapped into ours.
 *
 * Anything absent maps to `unknown` — deliberately, and never to a nearby
 * guess. A status we have not seen before might mean the order is dead or that
 * it is still working; picking either one writes a fact we do not have.
 */
const STATUS_MAP: Record<string, OrderStatus> = {
  new: "accepted",
  accepted: "accepted",
  pending_new: "submitted",
  accepted_for_bidding: "accepted",
  partially_filled: "partially_filled",
  partial_fill: "partially_filled",
  filled: "filled",
  fill: "filled",
  done_for_day: "expired",
  canceled: "canceled",
  cancelled: "canceled",
  expired: "expired",
  rejected: "rejected",
  suspended: "accepted",
  pending_cancel: "pending_cancel",
  pending_replace: "accepted",
  // `replaced` is NOT terminal for the position — the replacement order carries
  // the exposure. Modelled as canceled because THIS order id will never fill.
  replaced: "canceled",
  stopped: "accepted",
  calculated: "accepted",
};

function mapStatus(raw: string | undefined): OrderStatus {
  if (!raw) return "unknown";
  return STATUS_MAP[raw.toLowerCase()] ?? "unknown";
}

/** Alpaca returns every number as a decimal STRING. `Number("")` is 0, which
 *  would silently turn "not reported" into "zero filled" — the exact confusion
 *  the nullable fields exist to prevent. */
function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

interface AlpacaOrderPayload {
  id?: string;
  client_order_id?: string;
  symbol?: string;
  side?: string;
  type?: string;
  order_type?: string;
  time_in_force?: string;
  status?: string;
  qty?: string | null;
  notional?: string | null;
  limit_price?: string | null;
  stop_price?: string | null;
  filled_qty?: string | null;
  filled_avg_price?: string | null;
  submitted_at?: string | null;
  filled_at?: string | null;
  canceled_at?: string | null;
  expired_at?: string | null;
  // Present on rejections in the events stream.
  reject_reason?: string | null;
}

function toOrder(p: AlpacaOrderPayload): BrokerageOrder {
  return {
    clientOrderId: p.client_order_id ?? "",
    providerOrderId: str(p.id),
    symbol: (p.symbol ?? "").toUpperCase(),
    side: p.side === "sell" ? "sell" : "buy",
    type: ((p.type ?? p.order_type ?? "market") as OrderType),
    timeInForce: ((p.time_in_force ?? "day") as TimeInForce),
    status: mapStatus(p.status),
    qty: num(p.qty),
    notional: num(p.notional),
    limitPrice: num(p.limit_price),
    stopPrice: num(p.stop_price),
    filledQty: num(p.filled_qty),
    filledAvgPrice: num(p.filled_avg_price),
    submittedAt: str(p.submitted_at),
    filledAt: str(p.filled_at),
    canceledAt: str(p.canceled_at),
    expiredAt: str(p.expired_at),
    rejectReason: str(p.reject_reason),
    raw: p,
  };
}

export interface AlpacaConfig {
  keyId: string;
  secretKey: string;
  /** Trading host. Paper and live are different hosts, never a flag on one. */
  baseUrl: string;
  dataUrl: string;
  /** Whether this configuration points at real money. */
  isLive: boolean;
}

/**
 * Read the adapter's configuration from the environment.
 *
 * Returns null when the credentials are absent, so the factory can choose a
 * simulator rather than constructing a client that will 401 on every call.
 *
 * THE HOST IS DERIVED FROM THE FLAG, NOT FROM A SEPARATE VARIABLE. Two
 * independent switches — "are we live" and "which host" — can disagree, and the
 * disagreement that matters is `BROKERAGE_LIVE=1` pointed at the paper host:
 * every fill would be simulated while the product reported real trading.
 */
export function alpacaConfigFromEnv(live: boolean): AlpacaConfig | null {
  const keyId = process.env.ALPACA_API_KEY_ID?.trim();
  const secretKey = process.env.ALPACA_API_SECRET_KEY?.trim();
  if (!keyId || !secretKey) return null;

  return {
    keyId,
    secretKey,
    baseUrl: live ? "https://api.alpaca.markets" : "https://paper-api.alpaca.markets",
    dataUrl: "https://data.alpaca.markets",
    isLive: live,
  };
}

export class AlpacaBrokerageProvider implements BrokerageProvider {
  readonly name = "alpaca";
  readonly isLive: boolean;
  private readonly config: AlpacaConfig;

  constructor(config: AlpacaConfig) {
    this.config = config;
    this.isLive = config.isLive;
  }

  private headers(): Record<string, string> {
    return {
      "APCA-API-KEY-ID": this.config.keyId,
      "APCA-API-SECRET-KEY": this.config.secretKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
  }

  /**
   * One request.
   *
   * `indeterminateFor` names the order whose fate becomes unknown if the
   * request does not complete. Passing it turns a network failure into
   * BrokerageIndeterminateError instead of a generic throw, which is what stops
   * a caller retrying a write that may already have executed.
   */
  private async request<T>(
    path: string,
    init: { method?: string; body?: unknown; base?: string; indeterminateFor?: string } = {}
  ): Promise<{ status: number; body: T | null; text: string }> {
    const base = init.base ?? this.config.baseUrl;
    let res: Response;
    try {
      res = await fetch(`${base}${path}`, {
        method: init.method ?? "GET",
        headers: this.headers(),
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : "network failure";
      if (init.indeterminateFor) {
        throw new BrokerageIndeterminateError(
          init.indeterminateFor,
          `Alpaca ${init.method ?? "GET"} ${path} did not complete (${message}). ` +
            "The order may or may not exist — read it back before retrying."
        );
      }
      throw new Error(`Alpaca ${path}: ${message}`);
    }

    const text = await res.text();
    let body: T | null = null;
    if (text) {
      try {
        body = JSON.parse(text) as T;
      } catch {
        body = null;
      }
    }

    // 5xx on a write is indeterminate too: the request reached Alpaca and we do
    // not know how far it got.
    if (res.status >= 500 && init.indeterminateFor) {
      throw new BrokerageIndeterminateError(
        init.indeterminateFor,
        `Alpaca returned ${res.status} for ${path}. The order state is unknown — read it back.`
      );
    }

    return { status: res.status, body, text };
  }

  async getAccount(): Promise<BrokerageAccount> {
    const { status, body, text } = await this.request<Record<string, unknown>>("/v2/account");
    if (status !== 200 || !body) {
      throw new BrokerageRejectedError(`Alpaca account read failed (${status})`, status);
    }
    const restrictions: string[] = [];
    if (body.trading_blocked === true) restrictions.push("trading_blocked");
    if (body.transfers_blocked === true) restrictions.push("transfers_blocked");
    if (body.account_blocked === true) restrictions.push("account_blocked");
    if (body.trade_suspended_by_user === true) restrictions.push("trade_suspended_by_user");
    void text;

    return {
      accountId: String(body.id ?? ""),
      status: String(body.status ?? "unknown"),
      buyingPower: num(body.buying_power),
      cash: num(body.cash),
      // Alpaca's settled cash field; absent on some account types, and null is
      // the honest answer when it is.
      settledCash: num(body.cash_withdrawable ?? body.settled_cash),
      currency: String(body.currency ?? "USD"),
      restrictions,
      tradingBlocked: body.trading_blocked === true || body.account_blocked === true,
      transfersBlocked: body.transfers_blocked === true || body.account_blocked === true,
    };
  }

  async getPositions(): Promise<BrokeragePosition[]> {
    const { status, body } = await this.request<Record<string, unknown>[]>("/v2/positions");
    if (status !== 200 || !Array.isArray(body)) {
      throw new BrokerageRejectedError(`Alpaca positions read failed (${status})`, status);
    }
    return body.map((p) => ({
      symbol: String(p.symbol ?? "").toUpperCase(),
      qty: num(p.qty) ?? 0,
      avgEntryPrice: num(p.avg_entry_price),
      marketValue: num(p.market_value),
      costBasis: num(p.cost_basis),
      unrealizedPl: num(p.unrealized_pl),
    }));
  }

  async getOrders(
    opts: { status?: "open" | "closed" | "all"; limit?: number; after?: string } = {}
  ): Promise<BrokerageOrder[]> {
    const q = new URLSearchParams({
      status: opts.status ?? "all",
      limit: String(Math.min(500, opts.limit ?? 100)),
      direction: "desc",
    });
    if (opts.after) q.set("after", opts.after);

    const { status, body } = await this.request<AlpacaOrderPayload[]>(`/v2/orders?${q}`);
    if (status !== 200 || !Array.isArray(body)) {
      throw new BrokerageRejectedError(`Alpaca orders read failed (${status})`, status);
    }
    return body.map(toOrder);
  }

  async getOrder(ref: { clientOrderId?: string; providerOrderId?: string }): Promise<BrokerageOrder | null> {
    const path = ref.providerOrderId
      ? `/v2/orders/${encodeURIComponent(ref.providerOrderId)}`
      : `/v2/orders:by_client_order_id?client_order_id=${encodeURIComponent(ref.clientOrderId ?? "")}`;

    const { status, body } = await this.request<AlpacaOrderPayload>(path);
    if (status === 404) return null;
    if (status !== 200 || !body) {
      // NOT null. Null means "this order does not exist", and a caller acting on
      // that would create a duplicate. An unreadable provider must throw.
      throw new BrokerageRejectedError(`Alpaca order read failed (${status})`, status);
    }
    return toOrder(body);
  }

  async placeOrder(input: PlaceOrderInput): Promise<BrokerageOrder> {
    if ((input.qty == null) === (input.notional == null)) {
      throw new BrokerageRejectedError("Provide exactly one of qty or notional", 400);
    }

    const payload: Record<string, unknown> = {
      symbol: input.symbol.toUpperCase(),
      side: input.side,
      type: input.type,
      time_in_force: input.timeInForce,
      client_order_id: input.clientOrderId,
    };
    if (input.qty != null) payload.qty = String(input.qty);
    if (input.notional != null) payload.notional = String(input.notional);
    if (input.limitPrice != null) payload.limit_price = String(input.limitPrice);
    if (input.stopPrice != null) payload.stop_price = String(input.stopPrice);
    if (input.extendedHours) payload.extended_hours = true;

    const { status, body, text } = await this.request<AlpacaOrderPayload & { message?: string }>("/v2/orders", {
      method: "POST",
      body: payload,
      indeterminateFor: input.clientOrderId,
    });

    if (status === 200 || status === 201) {
      if (!body) throw new BrokerageRejectedError("Alpaca accepted the order but returned no body", status);
      return toOrder(body);
    }

    // 422 with a duplicate-id complaint is the idempotency guard FIRING, which
    // means the first attempt succeeded. Read the real order back and return it
    // — surfacing an error here would make a protected retry look like a
    // failure and invite yet another attempt.
    if (status === 422 && /client_order_id|already exists|duplicate/i.test(text)) {
      const existing = await this.getOrder({ clientOrderId: input.clientOrderId });
      if (existing) return existing;
      throw new BrokerageIndeterminateError(
        input.clientOrderId,
        "Alpaca reported a duplicate client_order_id but the order could not be read back."
      );
    }

    throw new BrokerageRejectedError(
      body?.message ?? `Alpaca rejected the order (${status})`,
      status,
      str(body?.reject_reason)
    );
  }

  async cancelOrder(providerOrderId: string): Promise<void> {
    const { status } = await this.request(`/v2/orders/${encodeURIComponent(providerOrderId)}`, {
      method: "DELETE",
      indeterminateFor: providerOrderId,
    });
    // 404 is success-shaped: the order is not cancellable because it is already
    // gone, which is the state the caller asked for. 422 means it filled first
    // — also not an error to raise, but the caller must re-read, which it does.
    if (status !== 204 && status !== 200 && status !== 404 && status !== 422) {
      throw new BrokerageRejectedError(`Alpaca cancel failed (${status})`, status);
    }
  }

  async replaceOrder(
    providerOrderId: string,
    patch: { qty?: number; limitPrice?: number; stopPrice?: number; timeInForce?: TimeInForce }
  ): Promise<BrokerageOrder> {
    const payload: Record<string, unknown> = {};
    if (patch.qty != null) payload.qty = String(patch.qty);
    if (patch.limitPrice != null) payload.limit_price = String(patch.limitPrice);
    if (patch.stopPrice != null) payload.stop_price = String(patch.stopPrice);
    if (patch.timeInForce) payload.time_in_force = patch.timeInForce;

    const { status, body } = await this.request<AlpacaOrderPayload & { message?: string }>(
      `/v2/orders/${encodeURIComponent(providerOrderId)}`,
      { method: "PATCH", body: payload, indeterminateFor: providerOrderId }
    );
    if ((status === 200 || status === 201) && body) return toOrder(body);
    throw new BrokerageRejectedError(body?.message ?? `Alpaca replace failed (${status})`, status);
  }

  async getQuote(symbol: string): Promise<BrokerageQuote | null> {
    const { status, body } = await this.request<{
      quote?: { bp?: number; ap?: number; t?: string };
    }>(`/v2/stocks/${encodeURIComponent(symbol.toUpperCase())}/quotes/latest`, {
      base: this.config.dataUrl,
    });
    if (status !== 200 || !body?.quote) return null;
    const bid = num(body.quote.bp);
    const ask = num(body.quote.ap);
    return {
      symbol: symbol.toUpperCase(),
      bid,
      ask,
      // The mid, and only when BOTH sides exist. A one-sided book has no mid,
      // and halving a lone bid would invent a price nobody quoted.
      last: bid != null && ask != null ? (bid + ask) / 2 : null,
      timestamp: str(body.quote.t),
    };
  }
}
