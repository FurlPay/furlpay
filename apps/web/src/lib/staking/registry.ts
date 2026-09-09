// ---------------------------------------------------------------------------
// The liquid-staking protocol registry.
//
// THE SAME RULE AS lib/onchain/stockTokenRegistry.ts, and it is the whole
// design: NO CONTRACT ADDRESS IS WRITTEN HERE FROM MEMORY. A recalled staking
// contract address looks exactly like the correct one and is wrong in a way
// nobody can see by reading it — and the consequence is a user's ETH sent to a
// contract that is not the protocol they chose, irreversibly.
//
// So the registry ships with the FACTS THAT ARE STABLE AND PUBLIC — which
// protocols exist, on which chain, what their receipt token is called, how
// their accounting works, how a user exits — and with `address: null`. An
// address arrives only from an environment variable that a person populated
// from the protocol's own published documentation, and `sourceUrl` records
// where they got it.
//
// WHY NOT JUST SHIP THE ADDRESSES. Because the failure is silent and total. A
// wrong swap address fails a quote; a wrong staking address accepts the deposit
// and there is no recovery. The cost of the registry being empty on day one is
// a screen that says "not available", which is the honest state of a capability
// nobody has configured.
//
// WHAT "STAKING" MEANS ON EVM, since the modelling follows from it: consumer
// native-delegation staking does not exist on Ethereum, Arbitrum, Base or
// Polygon PoS. Ethereum's own staking needs 32 ETH and a validator. What a
// wallet offers under that word is LIQUID STAKING — deposit, hold a receipt
// token, redeem through a queue. These entries describe that, and the UI says
// "liquid staking" rather than implying validator delegation.
// ---------------------------------------------------------------------------

export type StakingAccounting = "rebasing" | "exchange_rate";
export type ExitMechanism = "withdrawal_queue" | "secondary_market_only";
export type StakingInterface = "erc4626" | "native_submit";

export interface StakingProtocolEntry {
  id: string;
  name: string;
  chain: string;
  assetSymbol: string;
  receiptSymbol: string;
  accounting: StakingAccounting;
  exit: ExitMechanism;
  /** Which ABI shape the staking contract speaks. */
  contractInterface: StakingInterface;
  /** Env var holding the staking contract address. Populated by a person. */
  contractEnv: string;
  /** Env var holding the receipt token address. */
  receiptEnv: string;
  /** Env var holding the URL the addresses were copied from. */
  sourceEnv: string;
  /** Typical unbonding delay from the protocol's docs. Null when it varies. */
  unbondingDays: number | null;
  risks: string[];
}

/**
 * The catalogue.
 *
 * Every entry here is a factual description of a protocol that exists. None
 * carries an address — those come from `contractEnv` / `receiptEnv` at
 * resolution time, and an entry whose env vars are unset resolves to
 * `verified: false` and cannot be staked into.
 */
