import { type Asset, assetById } from "@/lib/money/money";

// ---------------------------------------------------------------------------
// The stablecoin registry.
//
// WHY THIS EXISTS, AND WHY NOW. The asset layer is contested and moving: a
// bank- and network-backed consortium stablecoin is launching, a card network
// has bought a stablecoin payments platform outright, and the incumbent
// dollar-token's economics are under direct attack. Any architecture that
// hardcodes one stablecoin is betting the company on which token wins that
// fight. FurlPay should not take that bet.
//
// So the rule is: THE ASSET IS A PARAMETER. Nothing above this module may
// assume which stablecoin it is holding, and nothing may assume there is only
// one. Adding an asset is a row here.
//
// THE THREE THINGS `swap.ts` GOT WRONG, which this replaces:
//
//   1. `USDC: 1.0`. A stablecoin is not worth a dollar; it is worth what it is
//      worth. A regulated, fully-reserved token has depegged before under
//      counterparty stress, and a system that prices it at par by definition
//      cannot represent the event it most needs to survive. Price comes from a
//      quote with a source and a timestamp — see `PegStatus`.
//
//   2. A flat chain list per symbol. "USDC on Solana" and "USDC on Arbitrum"
//      are different instruments with different issuers of record, and a
//      BRIDGED representation is a claim on a bridge, not on the issuer.
//      Conflating them is how a treasury believes it holds issuer-redeemable
//      dollars and actually holds a bridge IOU.
//
//   3. No freeze awareness. The major fiat-backed tokens can freeze balances
//      at an address on issuer instruction. That is a real operational state,
//      not a theoretical one, and a payout engine that cannot represent it
//      will keep retrying a transfer that can never succeed.
//
// WHAT THIS MODULE DOES NOT DO. It does not fetch prices, call an issuer API,
// or check a blacklist on-chain. Those need a price oracle and an RPC, and
// inventing either would be exactly the fabricated integration this codebase
// keeps removing. It defines the shape, the policy and the refusals.
// ---------------------------------------------------------------------------

/** How the token's value is meant to be maintained. Drives risk, not price. */
export type ReserveModel =
  /** Cash and short-duration government paper held by a regulated issuer. */
  | "fiat_reserved"
  /** Over-collateralised by on-chain assets. */
  | "crypto_collateralised"
  /** Yield-bearing reserves whose income accrues to holders or partners. */
  | "yield_sharing"
  /** No reserve; value maintained by protocol mechanics. */
  | "algorithmic"
  /** We have not established the model. Treated as the riskiest. */
  | "unknown";

/** Whether this deployment is the issuer's own, or a bridge's representation. */
export type Representation =
  /** Minted and redeemed by the issuer on this chain. A claim on the issuer. */
  | "canonical"
  /** Minted by a bridge against a lock on another chain. A claim on the bridge. */
  | "bridged";

export interface StablecoinDeployment {
  /** Asset id from lib/money/money.ts — carries the settlement domain. */
  readonly assetId: string;
  readonly chain: string;
  readonly contractAddress: string;
  readonly representation: Representation;
  /**
   * Where the address came from.
   *
   * Required, and required to be the ISSUER's own publication. A token address
   * taken from a blog or an aggregator is how a treasury sends real money to a
   * lookalike contract, and the error is unrecoverable.
   */
  readonly addressSource: string;
  /** ISO date a human last checked the address against that source. */
  readonly verifiedAt: string;
}

export interface Stablecoin {
  /** Symbol as the issuer publishes it. Not unique across chains — use assetId. */
  readonly symbol: string;
  readonly issuer: string;
  /** The fiat the token targets. Never assume USD. */
  readonly pegCurrency: string;
  readonly reserveModel: ReserveModel;
  /**
   * Can the issuer freeze or blacklist a holder's balance?
   *
   * True for the major fiat-backed tokens. Consequences we must model rather
   * than discover: a payout to a frozen address fails permanently and must not
   * be retried; and OUR OWN treasury address can be frozen, which is a
   * business-continuity event, not a transaction error.
   */
  readonly issuerCanFreeze: boolean;
  /** Can the issuer pause all transfers? A halted token cannot settle anything. */
  readonly issuerCanPause: boolean;
  readonly deployments: readonly StablecoinDeployment[];
  /**
   * Whether FurlPay has decided this asset may be used, and for what.
   *
   * Deliberately narrower than "is it a good token". `settlement` means we will
   * accept it as final value; `hold` means a customer may hold it but we will
   * not settle obligations in it; `none` means it is recognised so a deposit of
   * it can be identified and refused, rather than silently credited.
   */
  readonly acceptance: "settlement" | "hold" | "none";
  /** Why acceptance is what it is. Read by ops and by an auditor. */
  readonly acceptanceNote: string;
}

/**
 * The registry.
 *
 * Only assets whose contract addresses have been verified against the issuer's
 * own published list are present. Anything else would be an address nobody
 * checked, and this is the file where that error becomes a lost treasury.
 */
