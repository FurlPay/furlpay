import { Chain, Token } from "../types";

// ---------------------------------------------------------------------------
// Cross-chain swap / bridge routing (Blueprint §4.1, Playbook Gap 2).
// LIVE: Li.Fi quote aggregation (li.quest /v1/quote) across Ethereum, Base,
//       Arbitrum, Polygon, Solana and Robinhood Chain (Arbitrum Orbit L2,
//       chain id 4663, mainnet 2026-07-01).
// MOCK: execution stays off-chain against the demo ledger, and quoting falls
//       back to a plausible best-route estimate when Li.Fi is unreachable or
//       the pair has no address mapping.
// ---------------------------------------------------------------------------

export interface SwapQuote {
  fromToken: Token;
  toToken: Token;
  fromChain: Chain;
  toChain: Chain;
  amountIn: number;
  amountOut: number;
  slippagePct: number;
  gasUsd: number;
  /** Aggregator + bridge fees baked into the rate, in USD. */
  feeUsd: number;
  route: string[];
  etaSeconds: number;
  /** "lifi" when priced by the live Li.Fi API, "mock" for the local estimate. */
  source: "lifi" | "mock";
}

// Reference USD prices: stables at peg, natives at demo marks. Drives the
// mock quote path and ledger USD values; live quotes price via Li.Fi.
const TOKEN_USD: Record<Token, number> = {
  USDC: 1.0,
  USDT: 1.0,
  PYUSD: 1.0,
  DAI: 1.0,
  EURC: 1.09,
  XSGD: 0.78, // SGD peg (MAS-regulated, StraitsX)
  XUSD: 1.0, // USD peg (StraitsX)
  SOL: 77.15,
  ETH: 1736.0,
};

export function usdPrice(token: Token): number {
  return TOKEN_USD[token];
}

/** Chains each token actually circulates on — the UI filters selectors with this. */
export const TOKEN_CHAINS: Record<Token, Chain[]> = {
  USDC: ["ethereum", "polygon", "base", "arbitrum", "solana", "gnosis", "robinhood", "bsc"],
  USDT: ["ethereum", "polygon", "arbitrum", "solana", "gnosis", "bsc"],
  EURC: ["ethereum", "base", "solana"],
  PYUSD: ["ethereum", "solana"],
  DAI: ["ethereum", "polygon", "base", "arbitrum", "gnosis"],
  // StraitsX also issues on Avalanche/Hedera/XRPL/Zilliqa — outside our Chain
  // union. XUSD's Solana mint is announced but unverified; add once confirmed.
  XSGD: ["ethereum", "polygon", "arbitrum", "solana"],
  XUSD: ["ethereum", "bsc"],
  SOL: ["solana"],
  ETH: ["ethereum", "base", "arbitrum", "robinhood"],
};

export function isTokenOnChain(token: Token, chain: Chain): boolean {
  return TOKEN_CHAINS[token]?.includes(chain) ?? false;
}

const CHEAPEST_CHAINS: Chain[] = ["solana", "base", "arbitrum"];

// ---------------------------------------------------------------------------
// Li.Fi wiring
// ---------------------------------------------------------------------------

const LIFI_API = process.env.LIFI_API_URL ?? "https://li.quest/v1";

/**
 * How long an execution plan stays signable.
 *
 * Ours to choose, because /v1/quote returns no expiry of its own (verified
 * against the live endpoint). Two minutes is long enough for a user to read a
 * confirmation, approve a token and sign, and short enough that the embedded
 * price and `toAmountMin` still reflect a market the user actually saw. An
 * expired plan is re-quoted, never stretched.
 *
 * A POLICY, not a security boundary — so it is configurable, and clamped rather
 * than trusted: a typo of 0 would make every route stale on arrival, and a very
 * long TTL would let someone sign calldata priced against a market that no
 * longer exists.
 */
const QUOTE_TTL_MS = clampTtl(Number(process.env.SWAP_QUOTE_TTL_MS));

function clampTtl(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 2 * 60 * 1000;
  return Math.min(Math.max(value, 30 * 1000), 10 * 60 * 1000);
}

/** A 20-byte hex address. The only address shape any of this accepts. */
function isAddress(value: unknown): value is string {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value);
}

// Li.Fi chain identifiers: numeric EVM chain ids, "SOL" key for Solana.
// Robinhood Chain mainnet is 4663 (chainlist.org/chain/4663).
const LIFI_CHAIN: Record<Chain, number | string> = {
  ethereum: 1,
  polygon: 137,
  base: 8453,
  arbitrum: 42161,
  solana: "SOL",
  gnosis: 100,
  robinhood: 4663,
  bsc: 56,
};

