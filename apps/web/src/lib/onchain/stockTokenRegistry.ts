// ---------------------------------------------------------------------------
// The tokenized-equity registry.
//
// THE CENTRAL RULE, and the reason this file has a verification field at all:
// NO CONTRACT ADDRESS IS WRITTEN HERE FROM MEMORY. A model that recalls a mint
// address recalls something that looks exactly like the right answer and is
// wrong in a way nobody can see, and the consequence is a user's USDC sent to a
// contract that is not the asset they asked for — an irreversible loss caused
// by a plausible-looking string.
//
// So the registry ships EMPTY of addresses, and the shape below is what an
// entry must satisfy before it can hold one:
//
//   1. `address` is populated from the issuer's own published list, by a person
//   2. `verifiedBy` and `verifiedAt` record who confirmed it and when
//   3. `sourceUrl` points at the issuer page the address was copied from
//   4. only then may `status` become "active"
//
// `tradableTokens()` filters on all of that, so an unverified entry cannot
// reach a quote, a route, or a balance read. An empty registry means the
// tokenized-stock surface renders its "not available" state, which is the
// correct behaviour for a capability whose data has not been verified — and is
// infinitely better than the alternative.
//
// WHAT IS KNOWN AND RECORDED HERE: issuer identities, chains, token standards
// and jurisdiction rules are public, stable facts about how these programmes
// work, and they are captured so the verification pass is a matter of pasting
// addresses rather than researching the whole domain. Backed Finance issues
// xStocks as Solana Token-2022 and as ERC-20; Dinari issues dShares to US
// persons under its own registration; Ondo and Robinhood run their own
// programmes with their own eligibility rules. Those facts shape the schema.
// The addresses are the part that must be verified.
// ---------------------------------------------------------------------------

export type TokenStandard = "erc20" | "spl" | "spl-token-2022";

export type RegistryStatus =
  | "unverified" // no address, or an address nobody has confirmed
  | "active" // verified and tradable
  | "suspended" // verified, but temporarily withdrawn
  | "retired"; // the issuer has wound the token down

export interface StockTokenEntry {
  /** Underlying listed symbol, e.g. "NVDA". */
  symbol: string;
  /** The token's own ticker, e.g. "NVDAx". Distinct on purpose — they are
   *  different instruments and conflating them in a UI implies share
   *  ownership that a tokenized wrapper does not convey. */
  tokenSymbol: string;
  issuer: string;
  chain: string;
  standard: TokenStandard;
  /**
   * Contract or mint address.
   *
   * NULL until a person copies it from `sourceUrl` and fills it in. Never
   * populate this from memory or from a model's suggestion.
   */
  address: string | null;
  /** Token decimals. Null until read from the chain — NOT assumed to be 18. */
  decimals: number | null;
  /** ISO-3166 alpha-2 codes that MAY hold the token. Empty means the issuer's
   *  eligibility rules have not been recorded, which blocks activation. */
  eligibleCountries: string[];
  /** ISO-3166 alpha-2 codes explicitly excluded by the issuer. */
  restrictedCountries: string[];
  /** Whether the token enforces transfer restrictions on-chain (Token-2022
   *  transfer hooks, ERC-1404-style checks). Affects whether a DEX route is
   *  even possible. */
  onChainTransferRestrictions: boolean | null;
  /** Issuer's published proof-of-reserves or attestation page. */
  proofOfReservesUrl: string | null;
  /** Where the address in this entry was copied from. */
  sourceUrl: string;
  status: RegistryStatus;
  /** Who confirmed the address against `sourceUrl`. */
  verifiedBy: string | null;
  /** When. ISO date. */
  verifiedAt: string | null;
  notes?: string;
}

/**
 * The registry.
 *
 * Every entry is `unverified` with a null address, by design. These are
 * placeholders that name the issuer programmes and where to find their token
 * lists — the scaffolding for a verification pass, not data to render.
 *
 * To activate one: open `sourceUrl`, copy the address for that symbol, read the
 * decimals off-chain, record the issuer's eligibility rules, fill in
 * `verifiedBy`/`verifiedAt`, and set `status: "active"`. Then set
 * FURLPAY_STOCK_TOKEN_REGISTRY_VERIFIED so the capability flag can turn on.
 */
