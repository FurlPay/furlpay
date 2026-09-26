import { api, ApiError } from "../api";
import type { ChainSlug } from "../evm/rpc";

// ---------------------------------------------------------------------------
// Circle CCTP V2 client.
//
// Talks to FurlPay's intent engine, which is non-custodial: it returns UNSIGNED
// calldata and this app signs it. Three legs:
//
//   1. burn         POST /api/intents/cctp   { action: "burn", ... }
//   2. attestation  GET  /api/intents/cctp/attestation?sourceDomain&txHash
//   3. mint         POST /api/intents/cctp   { action: "mint", message, attestation }
//
// THE SHAPES BELOW ARE READ FROM THE SERVER, NOT FROM A SPEC. A scoping doc for
// this work described the burn response as `{ approveTx, burnTx, feeUsd,
// etaSeconds, chainId }`. None of those five fields exist. The server returns
// `CctpBurnBundle` (apps/web/src/lib/services/cctpExecution.ts): an ORDERED
// `transactions` array, `feeAtomic` in 6-decimal USDC units, and no chain id or
// ETA at all. A client written to the doc would read `undefined` for every one
// of them and fail at signing time, so the types here mirror the server.
// ---------------------------------------------------------------------------

/** The corridors the server both quotes and executes (its `CCTP_DOMAINS`). */
export const CCTP_DOMAINS: Readonly<Partial<Record<ChainSlug, number>>> = {
  ethereum: 0,
  arbitrum: 3,
  base: 6,
  polygon: 7,
  arc: 26,
};

export type CctpChain = Extract<ChainSlug, "ethereum" | "arbitrum" | "base" | "polygon" | "arc">;

export function cctpDomainFor(chain: ChainSlug): number | undefined {
  return CCTP_DOMAINS[chain];
}

export function isCctpChain(chain: ChainSlug): chain is CctpChain {
  return CCTP_DOMAINS[chain] !== undefined;
}

/** One unsigned leg. `value` is the string "0" — these never carry native value. */
export interface CctpUnsignedTx {
  to: string;
  data: string;
  value: "0";
  /** Server-authored, safe to show: "Approve 100 USDC to TokenMessengerV2". */
  description: string;
}

/** Mirrors `CctpBurnBundle` on the server. */
export interface CctpBurnBundle {
  mode: "fast" | "standard";
  sourceChain: CctpChain;
  destinationChain: CctpChain;
  destinationDomain: number;
  /** 6-decimal USDC base units, as a string (never a float). */
  amountAtomic: string;
  /** Circle's expected take at the corridor's published rate, atomic. */
  feeAtomic: string;
  /** The published rate that produced `feeAtomic`, in basis points. */
  feeBps: number;
  /** Ceiling authorised on-chain: expected fee plus buffer. */
  maxFeeAtomic: string;
  /** SIGN AND SEND IN ORDER: [0] approve, [1] depositForBurn. */
  transactions: CctpUnsignedTx[];
  /** Server-built prefix; append the burn tx hash. */
  attestationPath: string;
}

export interface CctpAttestation {
  status: "pending" | "complete";
  message?: string;
  attestation?: string;
  eventNonce?: string;
}

/**
 * Why the server refused, in terms a screen can act on.
 *
 * The intent route has four distinct refusals that all arrive as non-2xx and
 * mean different things to a user mid-checkout. Collapsing them into "request
 * failed" would tell someone holding a $600 transfer to try again forever
 * against a $500 cap.
 */
export type CctpRefusal =
  /** Over FURLPAY_MAX_CCTP_USD (403). The amount must come down. */
  | { kind: "amount_over_limit"; detail: string }
  /** Ops paused the rail. Not the user's doing and not retryable by them. */
  | { kind: "rail_paused"; detail: string }
  /** Session expired (401). */
  | { kind: "unauthenticated"; detail: string }
  /** Too many prepares (429, 30/min/user). */
  | { kind: "rate_limited"; detail: string }
  /** Bad request the client should have caught — same chain, bad address. */
  | { kind: "invalid"; detail: string }
  | { kind: "unknown"; detail: string };

export class CctpError extends Error {
  readonly refusal: CctpRefusal;
  constructor(refusal: CctpRefusal) {
    super(refusal.detail);
    this.name = "CctpError";
    this.refusal = refusal;
  }
}

function classify(e: unknown): CctpError {
  if (!(e instanceof ApiError)) {
    return new CctpError({
      kind: "unknown",
      detail: e instanceof Error ? e.message : "Transfer could not be prepared.",
    });
  }
  const data = (e.data ?? {}) as { error?: string; detail?: string };
  const detail = data.detail || data.error || e.message;

  if (e.status === 401) return new CctpError({ kind: "unauthenticated", detail });
  if (e.status === 429) return new CctpError({ kind: "rate_limited", detail });
  if (e.status === 403) {
    // The route emits `error: "amount_over_limit"` for the cap. A different 403
    // is not the cap and must not be reported as one.
    if (data.error === "amount_over_limit") {
      return new CctpError({ kind: "amount_over_limit", detail });
    }
    return new CctpError({ kind: "unknown", detail });
  }
  if (e.status === 503) return new CctpError({ kind: "rail_paused", detail });
  if (e.status === 400) return new CctpError({ kind: "invalid", detail });
  return new CctpError({ kind: "unknown", detail });
}