const EVM_NATIVE = "0x0000000000000000000000000000000000000000";
const SOL_NATIVE = "11111111111111111111111111111111";

// Canonical token addresses per chain, only for pairs we quote live. Unmapped
// combinations (EURC, PYUSD, gnosis stables, …) fall back to the mock path.
// StraitsX addresses verified on-chain 2026-07-09 (symbol + 6 decimals via
// eth_call / getTokenSupply) against straitsx.com + explorer listings.
const LIFI_TOKEN: Partial<Record<Chain, Partial<Record<Token, string>>>> = {
  ethereum: {
    ETH: EVM_NATIVE,
    USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    USDT: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
    DAI: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
    XSGD: "0x70e8dE73cE538DA2bEEd35d14187F6959a8ecA96",
    XUSD: "0xC08e7E23C235073C6807C2EFE7021304cb7c2815",
  },
  arbitrum: {
    ETH: EVM_NATIVE,
    USDC: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    USDT: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
    XSGD: "0xE333e7754a2DC1E020a162Ecab019254b9DaB653",
  },
  base: {
    ETH: EVM_NATIVE,
    USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  },
  polygon: {
    USDC: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
    USDT: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
    XSGD: "0xDC3326e71D45186F113a2F448984CA0e8D201995",
  },
  solana: {
    SOL: SOL_NATIVE,
    USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    USDT: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
    XSGD: "71S9cppWipeUEQDFngYwxjoxB6Sz1MUqX72byLsVYJqy",
  },
  robinhood: {
    ETH: EVM_NATIVE,
  },
};

const TOKEN_DECIMALS: Record<Token, number> = {
  USDC: 6,
  USDT: 6,
  EURC: 6,
  PYUSD: 6,
  DAI: 18,
  XSGD: 6,
  XUSD: 6,
  SOL: 9,
  ETH: 18,
};

// Quote-only calls still require from/to addresses; Li.Fi doesn't check
// balances for /quote, so any well-formed address of the right VM works.
const QUOTE_PLACEHOLDER_EVM = "0x1111111111111111111111111111111111111111";
const QUOTE_PLACEHOLDER_SOL = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

interface LifiQuoteResponse {
  tool?: string;
  toolDetails?: { name?: string };
  /** Li.Fi's route id — carried through for /v1/status and support tickets. */
  id?: string;
  transactionId?: string;
  /** What the route will actually do, as Li.Fi resolved it. */
  action?: {
    fromToken?: { address?: string; decimals?: number; symbol?: string };
    toToken?: { address?: string; decimals?: number; symbol?: string };
    fromAmount?: string;
    /** Fraction, not percent: 0.001 is 0.1%. */
    slippage?: number;
  };
  estimate?: {
    toAmount?: string;
    /** Enforced ON-CHAIN by the router — a route delivering less reverts. */
    toAmountMin?: string;
    /** Atomic units the route will PULL from the user — what to approve. */
    fromAmount?: string;
    executionDuration?: number;
    feeCosts?: { amountUsd?: string }[];
    gasCosts?: { amountUsd?: string }[];
    /** Contract the user must approve (ERC-20 sends) before transactionRequest. */
    approvalAddress?: string;
  };
  /** Ready-to-sign transaction for the route (EVM). Present when the quote
   *  was requested with the user's real fromAddress. */
  transactionRequest?: {
    to?: string;
    data?: string;
    value?: string;
    chainId?: number;
    gasLimit?: string;
    gasPrice?: string;
  };
}

function toBaseUnits(amount: number, decimals: number): string {
  return BigInt(Math.round(amount * 10 ** Math.min(decimals, 9)))
    .toString()
    .concat("0".repeat(Math.max(0, decimals - 9)));
}

function fromBaseUnits(raw: string, decimals: number): number {
  return Number(raw) / 10 ** decimals;
}

function crossVM(a: Chain, b: Chain): boolean {
  return (a === "solana") !== (b === "solana");
}

function defaultSlippagePct(fromChain: Chain, toChain: Chain): number {
  if (fromChain === toChain) return 0.05;
  return crossVM(fromChain, toChain) ? 0.5 : 0.1;
}