export const STOCK_TOKEN_REGISTRY: StockTokenEntry[] = [
  {
    symbol: "NVDA",
    tokenSymbol: "NVDAx",
    issuer: "Backed Finance",
    chain: "solana",
    // xStocks are issued under the Token-2022 program. Reading them with the
    // legacy SPL Token program returns nothing — see onchain/balances.ts.
    standard: "spl-token-2022",
    address: null,
    decimals: null,
    eligibleCountries: [],
    // Backed excludes US persons; the full list belongs in the verification
    // pass rather than being guessed at here.
    restrictedCountries: ["US"],
    onChainTransferRestrictions: null,
    proofOfReservesUrl: null,
    sourceUrl: "https://xstocks.com/",
    status: "unverified",
    verifiedBy: null,
    verifiedAt: null,
    notes: "Placeholder. Copy the mint from the issuer's published token list before activating.",
  },
  {
    symbol: "AAPL",
    tokenSymbol: "AAPLx",
    issuer: "Backed Finance",
    chain: "solana",
    standard: "spl-token-2022",
    address: null,
    decimals: null,
    eligibleCountries: [],
    restrictedCountries: ["US"],
    onChainTransferRestrictions: null,
    proofOfReservesUrl: null,
    sourceUrl: "https://xstocks.com/",
    status: "unverified",
    verifiedBy: null,
    verifiedAt: null,
    notes: "Placeholder. Copy the mint from the issuer's published token list before activating.",
  },
  {
    symbol: "TSLA",
    tokenSymbol: "TSLAx",
    issuer: "Backed Finance",
    chain: "solana",
    standard: "spl-token-2022",
    address: null,
    decimals: null,
    eligibleCountries: [],
    restrictedCountries: ["US"],
    onChainTransferRestrictions: null,
    proofOfReservesUrl: null,
    sourceUrl: "https://xstocks.com/",
    status: "unverified",
    verifiedBy: null,
    verifiedAt: null,
    notes: "Placeholder. Copy the mint from the issuer's published token list before activating.",
  },
];

/** Entries a person has verified and marked active AND that carry everything a
 *  trade path needs. Anything short of that is invisible to the product. */
export function tradableTokens(): StockTokenEntry[] {
  return STOCK_TOKEN_REGISTRY.filter(
    (e) =>
      e.status === "active" &&
      e.address !== null &&
      e.decimals !== null &&
      e.verifiedBy !== null &&
      e.verifiedAt !== null
  );
}

/** Tradable entries on one chain — what a balance read is scoped to. */
export function tradableTokensOn(chain: string): StockTokenEntry[] {
  return tradableTokens().filter((e) => e.chain === chain);
}

/** Look up a verified entry by underlying symbol and chain. */
export function findTradableToken(symbol: string, chain: string): StockTokenEntry | null {
  const upper = symbol.toUpperCase();
  return tradableTokens().find((e) => e.symbol === upper && e.chain === chain) ?? null;
}

/**
 * May a user in `country` hold this token?
 *
 * DEFAULT DENY. An entry with no recorded eligibility list denies everyone,
 * and a caller with no country denies too. Both are deliberate: the failure
 * mode of a default-allow eligibility check is offering a security to someone
 * the issuer's own terms exclude, which is not a bug that can be fixed after
 * the fact.
 */
export function isEligible(entry: StockTokenEntry, country: string | null | undefined): boolean {
  if (!country) return false;
  const cc = country.trim().toUpperCase();
  if (cc.length !== 2) return false;
  if (entry.restrictedCountries.includes(cc)) return false;
  if (entry.eligibleCountries.length === 0) return false;
  return entry.eligibleCountries.includes(cc);
}

export interface RegistryAudit {
  total: number;
  active: number;
  unverified: number;
  missingAddress: number;
  missingEligibility: number;
  /** True only when at least one entry is genuinely tradable. */
  anyTradable: boolean;
}

/** What the ops console shows, and what a readiness check asserts. */
export function registryAudit(): RegistryAudit {
  const total = STOCK_TOKEN_REGISTRY.length;
  return {
    total,
    active: STOCK_TOKEN_REGISTRY.filter((e) => e.status === "active").length,
    unverified: STOCK_TOKEN_REGISTRY.filter((e) => e.status === "unverified").length,
    missingAddress: STOCK_TOKEN_REGISTRY.filter((e) => e.address === null).length,
    missingEligibility: STOCK_TOKEN_REGISTRY.filter((e) => e.eligibleCountries.length === 0).length,
    anyTradable: tradableTokens().length > 0,
  };
}