export const STAKING_CATALOGUE: StakingProtocolEntry[] = [
  {
    id: "eth-lst-rebasing",
    // Deliberately generic: naming a specific protocol here without its
    // verified address would put a brand in the UI that the configuration
    // cannot honour. The operator sets the name alongside the address.
    name: process.env.FURLPAY_STAKING_ETH_REBASING_NAME || "ETH liquid staking (rebasing)",
    chain: "ethereum",
    assetSymbol: "ETH",
    receiptSymbol: process.env.FURLPAY_STAKING_ETH_REBASING_SYMBOL || "LST",
    accounting: "rebasing",
    exit: "withdrawal_queue",
    contractInterface: "native_submit",
    contractEnv: "FURLPAY_STAKING_ETH_REBASING_CONTRACT",
    receiptEnv: "FURLPAY_STAKING_ETH_REBASING_RECEIPT",
    sourceEnv: "FURLPAY_STAKING_ETH_REBASING_SOURCE",
    unbondingDays: null,
    risks: [
      "Your ETH is staked by a third-party protocol, not by FurlPay.",
      "Validator penalties (slashing) can reduce the amount you get back.",
      "Withdrawals go through a queue and are not instant.",
      "The protocol's smart contracts carry their own risk.",
    ],
  },
  {
    id: "eth-lst-vault",
    name: process.env.FURLPAY_STAKING_ETH_VAULT_NAME || "ETH liquid staking (vault)",
    chain: "ethereum",
    assetSymbol: "ETH",
    receiptSymbol: process.env.FURLPAY_STAKING_ETH_VAULT_SYMBOL || "LST",
    accounting: "exchange_rate",
    exit: "withdrawal_queue",
    contractInterface: "erc4626",
    contractEnv: "FURLPAY_STAKING_ETH_VAULT_CONTRACT",
    receiptEnv: "FURLPAY_STAKING_ETH_VAULT_RECEIPT",
    sourceEnv: "FURLPAY_STAKING_ETH_VAULT_SOURCE",
    unbondingDays: null,
    risks: [
      "Your ETH is staked by a third-party protocol, not by FurlPay.",
      "Validator penalties (slashing) can reduce the amount you get back.",
      "The redemption rate can fall as well as rise.",
      "The protocol's smart contracts carry their own risk.",
    ],
  },
];

/** A protocol as it crosses the wire, with addresses resolved. */
export interface ResolvedStakingProtocol {
  id: string;
  name: string;
  chain: string;
  assetSymbol: string;
  receiptSymbol: string;
  accounting: StakingAccounting;
  exit: ExitMechanism;
  contractInterface: StakingInterface;
  contract: string | null;
  receiptToken: string | null;
  sourceUrl: string | null;
  verified: boolean;
  unbondingDays: number | null;
  aprPercent: number | null;
  aprAsOf: string | null;
  risks: string[];
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

function envAddress(name: string): string | null {
  const raw = (process.env[name] ?? "").trim();
  // A malformed address is treated as ABSENT, not passed through. Half an
  // address in configuration must never become a transaction destination.
  return ADDRESS_RE.test(raw) ? raw : null;
}

function envUrl(name: string): string | null {
  const raw = (process.env[name] ?? "").trim();
  // https only: a source URL is shown to the user as provenance, and an
  // http:// or javascript: value there is either a mistake or an attack.
  return raw.startsWith("https://") ? raw : null;
}

/**
 * Resolve one entry against the environment.
 *
 * `verified` requires ALL THREE of a contract, a receipt token and a source
 * URL. The source is not decoration: it is the only way a reviewer can re-check
 * an address later, and an address nobody can re-check is an address nobody
 * verified.
 */
export function resolveProtocol(
  entry: StakingProtocolEntry,
  apr?: { percent: number; asOf: string },
): ResolvedStakingProtocol {
  const contract = envAddress(entry.contractEnv);
  const receiptToken = envAddress(entry.receiptEnv);
  const sourceUrl = envUrl(entry.sourceEnv);

  return {
    id: entry.id,
    name: entry.name,
    chain: entry.chain,
    assetSymbol: entry.assetSymbol,
    receiptSymbol: entry.receiptSymbol,
    accounting: entry.accounting,
    exit: entry.exit,
    contractInterface: entry.contractInterface,
    contract,
    receiptToken,
    sourceUrl,
    verified: Boolean(contract && receiptToken && sourceUrl),
    unbondingDays: entry.unbondingDays,
    // NEVER defaulted. An APR is the number a user decides on; a stale or
    // invented one is the most consequential fabrication this surface could
    // make. Absent means the UI says "rate unavailable".
    aprPercent: apr?.percent ?? null,
    aprAsOf: apr?.asOf ?? null,
    risks: entry.risks,
  };
}

export function resolveAll(): ResolvedStakingProtocol[] {
  return STAKING_CATALOGUE.map((entry) => resolveProtocol(entry));
}

/** Is ANY protocol configured? Drives the "not available" state honestly. */
export function stakingIsConfigured(): boolean {
  return resolveAll().some((p) => p.verified);
}
