import { z } from "zod";
import { log } from "@/lib/log";
import { bvnkApiConfig, bvnkMoneyMovementEnabled, type BvnkApiConfig } from "./config";
import { hawkHeaderFor } from "./hawk";
import { payout, problem, transfer, wallet, walletPage, type BvnkTransfer } from "./schemas";

// BVNK REST client. Every operation here is one BVNK documents
// (docs.bvnk.com, api-explorer/endpoints); none is inferred.
//
// RETRIES. Only reads are retried: GETs on a network error, 429 or 5xx, at most
// three attempts with exponential backoff and full jitter, honouring
// Retry-After. A POST is never retried here. BVNK's idempotency answers a
// repeated key with 400 "already exists", not the original response
// (api-overview/idempotency), so a resend after a lost response cannot recover
// the result; the caller records the request as UNKNOWN and reconciles it from
// the transfer's webhook or a GET, keyed by its own `reference`.
//
// MONEY. Creating a transfer and accepting or refreshing a quote are refused
// unless BVNK_MONEY_MOVEMENT_ENABLED=1, require an explicit UUID idempotency key
// from the caller (which must persist it), and are never sent from a webhook.

export class BvnkApiError extends Error {
  constructor(readonly httpStatus: number, readonly code: string | null, message: string, readonly retryable: boolean) {
    super(message);
    this.name = "BvnkApiError";
  }
}
/** The request may or may not have been executed by BVNK (timeout, dropped connection). */
export class BvnkOutcomeUnknown extends Error {}
export class BvnkMoneyMovementDisabled extends Error {
  constructor() { super("BVNK money movement is disabled (BVNK_MONEY_MOVEMENT_ENABLED is not 1)"); this.name = "BvnkMoneyMovementDisabled"; }
}

export type ClientDeps = { fetch?: typeof fetch; now?: () => number; sleep?: (ms: number) => Promise<void>; random?: () => number; env?: NodeJS.ProcessEnv };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 300;
const MAX_DELAY_MS = 5_000;

export function retryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/** Full-jitter backoff, capped; Retry-After (seconds) wins when present and sane. */
export function backoffMs(attempt: number, retryAfter: string | null, random: () => number): number {
  const ra = retryAfter !== null ? Number(retryAfter) : NaN;
  if (Number.isFinite(ra) && ra >= 0) return Math.min(ra * 1000, 30_000);
  return Math.floor(random() * Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** attempt));
}

