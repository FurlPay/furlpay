
// ---------------------------------------------------------------------------
// Circle's REAL CCTP V2 Fast Transfer fee, per corridor.
//
// WHAT THIS REPLACES. quoteCctp used to price Fast Transfer at a flat
// `amount * 0.0001` — a guessed 1 basis point — and buildBurnBundle set the
// on-chain `maxFee` ceiling to the same guess. Circle publishes the actual fee
// and it is neither flat nor 1bp. Measured 2026-09-17:
//
//   ethereum -> arbitrum   1.0 bps
//   arbitrum -> base       1.4 bps
//   base     -> arbitrum   1.3 bps
//   arbitrum -> ethereum   1.4 bps
//   polygon  -> base       0.0 bps   (free)
//
// Two consequences, one cosmetic and one not:
//
//   - The QUOTE was wrong on 4 of 6 sampled corridors, under-quoting by up to
//     40% and charging for a corridor that is actually free.
//   - The BURN was wrong in a way that breaks the product promise. `maxFee` is
//     the ceiling the payer authorises; Circle only grants Fast Transfer when
//     the ceiling covers the real fee. Submitting a 1bp ceiling into a 1.4bp
//     corridor does not fail loudly — it drops to the standard path, so the
//     user waits ~13-19 minutes having been quoted 20 seconds.
//
// FAILS CLOSED. If Iris is unreachable or answers something this module does
// not recognise, it THROWS. It never falls back to an assumed rate: a made-up
// fee is how the above happened in the first place, and a quote nobody can
// honour is worse than a quote that did not load. Callers surface the failure.
//
// Endpoint: GET /v2/burn/USDC/fees/{sourceDomain}/{destinationDomain}
//   -> [{ "finalityThreshold": 1000, "minimumFee": 1.4 },     // fast
//        { "finalityThreshold": 2000, "minimumFee": 0   }]    // standard
// `minimumFee` is in BASIS POINTS and may be fractional.
//
// Addressed by CCTP DOMAIN ID, not by our Chain union, so this module imports
// nothing from cctpExecution — which imports from here. Callers that hold a
// Chain resolve it through CCTP_DOMAINS themselves. Same reasoning as the
// x402Chains/x402Signature split.
// ---------------------------------------------------------------------------

const IRIS_API = process.env.CCTP_IRIS_API_URL || "https://iris-api.circle.com";

/** CCTP V2 finality thresholds. <=1000 is Fast, 2000 is hard finality. */
export const FAST_FINALITY_THRESHOLD = 1000;
export const STANDARD_FINALITY_THRESHOLD = 2000;

/**
 * How long a fetched fee stays usable. Circle moves these with corridor
 * conditions, not by the second, so a short cache keeps a burst of quotes from
 * hammering Iris while never serving a rate old enough to mislead. Deliberately
 * shorter than a typical quote's own validity window.
 */
const FEE_TTL_MS = 60_000;

export class CctpFeeUnavailableError extends Error {
  readonly corridor: string;
  constructor(corridor: string, cause: string) {
    super(
      `CCTP fee unavailable for ${corridor}: ${cause}. Refusing to quote — ` +
        `an assumed fee produces a route we cannot honour.`
    );
    this.name = "CctpFeeUnavailableError";
    this.corridor = corridor;
  }
}

export interface CctpFee {
  /** Fast Transfer fee in basis points. May be fractional, may be 0. */
  fastBps: number;
  /** Standard transfer fee in basis points. Circle publishes 0 today, but it
   *  is read rather than assumed — the same mistake twice is a choice. */
  standardBps: number;
  /** When this was read from Iris. */
  fetchedAt: number;
}

interface FeeRow {
  finalityThreshold?: number;
  minimumFee?: number;
}

const cache = new Map<string, CctpFee>();

/** Exposed for tests — a fee cached by a previous case must not leak forward. */
export function clearCctpFeeCache(): void {
  cache.clear();
}

function corridorKey(source: number, destination: number): string {
  return `${source}->${destination}`;
}

/**
 * Circle's published fee for one corridor, by CCTP domain id.
 *
 * Throws `CctpFeeUnavailableError` rather than guessing. That includes the case
 * where Iris answers 200 with a body that has no Fast row: "I could not read
 * the fee" and "the fee is zero" must never collapse into the same value.
 */
export async function fetchCctpFee(
  sourceDomain: number,
  destinationDomain: number,
  opts: { signal?: AbortSignal } = {}
): Promise<CctpFee> {
  const key = corridorKey(sourceDomain, destinationDomain);

  const hit = cache.get(key);
  if (hit && Date.now() - hit.fetchedAt < FEE_TTL_MS) return hit;

  const url = `${IRIS_API}/v2/burn/USDC/fees/${sourceDomain}/${destinationDomain}`;

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: opts.signal,
    });
  } catch (e) {
    throw new CctpFeeUnavailableError(key, `iris unreachable (${(e as Error).message})`);
  }

  if (!res.ok) throw new CctpFeeUnavailableError(key, `iris responded ${res.status}`);

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new CctpFeeUnavailableError(key, "iris returned a non-JSON body");
  }

  if (!Array.isArray(body)) throw new CctpFeeUnavailableError(key, "iris returned an unexpected shape");

  const rows = body as FeeRow[];
  const fast = rows.find((r) => r.finalityThreshold === FAST_FINALITY_THRESHOLD);
  const standard = rows.find((r) => r.finalityThreshold === STANDARD_FINALITY_THRESHOLD);

  // A missing row is NOT a free transfer. Refuse instead of inventing a zero.
  if (!fast || typeof fast.minimumFee !== "number" || !Number.isFinite(fast.minimumFee)) {
    throw new CctpFeeUnavailableError(key, `no usable fast-transfer row (threshold ${FAST_FINALITY_THRESHOLD})`);
  }
  if (!standard || typeof standard.minimumFee !== "number" || !Number.isFinite(standard.minimumFee)) {
    throw new CctpFeeUnavailableError(key, `no usable standard row (threshold ${STANDARD_FINALITY_THRESHOLD})`);
  }
  if (fast.minimumFee < 0 || standard.minimumFee < 0) {
    throw new CctpFeeUnavailableError(key, "iris returned a negative fee");
  }

  const fee: CctpFee = {
    fastBps: fast.minimumFee,
    standardBps: standard.minimumFee,
    fetchedAt: Date.now(),
  };
  cache.set(key, fee);
  return fee;
}

/**
 * Apply a basis-point rate to an atomic amount, rounding UP.
 *
 * Rounding up matters in both places this is used. As a quoted fee it never
 * promises the user a cheaper transfer than they will get; as an on-chain
 * `maxFee` ceiling it never authorises less than Circle requires, which is the
 * difference between a Fast Transfer and a silent 15-minute one.
 */
export function bpsToAtomic(amountAtomic: bigint, bps: number): bigint {
  if (bps <= 0) return 0n;
  // Scale by 1e6 first so a fractional bps like 1.4 survives integer maths.
  const scaled = BigInt(Math.round(bps * 1e6));
  const denominator = 10_000n * 1_000_000n;
  const product = amountAtomic * scaled;
  // Ceiling division on positive integers.
  return (product + denominator - 1n) / denominator;
}