function buildLifiQs(params: {
  fromToken: Token;
  toToken: Token;
  fromChain: Chain;
  toChain: Chain;
  amountIn: number;
  slippagePct: number;
  fromAddress: string;
  toAddress: string;
}): URLSearchParams | null {
  const fromAddr = LIFI_TOKEN[params.fromChain]?.[params.fromToken];
  const toAddr = LIFI_TOKEN[params.toChain]?.[params.toToken];
  if (!fromAddr || !toAddr) return null;

  const qs = new URLSearchParams({
    fromChain: String(LIFI_CHAIN[params.fromChain]),
    toChain: String(LIFI_CHAIN[params.toChain]),
    fromToken: fromAddr,
    toToken: toAddr,
    fromAmount: toBaseUnits(params.amountIn, TOKEN_DECIMALS[params.fromToken]),
    fromAddress: params.fromAddress,
    toAddress: params.toAddress,
    slippage: String(params.slippagePct / 100),
  });
  // Integrator monetization (docs.li.fi/monetization-take-fees): `fee` is a
  // FRACTION of from-token volume (0.002 = 0.2%, max 0.10), deducted into
  // Li.Fi's FeeCollector for the `integrator` account. Requires the integrator
  // to be registered fee-enabled at portal.li.fi first — so both are env-gated
  // and quotes carry no fee until LIFI_FEE is explicitly set.
  qs.set("integrator", process.env.LIFI_INTEGRATOR || "furlpay");
  const lifiFee = Number(process.env.LIFI_FEE);
  if (Number.isFinite(lifiFee) && lifiFee > 0 && lifiFee <= 0.1) {
    qs.set("fee", String(lifiFee));
  }
  return qs;
}