export interface PrepareBurnParams {
  sourceChain: CctpChain;
  destinationChain: CctpChain;
  /** Whole USDC, e.g. 100.5. The server converts to atomic. */
  amount: number;
  recipient: string;
  /** Defaults to fast (server default is also true). */
  fast?: boolean;
}

/** Leg 1: ask for the unsigned approve + depositForBurn pair. */
export async function prepareCctpBurn(p: PrepareBurnParams): Promise<CctpBurnBundle> {
  // Checked here as well as server-side: it is the one refusal a client can
  // always prevent, and a round trip to be told so is wasted in a checkout.
  if (p.sourceChain === p.destinationChain) {
    throw new CctpError({
      kind: "invalid",
      detail: "Source and destination chains must differ.",
    });
  }
  if (!isCctpChain(p.sourceChain) || !isCctpChain(p.destinationChain)) {
    throw new CctpError({ kind: "invalid", detail: "Chain is not supported by CCTP." });
  }
  try {
    const res = await api<{ ok: true; bundle: CctpBurnBundle }>("/api/intents/cctp", {
      method: "POST",
      body: {
        action: "burn",
        sourceChain: p.sourceChain,
        destinationChain: p.destinationChain,
        amount: p.amount,
        recipient: p.recipient,
        fast: p.fast ?? true,
      },
    });
    return res.bundle;
  } catch (e) {
    throw classify(e);
  }
}

/** Leg 2, one poll. Callers drive the loop so they own cancellation. */
export async function fetchCctpAttestation(
  sourceDomain: number,
  txHash: string
): Promise<CctpAttestation> {
  try {
    return await api<CctpAttestation>(
      `/api/intents/cctp/attestation?sourceDomain=${sourceDomain}&txHash=${encodeURIComponent(txHash)}`
    );
  } catch (e) {
    throw classify(e);
  }
}

/** Leg 3: wrap a completed attestation into destination `receiveMessage`. */
export async function prepareCctpMint(
  message: string,
  attestation: string
): Promise<CctpUnsignedTx> {
  try {
    const res = await api<{ ok: true; transaction: CctpUnsignedTx }>("/api/intents/cctp", {
      method: "POST",
      body: { action: "mint", message, attestation },
    });
    return res.transaction;
  } catch (e) {
    throw classify(e);
  }
}

// ---------------------------------------------------------------------------
// Presentation helpers.
//
// USDC is 6 decimals and the server sends atomic STRINGS. Parsing those with
// Number() before dividing loses precision above 2^53 atomic units and, worse,
// reads as correct at every amount anyone tests by hand.
// ---------------------------------------------------------------------------

const USDC_DECIMALS = 6n;
const USDC_SCALE = 10n ** USDC_DECIMALS;

/** Atomic USDC string -> display string, e.g. "1400" -> "0.0014". */
export function formatUsdcAtomic(atomic: string, maxFractionDigits = 6): string {
  let v: bigint;
  try {
    v = BigInt(atomic);
  } catch {
    return "—";
  }
  const negative = v < 0n;
  if (negative) v = -v;

  const whole = v / USDC_SCALE;
  const frac = v % USDC_SCALE;
  let fracStr = frac.toString().padStart(Number(USDC_DECIMALS), "0").slice(0, maxFractionDigits);
  fracStr = fracStr.replace(/0+$/, "");

  const body = fracStr ? `${whole}.${fracStr}` : `${whole}`;
  return negative ? `-${body}` : body;
}

/**
 * What the transfer costs, straight from the quote.
 *
 * Returns the server's own numbers and nothing derived from a corridor table.
 * The published rate differs per corridor and is 0.0 bps on some of them, so a
 * hardcoded "~1.4bps" would be wrong for most transfers — and the server
 * deliberately refuses to quote at all rather than guess when Circle's fee
 * cannot be read.
 */
export function describeCctpFee(bundle: CctpBurnBundle): {
  feeUsdc: string;
  feeBps: number;
  free: boolean;
  maxFeeUsdc: string;
} {
  return {
    feeUsdc: formatUsdcAtomic(bundle.feeAtomic),
    feeBps: bundle.feeBps,
    free: BigInt(bundle.feeAtomic || "0") === 0n,
    maxFeeUsdc: formatUsdcAtomic(bundle.maxFeeAtomic),
  };
}

/** Build the attestation URL the bundle points at. */
export function attestationUrlFor(bundle: CctpBurnBundle, burnTxHash: string): string {
  return `${bundle.attestationPath}${burnTxHash}`;
}