export const STABLECOINS: readonly Stablecoin[] = [
  {
    symbol: "USDC",
    issuer: "Circle",
    pegCurrency: "USD",
    reserveModel: "fiat_reserved",
    issuerCanFreeze: true,
    issuerCanPause: true,
    acceptance: "settlement",
    acceptanceNote:
      "Primary settlement asset. Canonical deployments only — a bridged representation is a claim " +
      "on a bridge and is not accepted for settlement.",
    deployments: [
      {
        assetId: "USDC.ethereum",
        chain: "ethereum",
        contractAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        representation: "canonical",
        addressSource: "https://developers.circle.com/stablecoins/usdc-contract-addresses",
        verifiedAt: "2026-09-06",
      },
      {
        assetId: "USDC.arbitrum",
        chain: "arbitrum",
        contractAddress: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
        representation: "canonical",
        addressSource: "https://developers.circle.com/stablecoins/usdc-contract-addresses",
        verifiedAt: "2026-09-06",
      },
      {
        assetId: "USDC.base",
        chain: "base",
        contractAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        representation: "canonical",
        addressSource: "https://developers.circle.com/stablecoins/usdc-contract-addresses",
        verifiedAt: "2026-09-06",
      },
      {
        assetId: "USDC.polygon",
        chain: "polygon",
        contractAddress: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
        representation: "canonical",
        addressSource: "https://developers.circle.com/stablecoins/usdc-contract-addresses",
        verifiedAt: "2026-09-06",
      },
    ],
  },
];

// ── Lookup ─────────────────────────────────────────────────────────────────

export function stablecoinForAsset(assetId: string): Stablecoin | undefined {
  return STABLECOINS.find((s) => s.deployments.some((d) => d.assetId === assetId));
}

export function deploymentForAsset(assetId: string): StablecoinDeployment | undefined {
  for (const coin of STABLECOINS) {
    const found = coin.deployments.find((d) => d.assetId === assetId);
    if (found) return found;
  }
  return undefined;
}

/** Every asset id we will settle in. The routing engine's candidate set. */
export function settlementAssets(): readonly string[] {
  return STABLECOINS.filter((s) => s.acceptance === "settlement")
    .flatMap((s) => s.deployments)
    .filter((d) => d.representation === "canonical")
    .map((d) => d.assetId);
}

// ── Peg status ─────────────────────────────────────────────────────────────

/**
 * Scale for a peg price: 1.000000 is `1_000_000` at 6 decimals.
 *
 * NOT the peg currency's own precision. USD has two decimals, which cannot
 * express 0.9985 — and that is exactly the band where drift lives, so quoting a
 * peg in cents would round every interesting observation to par. The instrument
 * being priced has six decimals; the price of it gets the same.
 */
export const PEG_PRICE_DECIMALS = 6;
export const PEG_PAR_MINOR = 10n ** BigInt(PEG_PRICE_DECIMALS);

/**
 * An observed price for a stablecoin against its peg.
 *
 * Carries its SOURCE and its AGE because both change what the number means. A
 * price is not a fact about the world; it is a fact about an observation, and a
 * five-minute-old quote during a depeg is worse than no quote.
 */
export interface PegQuote {
  readonly assetId: string;
  /** Price in the peg currency at PEG_PRICE_DECIMALS. Exact; never a float. */
  readonly priceMinor: bigint;
  readonly source: string;
  readonly observedAt: string;
}

/** Build a quote from a decimal string. Rejects anything too precise to hold. */
export function pegQuote(input: {
  assetId: string;
  price: string;
  source: string;
  observedAt: string;
}): PegQuote {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(input.price.trim());
  if (!match) throw new Error(`Not a peg price: "${input.price}"`);
  const [, whole, frac = ""] = match;
  if (frac.length > PEG_PRICE_DECIMALS) {
    throw new Error(
      `Peg price "${input.price}" has more than ${PEG_PRICE_DECIMALS} decimal places. ` +
        "Round explicitly rather than letting this function choose."
    );
  }
  return {
    assetId: input.assetId,
    priceMinor: BigInt(`${whole}${frac.padEnd(PEG_PRICE_DECIMALS, "0")}`),
    source: input.source,
    observedAt: input.observedAt,
  };
}

export type PegHealth = "at_peg" | "drifting" | "depegged" | "unknown";

/** Deviation from par, in basis points, that separates the bands. */
export const PEG_BANDS = {
  /** Within this, ordinary market noise. */
  driftBps: 50n, // 0.50%
  /** Beyond this, treat the asset as impaired and stop settling in it. */
  depegBps: 200n, // 2.00%
} as const;

/** How stale a quote may be before it stops being usable. */
export const PEG_QUOTE_MAX_AGE_MS = 120_000;

