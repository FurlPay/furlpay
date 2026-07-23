import { EVM_CHAIN_IDS } from "@/lib/x402Signature";

// ---------------------------------------------------------------------------
// EIP-7702 delegation + Circle Paymaster — "pay gas in USDC from a plain EOA".
//
// HOW THIS DIFFERS FROM /api/transfers/gasless, AND WHY BOTH EXIST.
//
// The existing gasless rail is EIP-3009 `transferWithAuthorization` relayed by
// FurlPay's fee-payer, which ABSORBS the gas (`GASLESS_FEE_USD = 0`, "~$0.01 L2
// gas absorbed"). That is excellent onboarding and a cost FurlPay carries on
// every transfer, and it only ever moves USDC — the authorization signs one
// transfer and nothing else.
//
// EIP-7702 inverts the payer and widens the scope. Post-Pectra an EOA can
// delegate to a smart-account implementation for the duration of a transaction,
// which makes it ERC-4337 capable without deploying a contract account per
// user. Circle Paymaster then sponsors gas and takes USDC from the user, so:
//
//   - the USER pays gas, in USDC — the model does not get more expensive as
//     volume grows, unlike absorbing L2 gas per transfer
//   - ARBITRARY calls become gasless-feeling, not just EIP-3009 transfers
//   - no smart-account deployment step, so no per-user onboarding cost
//
// Neither replaces the other. Sponsored EIP-3009 stays the right first-transfer
// experience; this is the sustainable path for everything after it.
//
// WHAT THIS MODULE IS. Construction and validation only — the parts that are
// decidable without a chain. It builds the authorization tuple a client signs,
// checks a delegation is safe to accept, and quotes gas in USDC. It does NOT
// submit UserOperations: that needs a bundler URL, a Paymaster address and a
// funded account, none of which exist in this deployment. `sponsorshipAvailable`
// reports that honestly rather than letting a caller assume a live path.
//
// SECURITY POSTURE. An EIP-7702 authorization is the most dangerous signature a
// user can produce: it points their EOA at code that can move everything they
// hold. Every check below exists because signing the wrong one is unrecoverable
// — there is no "undo" for an account that has already been drained.
// ---------------------------------------------------------------------------

/** Chains where we are willing to accept a 7702 delegation at all. */
export const SUPPORTED_7702_NETWORKS = ["arbitrum", "base", "ethereum"] as const;
export type Supported7702Network = (typeof SUPPORTED_7702_NETWORKS)[number];

/**
 * Delegate implementations we will accept, per network.
 *
 * An ALLOWLIST, not a validation rule. A syntactically valid address is not a
 * safe delegate: the whole risk of 7702 is that the user's EOA executes THAT
 * contract's code with THAT account's full authority. Accepting an
 * attacker-supplied address would be a signing oracle for account drainage, so
 * an unknown delegate is refused even though it is perfectly well-formed.
 *
 * Empty until the addresses are verified on-chain for each network. Empty means
 * every delegation is refused, which is the correct default: this fails closed
 * rather than trusting whatever a client sends.
 */
export const ALLOWED_DELEGATES: Record<Supported7702Network, readonly string[]> = {
  arbitrum: [],
  base: [],
  ethereum: [],
};

/** The zero address, which revokes a delegation (EIP-7702 §"clearing"). */
export const REVOCATION_DELEGATE = "0x0000000000000000000000000000000000000000";

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export interface AuthorizationTuple {
  chainId: number;
  /** Implementation the EOA delegates to. Zero address revokes. */
  address: string;
  /** The EOA's next nonce. Binds the authorization to one account state. */
  nonce: number;
}

export type DelegationRejection =
  | "unsupported_network"
  | "malformed_address"
  | "chain_id_mismatch"
  | "invalid_nonce"
  | "delegate_not_allowed"
  | "sponsorship_unavailable";

export interface DelegationCheck {
  ok: boolean;
  reason?: DelegationRejection;
  /** True when this authorization REVOKES rather than establishes delegation. */
  revoking?: boolean;
}

/**
 * Is this authorization safe to accept?
 *
 * A revocation (delegate == zero address) is always allowed. Refusing to help a
 * user un-delegate would be indefensible: it is the one action that can only
 * ever reduce their exposure, and a user trying to escape a bad delegation must
 * never be blocked by an allowlist that has not been populated yet.
 */
export function checkDelegation(
  auth: AuthorizationTuple,
  network: string
): DelegationCheck {
  if (!SUPPORTED_7702_NETWORKS.includes(network as Supported7702Network)) {
    return { ok: false, reason: "unsupported_network" };
  }
  const net = network as Supported7702Network;

  if (typeof auth.address !== "string" || !ADDRESS_RE.test(auth.address)) {
    return { ok: false, reason: "malformed_address" };
  }

  // chainId 0 is EIP-7702's "valid on every chain" wildcard. We refuse it: a
  // signature that authorises delegation everywhere is replayable onto any
  // chain the user holds funds on, which turns one careless signature into
  // total loss. Bind to exactly one chain.
  const expected = EVM_CHAIN_IDS[net];
  if (expected === undefined || auth.chainId !== expected) {
    return { ok: false, reason: "chain_id_mismatch" };
  }

  if (!Number.isInteger(auth.nonce) || auth.nonce < 0) {
    return { ok: false, reason: "invalid_nonce" };
  }

  if (auth.address.toLowerCase() === REVOCATION_DELEGATE) {
    return { ok: true, revoking: true };
  }

  const allowed = ALLOWED_DELEGATES[net].some(
    (a) => a.toLowerCase() === auth.address.toLowerCase()
  );
  if (!allowed) return { ok: false, reason: "delegate_not_allowed" };

  return { ok: true, revoking: false };
}

