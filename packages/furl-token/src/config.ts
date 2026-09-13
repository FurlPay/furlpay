/**
 * FURL token parameters — the decisions that CANNOT be changed after the mint
 * exists, gathered in one auditable place.
 *
 * Read this before running any script in this package. On Solana a mint's
 * decimals are fixed at creation, Token-2022 extensions must be chosen at
 * creation (most cannot be added later), and `SetAuthority(..., None)`
 * permanently removes an authority — it is irreversible.
 *
 * Sources (verified 2026-09-12):
 *   Token-2022 program id + extension model  https://www.solana-program.com/docs/token-2022
 *   Metadata pointer ordering                https://solana.com/docs/tokens/extensions/metadata
 *   SetAuthority / permanent revocation      https://solana.com/docs/tokens/basics/set-authority
 *   USDC canonical addresses                 https://developers.circle.com/stablecoins/usdc-contract-addresses
 *
 * WHAT FURL IS, IN CODE
 * ---------------------
 * FURL is an ecosystem/utility token. It is deliberately NOT:
 *   - a stablecoin (USDC is the unit of account for every payment path),
 *   - a claim on customer funds, deposits, or FurlPay revenue,
 *   - redeemable by FurlPay for fiat or for anything of value.
 * The payment rails move USDC. FURL never sits between a customer and their
 * money. Keep it that way: the moment FURL represents customer funds or a
 * promise of return, this is a regulated instrument and this package's
 * assumptions no longer hold.
 */

/** Mint-time decisions. Changing any of these after launch means a NEW mint. */
export const FURL = {
  name: 'FurlPay',
  symbol: 'FURL',

  /**
   * 9 decimals matches SOL and is the Solana default for non-stable assets.
   * (USDC uses 6 — do not copy that here; FURL is not a stablecoin.)
   */
  decimals: 9,

  /**
   * Fixed maximum supply, in whole FURL. The mint authority is revoked
   * immediately after the initial mint, which makes this a hard cap enforced
   * by the runtime rather than by a promise.
   */
  maxSupply: 1_000_000_000n,

  /**
   * Token-2022 extensions enabled at creation. Deliberately minimal:
   *   metadataPointer + tokenMetadata → on-chain name/symbol/URI, no Metaplex
   *                                     dependency, and the update authority
   *                                     can be revoked later.
   * Explicitly NOT enabled, and why:
   *   transferFeeConfig   — a transfer tax on a payments token is a footgun
   *                         and reads as a scam vector.
   *   permanentDelegate   — can move/burn any holder's tokens, forever, and
   *                         cannot be revoked by holders. Never on a token we
   *                         ask the public to hold.
   *   transferHook        — arbitrary program on every transfer; unbounded
   *                         risk surface for zero current benefit.
   *   defaultAccountState — freezing by default makes FURL non-transferable
   *                         until we bless each account. Not a free asset.
   *   confidentialTransfer— incompatible with public supply verification,
   *                         which is the whole point of the disclosures.
   */
  extensions: ['metadataPointer', 'tokenMetadata'] as const,

  /**
   * Freeze authority. `null` means NO ONE can ever freeze a FURL account.
   * This is the honest default for a utility token: holders cannot be
   * censored by us. If a compliance obligation later requires freezing, that
   * requires a new mint and a public migration — not a quiet switch.
   */
  freezeAuthority: null as string | null,

  /**
   * Whether to revoke mint authority right after the initial supply is minted.
   * Leaving this `false` means FurlPay can print unlimited FURL, and every
   * holder has to trust us not to. Keep it `true`.
   */
  revokeMintAuthorityAfterInitialMint: true,
} as const

/**
 * Allocation. Percentages must total 100. These are placeholders pending YOUR
 * final decision — the scripts refuse to run against a config whose wallets
 * are still unset, so nothing can launch with these defaults.
 *
 * Every address here is published before launch so the public can verify
 * circulating supply independently. An allocation the market cannot audit is
 * indistinguishable from a hidden insider position.
 */