async function call<T>(
  cfg: BvnkApiConfig,
  deps: Required<Pick<ClientDeps, "fetch" | "now" | "sleep" | "random">>,
  method: "GET" | "POST",
  path: string,
  schema: z.ZodType<T>,
  opts: { body?: unknown; headers?: Record<string, string> } = {},
): Promise<T> {
  const url = cfg.baseUrl + path;
  const attempts = method === "GET" ? MAX_ATTEMPTS : 1;
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    let res: Response;
    try {
      res = await deps.fetch(url, {
        method,
        headers: {
          Authorization: hawkHeaderFor({ id: cfg.authId, key: cfg.authKey }, method, url, deps.now()),
          Accept: "application/json",
          ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...opts.headers,
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      lastError = e;
      if (method !== "GET") throw new BvnkOutcomeUnknown(`BVNK ${method} ${path}: no response (${(e as Error).name})`);
      if (attempt + 1 < attempts) await deps.sleep(backoffMs(attempt, null, deps.random));
      continue;
    }
    const correlation = res.headers.get("x-request-id") ?? res.headers.get("x-correlation-id");
    if (res.ok) {
      const json = await res.json().catch(() => { throw new BvnkApiError(res.status, null, `BVNK ${method} ${path}: response is not JSON`, false); });
      const parsed = schema.safeParse(json);
      if (!parsed.success) throw new BvnkApiError(res.status, null, `BVNK ${method} ${path}: response does not match the documented contract (${parsed.error.issues[0]?.path.join(".")})`, false);
      return parsed.data;
    }
    const body = problem.safeParse(await res.json().catch(() => ({})));
    const code = body.success ? body.data.code ?? null : null;
    const retryable = retryableStatus(res.status);
    // Logged without the body's free text: BVNK error messages can echo beneficiary data.
    log.warn("bvnk request failed", { method, path: path.replace(/[0-9a-f-]{36}/gi, ":id"), status: res.status, code, correlation, attempt });
    lastError = new BvnkApiError(res.status, code, `BVNK ${method} ${path} failed with ${res.status}${code ? ` (${code})` : ""}`, retryable);
    if (method !== "GET" || !retryable || attempt + 1 >= attempts) throw lastError;
    await deps.sleep(backoffMs(attempt, res.headers.get("retry-after"), deps.random));
  }
  if (lastError instanceof BvnkApiError) throw lastError;
  throw new BvnkApiError(0, null, `BVNK ${method} ${path}: no response after ${attempts} attempts`, true);
}

const enc = encodeURIComponent;
const walletId = z.string().regex(/^[A-Za-z0-9:_-]{1,100}$/, "not a BVNK wallet id");
const uuid = z.string().regex(UUID, "not a UUID");

export type TransferRequest = {
  reference: string;
  originator: { walletId: string; currency: string; amount?: number };
  beneficiary: { walletId: string; currency: string; amount?: number };
  conversion?: { type: "QUOTE" | "AUTO_CONVERSION"; validityDuration?: "PT20S" | "PT60M" };
  metadata?: Record<string, string>;
};
const transferRequest = z.object({
  reference: z.string().min(1).max(100),
  originator: z.object({ walletId, currency: z.string().min(3).max(12), amount: z.number().positive().finite().optional() }).strict(),
  beneficiary: z.object({ walletId, currency: z.string().min(3).max(12), amount: z.number().positive().finite().optional() }).strict(),
  conversion: z.object({ type: z.enum(["QUOTE", "AUTO_CONVERSION"]), validityDuration: z.enum(["PT20S", "PT60M"]).optional() }).strict().optional(),
  metadata: z.record(z.string().max(500)).optional(),
}).strict().refine((t) => (t.originator.amount === undefined) !== (t.beneficiary.amount === undefined), "Give exactly one of originator.amount or beneficiary.amount");

export function bvnkClient(deps: ClientDeps = {}) {
  const d = {
    fetch: deps.fetch ?? fetch,
    now: deps.now ?? Date.now,
    sleep: deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms))),
    random: deps.random ?? Math.random,
  };
  const env = deps.env ?? process.env;
  const cfg = () => bvnkApiConfig(env);
  const money = () => { if (!bvnkMoneyMovementEnabled(env)) throw new BvnkMoneyMovementDisabled(); };

  return {
    // ── reads (retried) ──
    /** GET /ledger/v2/wallets — `q` is BVNK's Lucene filter (one currency or customerId value). */
    listWallets: async (p: { q?: string; pageNumber?: number; pageSize?: number } = {}) => {
      const size = Math.min(Math.max(p.pageSize ?? 50, 1), 100);
      const qs = new URLSearchParams({ pageNumber: String(Math.max(p.pageNumber ?? 0, 0)), pageSize: String(size), ...(p.q ? { q: p.q } : {}) });
      return call(cfg(), d, "GET", `/ledger/v2/wallets?${qs}`, walletPage);
    },
    /** GET /ledger/v2/wallets/{id} — includes the wallet's fiat payment instruments (virtual account). */
    getWallet: async (id: string) => call(cfg(), d, "GET", `/ledger/v2/wallets/${enc(walletId.parse(id))}`, wallet),
    /** GET /payment/v3/transfers/{transferId} */
    getTransfer: async (id: string) => call(cfg(), d, "GET", `/payment/v3/transfers/${enc(uuid.parse(id))}`, transfer),
    /** GET /payment/v2/payouts/{transactionId} */
    getPayout: async (id: string) => call(cfg(), d, "GET", `/payment/v2/payouts/${enc(uuid.parse(id))}`, payout),

    // ── estimate (no money moves; not retried) ──
    /** POST /payment/v3/transfers/dry-run — an estimate, never an executable quote. */
    transferDryRun: async (req: TransferRequest) => call(cfg(), d, "POST", "/payment/v3/transfers/dry-run", transfer, { body: transferRequest.parse(req) }),

    // ── money-moving (gated, idempotent, never retried) ──
    /** POST /payment/v3/transfers with the caller's persisted Idempotency-Key. */
    createTransfer: async (req: TransferRequest, idempotencyKey: string): Promise<BvnkTransfer> => {
      money();
      return call(cfg(), d, "POST", "/payment/v3/transfers", transfer, { body: transferRequest.parse(req), headers: { "Idempotency-Key": uuid.parse(idempotencyKey) } });
    },
    /**
     * POST /payment/v3/transfers/{id}/actions — ACCEPT_QUOTE requires the digest
     * of the quote being accepted, so a refreshed quote can never be accepted
     * with a stale digest. REFRESH_QUOTE issues a new quote.
     */
    acceptQuote: async (transferId: string, digest: string) => {
      money();
      if (!digest || digest.length > 1000) throw new BvnkApiError(0, null, "ACCEPT_QUOTE needs the quote digest", false);
      return call(cfg(), d, "POST", `/payment/v3/transfers/${enc(uuid.parse(transferId))}/actions`, transfer, { body: { type: "ACCEPT_QUOTE", digest } });
    },
    refreshQuote: async (transferId: string) => {
      money();
      return call(cfg(), d, "POST", `/payment/v3/transfers/${enc(uuid.parse(transferId))}/actions`, transfer, { body: { type: "REFRESH_QUOTE" } });
    },
  };
}

/** A quote can be accepted only while PENDING_QUOTE_ACCEPTANCE and before its expiry. */
export function quoteAcceptable(t: BvnkTransfer, now = Date.now()): { ok: true; digest: string } | { ok: false; reason: string } {
  if (t.status !== "PENDING_QUOTE_ACCEPTANCE") return { ok: false, reason: `transfer is ${t.status}` };
  const digest = t.conversion?.digest;
  if (!digest) return { ok: false, reason: "no quote digest" };
  const expires = Date.parse(t.conversion?.expiresAt ?? t.expiresAt ?? "");
  if (!Number.isFinite(expires)) return { ok: false, reason: "quote has no expiry" };
  if (expires <= now) return { ok: false, reason: "quote expired" };
  return { ok: true, digest };
}