// ── Circle Paymaster ───────────────────────────────────────────────────────

/** Per-network Paymaster address, from the environment. Absent → unavailable. */
function paymasterAddress(network: Supported7702Network): string | undefined {
  const value = process.env[`CIRCLE_PAYMASTER_ADDRESS_${network.toUpperCase()}`];
  return value && ADDRESS_RE.test(value) ? value : undefined;
}

function bundlerUrl(network: Supported7702Network): string | undefined {
  return process.env[`ERC4337_BUNDLER_URL_${network.toUpperCase()}`] || undefined;
}

export interface SponsorshipAvailability {
  available: boolean;
  network: string;
  /** Why it is unavailable — surfaced so a misconfiguration is diagnosable. */
  missing: string[];
}

/**
 * Can this deployment actually sponsor a UserOperation on `network`?
 *
 * Reported rather than assumed. The failure mode this prevents is a client
 * rendering "pay gas in USDC", collecting a 7702 signature — the most dangerous
 * signature a user can produce — and only then discovering there is no bundler
 * to submit it to. Ask first, sign second.
 */
export function sponsorshipAvailable(network: string): SponsorshipAvailability {
  if (!SUPPORTED_7702_NETWORKS.includes(network as Supported7702Network)) {
    return { available: false, network, missing: ["unsupported_network"] };
  }
  const net = network as Supported7702Network;
  const missing: string[] = [];
  if (!paymasterAddress(net)) missing.push(`CIRCLE_PAYMASTER_ADDRESS_${net.toUpperCase()}`);
  if (!bundlerUrl(net)) missing.push(`ERC4337_BUNDLER_URL_${net.toUpperCase()}`);
  if (ALLOWED_DELEGATES[net].length === 0) missing.push("allowed_delegate_implementations");
  return { available: missing.length === 0, network, missing };
}

export interface UsdcGasQuote {
  network: string;
  /** Gas cost in USDC minor units (6dp). Integer — never a float. */
  maxCostUsdcAtomic: string;
  maxCostUsdc: number;
  /** The headroom applied over the estimate. */
  bufferPct: number;
  /** Where the estimate came from, so a caller can tell a real quote from a floor. */
  basis: "estimated" | "unavailable";
}

/** USDC has 6 decimals on every chain Circle issues it on. */
const USDC_DECIMALS = 6;

/**
 * Quote gas in USDC for a UserOperation.
 *
 * Rounds UP, always. A quote that is a fraction of a cent short leaves the
 * Paymaster underpaid and the operation rejected after the user has already
 * signed — the same asymmetry `AdaptivePricer` handles in x402-guard, and the
 * same resolution: the party that can absorb a rounding error should, and that
 * is never the user's failed transaction.
 */
export function quoteGasInUsdc(input: {
  network: string;
  /** Total gas units the operation is expected to consume. */
  gasUnits: bigint;
  /** Gas price in wei. */
  gasPriceWei: bigint;
  /** Native token price in USD (e.g. ETH/USD). */
  nativeUsdPrice: number;
  /** Headroom over the estimate. Default 20%. */
  bufferPct?: number;
}): UsdcGasQuote {
  const { network, gasUnits, gasPriceWei, nativeUsdPrice } = input;
  const bufferPct = input.bufferPct ?? 20;

  if (gasUnits <= 0n || gasPriceWei <= 0n || !(nativeUsdPrice > 0)) {
    return {
      network,
      maxCostUsdcAtomic: "0",
      maxCostUsdc: 0,
      bufferPct,
      basis: "unavailable",
    };
  }

  // wei -> USD -> USDC atomic, in integer arithmetic. Scale the float price by
  // 1e6 first so the whole computation stays in bigint: doing it in floats
  // loses precision at exactly the magnitudes that matter for L2 gas.
  const weiTotal = gasUnits * gasPriceWei;
  const priceScaled = BigInt(Math.round(nativeUsdPrice * 1e6));
  const WEI_PER_ETH = 10n ** 18n;
  const usdcScale = 10n ** BigInt(USDC_DECIMALS);

  // (wei * usdPrice_scaled * 1e6) / (1e18 * 1e6) — the 1e6 factors cancel, so
  // this is (wei * priceScaled) / 1e18, already in USDC atomic units.
  const base = (weiTotal * priceScaled) / WEI_PER_ETH;
  const withBuffer = (base * BigInt(100 + bufferPct)) / 100n;
  // Round up to the next atomic unit: never quote below true cost.
  const atomic = withBuffer === 0n ? 1n : withBuffer;

  return {
    network,
    maxCostUsdcAtomic: atomic.toString(),
    maxCostUsdc: Number(atomic) / Number(usdcScale),
    bufferPct,
    basis: "estimated",
  };
}

export interface SponsoredCapability {
  scheme: "eip7702-circle-paymaster";
  networks: Supported7702Network[];
  availability: SponsorshipAvailability[];
  /** True when at least one network can actually sponsor today. */
  anyAvailable: boolean;
  asset: { symbol: "USDC"; decimals: number };
  detail: string;
}

/** The capability document behind the public quote endpoint. */
export function sponsoredCapability(): SponsoredCapability {
  const availability = SUPPORTED_7702_NETWORKS.map((n) => sponsorshipAvailable(n));
  return {
    scheme: "eip7702-circle-paymaster",
    networks: [...SUPPORTED_7702_NETWORKS],
    availability,
    anyAvailable: availability.some((a) => a.available),
    asset: { symbol: "USDC", decimals: USDC_DECIMALS },
    detail:
      "Delegate an EOA via EIP-7702 and pay gas in USDC through Circle Paymaster. " +
      "No smart-account deployment. Requires a configured Paymaster, bundler and " +
      "an allowlisted delegate implementation per network.",
  };
}