export interface Allocation {
  readonly key: string
  readonly label: string
  readonly percent: number
  /** Destination wallet. MUST be a multisig for treasury/team/liquidity. */
  readonly wallet: string | null
  /** Human-readable vesting terms; published alongside the address. */
  readonly vesting: string
}

export const ALLOCATIONS: readonly Allocation[] = [
  { key: 'community', label: 'Community & ecosystem', percent: 40, wallet: null,
    vesting: 'Released against published ecosystem programs; no cliff, usage-driven.' },
  { key: 'liquidity', label: 'Liquidity', percent: 20, wallet: null,
    vesting: 'Unlocked at TGE to seed FURL/USDC. LP position published.' },
  { key: 'treasury', label: 'Treasury', percent: 15, wallet: null,
    vesting: '4-year linear, monthly unlock, multisig-controlled.' },
  { key: 'team', label: 'Team & founders', percent: 15, wallet: null,
    vesting: '12-month cliff, then 36-month linear. Nothing at TGE.' },
  { key: 'partnerships', label: 'Partnerships', percent: 5, wallet: null,
    vesting: 'Locked until a named partnership goes live; disclosed per unlock.' },
  { key: 'reserve', label: 'Security & launch reserve', percent: 5, wallet: null,
    vesting: 'Held for audits, bug bounties, incident response. Multisig.' },
] as const

/** Canonical USDC. Verified against Circle's contract-address page. */
export const USDC = {
  arbitrumOne: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  arbitrumSepolia: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
  solanaMainnet: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  solanaDevnet: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
} as const

/** Token-2022 program id (verified). The classic SPL Token program differs. */
export const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'

export type Cluster = 'devnet' | 'mainnet-beta'

/** Validation shared by every script. Throws rather than launching something wrong. */
export function assertConfigLaunchable(cluster: Cluster): void {
  const errors: string[] = []

  const total = ALLOCATIONS.reduce((a, b) => a + b.percent, 0)
  if (total !== 100) errors.push(`allocations total ${total}%, must be 100%`)

  if (FURL.decimals < 0 || FURL.decimals > 9) errors.push('decimals must be 0-9')
  if (FURL.maxSupply <= 0n) errors.push('maxSupply must be positive')

  const banned = ['transferFeeConfig', 'permanentDelegate', 'transferHook', 'defaultAccountState']
  for (const ext of FURL.extensions) {
    if (banned.includes(ext)) errors.push(`extension ${ext} is banned for FURL (see config comments)`)
  }

  if (cluster === 'mainnet-beta') {
    // Mainnet demands every disclosure be real. Devnet may run with defaults.
    const unset = ALLOCATIONS.filter((a) => !a.wallet).map((a) => a.key)
    if (unset.length) errors.push(`mainnet launch requires wallets for: ${unset.join(', ')}`)
    if (!FURL.revokeMintAuthorityAfterInitialMint) {
      errors.push('mainnet launch requires revokeMintAuthorityAfterInitialMint=true (unbounded supply otherwise)')
    }
  }

  if (errors.length) {
    throw new Error(`FURL config is not launchable on ${cluster}:\n  - ${errors.join('\n  - ')}`)
  }
}

/** Base units (u64) for a whole-token amount, respecting `decimals`. */
export function toBaseUnits(whole: bigint, decimals = FURL.decimals): bigint {
  return whole * 10n ** BigInt(decimals)
}

/** The per-allocation base-unit amounts. Integer math only — no float drift. */
export function allocationAmounts(): { key: string; amount: bigint }[] {
  const total = toBaseUnits(FURL.maxSupply)
  const rows = ALLOCATIONS.map((a) => ({
    key: a.key,
    // percent is an integer 0-100; multiply before dividing to stay exact.
    amount: (total * BigInt(a.percent)) / 100n,
  }))
  const sum = rows.reduce((a, r) => a + r.amount, 0n)
  if (sum !== total) {
    throw new Error(`allocation rounding lost ${total - sum} base units; fix percentages`)
  }
  return rows
}