async function lifiFetch(qs: URLSearchParams): Promise<LifiQuoteResponse | null> {
  try {
    const headers: Record<string, string> = { accept: "application/json" };
    if (process.env.LIFI_API_KEY) headers["x-lifi-api-key"] = process.env.LIFI_API_KEY;
    const res = await fetch(`${LIFI_API}/quote?${qs}`, {
      headers,
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    return (await res.json()) as LifiQuoteResponse;
  } catch {
    return null; // network error / timeout → caller falls back / errors
  }
}

async function fetchLifiQuote(params: {
  fromToken: Token;
  toToken: Token;
  fromChain: Chain;
  toChain: Chain;
  amountIn: number;
  slippagePct: number;
}): Promise<SwapQuote | null> {
  const { fromToken, toToken, fromChain, toChain, amountIn, slippagePct } = params;
  const qs = buildLifiQs({
    ...params,
    fromAddress: fromChain === "solana" ? QUOTE_PLACEHOLDER_SOL : QUOTE_PLACEHOLDER_EVM,
    toAddress: toChain === "solana" ? QUOTE_PLACEHOLDER_SOL : QUOTE_PLACEHOLDER_EVM,
  });
  if (!qs) return null;

  {
    const q = await lifiFetch(qs);
    if (!q) return null;
    const rawOut = q.estimate?.toAmount;
    if (!rawOut) return null;

    const sumUsd = (costs?: { amountUsd?: string }[]) =>
      (costs ?? []).reduce((s, c) => s + (Number(c.amountUsd) || 0), 0);
    const tool = q.toolDetails?.name ?? q.tool ?? "Li.Fi";

    return {
      fromToken,
      toToken,
      fromChain,
      toChain,
      amountIn,
      amountOut: fromBaseUnits(rawOut, TOKEN_DECIMALS[toToken]),
      slippagePct,
      gasUsd: round(sumUsd(q.estimate?.gasCosts), 4),
      feeUsd: round(sumUsd(q.estimate?.feeCosts), 2),
      route:
        fromChain === toChain
          ? [`${fromToken}→${toToken} via ${tool} on ${fromChain}`]
          : [`${fromToken} on ${fromChain}`, `${tool} bridge → ${toChain}`, `→ ${toToken}`],
      etaSeconds: q.estimate?.executionDuration ?? (fromChain === toChain ? 4 : 120),
      source: "lifi",
    };
  }
}

// ---------------------------------------------------------------------------
// Execution (non-custodial): a real-address quote whose transactionRequest
// the USER's wallet signs — FurlPay never holds keys (same convention as
// /api/intents/cctp and Earn). EVM-only: Solana routes need a VersionedTx
// signer flow and are refused here.
// ---------------------------------------------------------------------------

export interface SwapExecution {
  quote: SwapQuote;
  /** Contract to approve (ERC-20 sends) before submitting transactionRequest;
   *  null when no approval is needed (native token). */
  approvalAddress: string | null;
  /**
   * ERC-20 contract of the token being sold, and the exact atomic amount the
   * route will pull from the user. Both come from the QUOTE — there is no
   * fallback to a local table, because a fallback is a second source of truth
   * that goes stale the first time a chain migrates a token (Arbitrum's
   * USDC.e → native USDC), and approving the wrong contract fails in a way that
   * looks like a broken app rather than stale data.
   *
   * `null` ONLY for a native-token sell, where there is nothing to approve. An
   * ERC-20 route that cannot name its token is rejected, not defaulted.
   */
  fromTokenAddress: string | null;
  /** Atomic units to approve. Decimal string, not a Number — these exceed 2^53. */
  fromAmountAtomic: string | null;
  fromTokenDecimals: number | null;
  /**
   * Minimum the user receives after slippage, in atomic units of `toToken`.
   *
   * Li.Fi embeds this in the calldata and the router enforces it on-chain, so
   * it is a guarantee rather than a display value: a route that would deliver
   * less reverts. Surfaced so the UI can show the floor the user is actually
   * agreeing to instead of only the optimistic figure.
   */
  toAmountMin: string | null;
  /** Slippage tolerance the route was built with, as a fraction (0.001 = 0.1%). */
  slippage: number | null;
  /** Li.Fi's own route id, for /v1/status polling and support correlation. */
  routeId: string | null;
  /**
   * When this execution plan stops being safe to sign.
   *
   * STAMPED BY US, because Li.Fi's /v1/quote does not carry one — verified
   * against the live endpoint, whose top-level keys are type, id, tool,
   * toolDetails, action, estimate, includedSteps, integrator, transactionId and
   * transactionRequest, with no validUntil/expiresAt/deadline among them. (The
   * separate Intents API does return validUntil; this is not that endpoint.)
   *
   * So the freshness guarantee has to be ours. The calldata embeds a price and
   * a toAmountMin computed at build time; signing it ten minutes later asks the
   * router to honour a market that has moved, which at best reverts on
   * slippage and at worst executes at a rate the user never saw.
   */
  expiresAt: string;
  builtAt: string;
  /** Ready-to-sign route transaction from Li.Fi, for the user's wallet. */
  transactionRequest: {
    to: string;
    data: string;
    value: string;
    chainId: number;
    gasLimit?: string;
  };
}

export async function buildSwapExecution(params: {
  fromToken: Token;
  toToken: Token;
  fromChain: Chain;
  toChain?: Chain;
  amountIn: number;
  fromAddress: string;
  toAddress?: string;
}): Promise<{ ok: true; execution: SwapExecution } | { ok: false; error: string }> {
  const toChain =
    params.toChain ??
    CHEAPEST_CHAINS.find((c) => isTokenOnChain(params.toToken, c)) ??
    TOKEN_CHAINS[params.toToken][0];
  if (params.fromChain === "solana" || toChain === "solana") {
    return { ok: false, error: "solana_execution_unsupported" };
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(params.fromAddress)) return { ok: false, error: "invalid_from_address" };
  const toAddress = params.toAddress ?? params.fromAddress;
  if (!/^0x[0-9a-fA-F]{40}$/.test(toAddress)) return { ok: false, error: "invalid_to_address" };

  const slippagePct = defaultSlippagePct(params.fromChain, toChain);
  const qs = buildLifiQs({ ...params, toChain, slippagePct, fromAddress: params.fromAddress, toAddress });
  if (!qs) return { ok: false, error: "pair_not_routable" };

  const builtAt = Date.now();
  const q = await lifiFetch(qs);
  const tx = q?.transactionRequest;
  const rawOut = q?.estimate?.toAmount;
  if (!q || !tx?.to || !tx?.data || !rawOut) return { ok: false, error: "route_unavailable" };

  // Validate what the aggregator handed back before it becomes something a
  // user's key signs. These are addresses from a third-party API; trusting the
  // shape because the call returned 200 is how a malformed field ends up as a
  // signed transaction to nowhere.
  if (!isAddress(tx.to)) return { ok: false, error: "malformed_route_target" };

  const approvalAddress = q.estimate?.approvalAddress ?? null;
  if (approvalAddress !== null && !isAddress(approvalAddress)) {
    return { ok: false, error: "malformed_approval_address" };
  }

  // No local-table fallback. If a route needs an approval it must name the
  // token it will pull; defaulting to our own map would approve a contract the
  // router may not even use.
  const fromTokenAddress = q.action?.fromToken?.address ?? null;
  if (approvalAddress && (!fromTokenAddress || !isAddress(fromTokenAddress))) {
    return { ok: false, error: "malformed_token_address" };
  }
  if (approvalAddress && !q.estimate?.fromAmount && !q.action?.fromAmount) {
    return { ok: false, error: "missing_approval_amount" };
  }

  const sumUsd = (costs?: { amountUsd?: string }[]) =>
    (costs ?? []).reduce((s, c) => s + (Number(c.amountUsd) || 0), 0);
  const tool = q.toolDetails?.name ?? q.tool ?? "Li.Fi";

  return {
    ok: true,
    execution: {
      quote: {
        fromToken: params.fromToken,
        toToken: params.toToken,
        fromChain: params.fromChain,
        toChain,
        amountIn: params.amountIn,
        amountOut: fromBaseUnits(rawOut, TOKEN_DECIMALS[params.toToken]),
        slippagePct,
        gasUsd: round(sumUsd(q.estimate?.gasCosts), 4),
        feeUsd: round(sumUsd(q.estimate?.feeCosts), 2),
        route:
          params.fromChain === toChain
            ? [`${params.fromToken}→${params.toToken} via ${tool} on ${params.fromChain}`]
            : [`${params.fromToken} on ${params.fromChain}`, `${tool} bridge → ${toChain}`, `→ ${params.toToken}`],
        etaSeconds: q.estimate?.executionDuration ?? (params.fromChain === toChain ? 4 : 120),
        source: "lifi",
      },
      approvalAddress,
      fromTokenAddress,
      fromAmountAtomic: q.estimate?.fromAmount ?? q.action?.fromAmount ?? null,
      fromTokenDecimals: q.action?.fromToken?.decimals ?? null,
      toAmountMin: q.estimate?.toAmountMin ?? null,
      slippage: q.action?.slippage ?? null,
      routeId: q.id ?? q.transactionId ?? null,
      builtAt: new Date(builtAt).toISOString(),
      expiresAt: new Date(builtAt + QUOTE_TTL_MS).toISOString(),
      transactionRequest: {
        to: tx.to,
        data: tx.data,
        value: tx.value ?? "0x0",
        chainId: tx.chainId ?? Number(LIFI_CHAIN[params.fromChain]),
        gasLimit: tx.gasLimit,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Quoting
// ---------------------------------------------------------------------------

export function quoteSwap(params: {
  fromToken: Token;
  toToken: Token;
  fromChain: Chain;
  amountIn: number;
  toChain?: Chain;
}): SwapQuote {
  const { fromToken, toToken, fromChain, amountIn } = params;
  // Auto-select the cheapest destination the target token circulates on.
  const toChain =
    params.toChain ??
    CHEAPEST_CHAINS.find((c) => isTokenOnChain(toToken, c)) ??
    TOKEN_CHAINS[toToken][0];

  const slippagePct = defaultSlippagePct(fromChain, toChain);
  const gasUsd = toChain === "robinhood" ? 0.005 : fromChain === toChain ? 0.004 : 0.02;
  // Mirror Li.Fi's ~0.25% aggregation fee on bridged routes.
  const feePct = fromChain === toChain ? 0 : 0.25;
  const usdIn = amountIn * TOKEN_USD[fromToken];
  const feeUsd = (usdIn * feePct) / 100;
  const grossOut = (usdIn - feeUsd) / TOKEN_USD[toToken];
  const amountOut = grossOut * (1 - slippagePct / 100);

  const route =
    fromChain === toChain
      ? [`${fromToken}→${toToken} on ${fromChain}`]
      : [`${fromToken} on ${fromChain}`, `bridge → ${toChain}`, `→ ${toToken}`];

  return {
    fromToken,
    toToken,
    fromChain,
    toChain,
    amountIn,
    amountOut: round(amountOut, 8),
    slippagePct,
    gasUsd,
    feeUsd: round(feeUsd, 2),
    route,
    etaSeconds: fromChain === toChain ? 4 : crossVM(fromChain, toChain) ? 120 : 22,
    source: "mock",
  };
}

/**
 * Best-effort quote: live Li.Fi pricing when the pair is address-mapped and
 * the API answers in time, otherwise the local estimate. Same shape either
 * way, so callers just render `source`.
 */
export async function getSwapQuote(params: {
  fromToken: Token;
  toToken: Token;
  fromChain: Chain;
  amountIn: number;
  toChain?: Chain;
}): Promise<SwapQuote> {
  const mock = quoteSwap(params);
  const live = await fetchLifiQuote({
    fromToken: params.fromToken,
    toToken: params.toToken,
    fromChain: params.fromChain,
    toChain: mock.toChain,
    amountIn: params.amountIn,
    slippagePct: mock.slippagePct,
  });
  return live ?? mock;
}

function round(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}