/**
 * Classify a quote.
 *
 * Returns `unknown` for an absent or stale quote — NOT `at_peg`. That default
 * is the whole point: an oracle outage during a depeg looks exactly like calm
 * markets if the fallback is par, and the fallback is when the answer matters
 * most. Callers must treat `unknown` as a refusal, not as permission.
 */
export function pegHealth(quote: PegQuote | null, now: number = Date.now()): PegHealth {
  if (!quote) return "unknown";

  const observedAt = Date.parse(quote.observedAt);
  if (!Number.isFinite(observedAt)) return "unknown";
  if (now - observedAt > PEG_QUOTE_MAX_AGE_MS) return "unknown";

  const diff =
    quote.priceMinor > PEG_PAR_MINOR
      ? quote.priceMinor - PEG_PAR_MINOR
      : PEG_PAR_MINOR - quote.priceMinor;
  const bps = (diff * 10_000n) / PEG_PAR_MINOR;

  if (bps > PEG_BANDS.depegBps) return "depegged";
  if (bps > PEG_BANDS.driftBps) return "drifting";
  return "at_peg";
}

// ── Settlement eligibility ─────────────────────────────────────────────────

export type AssetRefusal =
  | "unknown_asset"
  | "not_in_registry"
  | "not_accepted_for_settlement"
  | "bridged_representation"
  | "peg_unknown"
  | "depegged"
  | "issuer_frozen"
  | "issuer_paused";

export interface AssetDecision {
  readonly allowed: boolean;
  readonly reasons: readonly AssetRefusal[];
  readonly asset?: Asset;
  readonly stablecoin?: Stablecoin;
}

/**
 * May FurlPay settle an obligation in this asset, right now?
 *
 * Every refusal below corresponds to a way real money has been lost in this
 * industry: settling in a bridge IOU, settling at par during a depeg, or
 * retrying forever into a frozen address.
 *
 * `drifting` is deliberately ALLOWED. A 50-200bp deviation is a pricing
 * problem, handled by quoting the real rate, not a solvency problem — halting
 * settlement on ordinary market noise would make the system unusable and would
 * train operators to raise the threshold until it never fires.
 */
export function canSettleIn(
  assetId: string,
  quote: PegQuote | null,
  state: { issuerFrozen?: boolean; issuerPaused?: boolean } = {}
): AssetDecision {
  const reasons: AssetRefusal[] = [];

  const asset = assetById(assetId);
  if (!asset) return { allowed: false, reasons: ["unknown_asset"] };

  const coin = stablecoinForAsset(assetId);
  const deployment = deploymentForAsset(assetId);
  if (!coin || !deployment) {
    return { allowed: false, reasons: ["not_in_registry"], asset };
  }

  if (coin.acceptance !== "settlement") reasons.push("not_accepted_for_settlement");
  if (deployment.representation === "bridged") reasons.push("bridged_representation");
  if (state.issuerFrozen) reasons.push("issuer_frozen");
  if (state.issuerPaused) reasons.push("issuer_paused");

  const health = pegHealth(quote);
  if (health === "unknown") reasons.push("peg_unknown");
  else if (health === "depegged") reasons.push("depegged");

  return { allowed: reasons.length === 0, reasons, asset, stablecoin: coin };
}

export class AssetNotSettleable extends Error {
  readonly assetId: string;
  readonly reasons: readonly AssetRefusal[];
  constructor(assetId: string, reasons: readonly AssetRefusal[]) {
    super(`Cannot settle in ${assetId}: ${reasons.join(", ")}.`);
    this.name = "AssetNotSettleable";
    this.assetId = assetId;
    this.reasons = reasons;
  }
}

/** Throwing variant for money paths. Call before committing to an asset. */
export function assertSettleable(
  assetId: string,
  quote: PegQuote | null,
  state: { issuerFrozen?: boolean; issuerPaused?: boolean } = {}
): void {
  const decision = canSettleIn(assetId, quote, state);
  if (!decision.allowed) throw new AssetNotSettleable(assetId, decision.reasons);
}

/**
 * Concentration across settlement assets, in basis points of the total.
 *
 * Single-asset exposure is the risk the 2026 market makes concrete: an issuer
 * freeze, a pause, a depeg or a redemption halt on one token takes the whole
 * treasury with it if that token is the whole treasury. Reported so a human can
 * set a policy; deliberately NOT enforced here, because the correct ceiling is
 * a treasury decision and hardcoding one would be a guess.
 */
export function assetConcentrationBps(
  balances: readonly { assetId: string; minor: bigint }[]
): Record<string, number> {
  const total = balances.reduce((sum, b) => sum + (b.minor > 0n ? b.minor : 0n), 0n);
  if (total === 0n) return {};

  const out: Record<string, number> = {};
  for (const balance of balances) {
    if (balance.minor <= 0n) continue;
    const coin = stablecoinForAsset(balance.assetId);
    const key = coin ? coin.symbol : balance.assetId;
    out[key] = (out[key] ?? 0) + Number((balance.minor * 10_000n) / total);
  }
  return out;
}
