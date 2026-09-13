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
 * FURL is POSITIONED as the FurlPay ecosystem's stablecoin / payment currency
 * for travel purchases, everyday payments and rewards across the network.
 *
 * HONEST STATE OF THE IMPLEMENTATION (read before calling FURL a "stablecoin"
 * anywhere public): the mint created by this package is a plain fixed-supply
 * SPL/Token-2022 token. It does NOT itself implement:
 *   - a fiat peg,
 *   - reserves backing the supply,
 *   - an issuance / 1:1 redemption mechanism,
 *   - the compliance posture a USD stablecoin requires (MiCA e-money-token
 *     rules in the EU, US stablecoin legislation).
 * Choosing 6 decimals makes amounts behave like a USD payment unit; it does
 * NOT make FURL stable. Until the peg + reserves + redemption + compliance
 * exist and are attested, describe FURL as "intended to operate as" the
 * ecosystem stablecoin, never as a live USD-redeemable one. A stablecoin is
 * MORE regulated than a utility token, not less. USDC remains the external,
 * reserve-backed settlement asset for every payment path today.
 */

/** Mint-time decisions. Changing any of these after launch means a NEW mint. */
export const FURL = {
  name: 'FurlPay',
  symbol: 'FURL',

  /**
   * 6 decimals — the USD-stablecoin convention, matching USDC on Solana, so
   * amounts read like money (1 FURL = 1,000,000 base units). This is a
   * precision choice only; it does not itself create a peg (see header).
   * Irreversible once the mint exists.
   */
  decimals: 6,

  /** Public one-line description (mirrors the off-chain metadata JSON). */
  description:
    'FurlPay is a travel and payments ecosystem for Android and iOS, built on Solana. FURL is the ecosystem’s USD-denominated payment currency, intended to operate as its stablecoin for travel purchases, everyday payments and rewards; FurlPay also supports USDC for settlement, and eligible tokenized stocks and investment products.',

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
   * Freeze authority. `null` means NO ONE can ever freeze a FURL account —
   * holders cannot be censored. NOTE: a production USD stablecoin usually
   * needs a freeze/compliance authority (sanctions, law-enforcement holds).
   * That is a deliberate future decision: enabling it requires a NEW mint and
   * a public migration, never a quiet switch. Kept `null` today because the
   * peg/reserve/compliance stack does not yet exist.
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

/**
 * LAUNCH DECISION (2026-09-13, explicitly authorized): all six allocations
 * resolve to the DEPLOYER public address below.
 *
 * RISK — recorded, not hidden: this concentrates 100% of supply under ONE key.
 * It is NOT the recommended long-term treasury architecture. Dedicated,
 * separated, multisig (e.g. Squads) treasury/allocation wallets should be
 * created and the supply migrated to them before any meaningful production
 * distribution. Until then, a single key compromise = total loss, and public
 * "who controls the supply" answers are "one address".
 *
 * Only a PUBLIC address appears here. No private key / seed ever goes in source.
 */
export const DEPLOYER_PUBKEY = 'FgeSXvrWcqE93byDoF3Vhwou7XTUhY42cYhs7vXkJPUL'

export const ALLOCATIONS: readonly Allocation[] = [
  { key: 'community', label: 'Community & ecosystem', percent: 40, wallet: DEPLOYER_PUBKEY,
    vesting: 'Deployer address at launch (see risk note); to migrate to a dedicated wallet.' },
  { key: 'liquidity', label: 'Liquidity', percent: 20, wallet: DEPLOYER_PUBKEY,
    vesting: 'Deployer address at launch; seeds FURL/USDC pool, then LP position published.' },
  { key: 'treasury', label: 'Treasury', percent: 15, wallet: DEPLOYER_PUBKEY,
    vesting: 'Deployer address at launch; migrate to multisig treasury before distribution.' },
  { key: 'team', label: 'Team & founders', percent: 15, wallet: DEPLOYER_PUBKEY,
    vesting: 'Deployer address at launch; migrate to a vested multisig.' },
  { key: 'partnerships', label: 'Partnerships', percent: 5, wallet: DEPLOYER_PUBKEY,
    vesting: 'Deployer address at launch; migrate to a dedicated wallet.' },
  { key: 'reserve', label: 'Security & launch reserve', percent: 5, wallet: DEPLOYER_PUBKEY,
    vesting: 'Deployer address at launch; migrate to a multisig reserve.' },
] as const

/**
 * Canonical token metadata + image, hosted PERMANENTLY on Arweave via Irys
 * (uploaded 2026-09-13; see scripts/upload-arweave.ts and arweave-uris.json).
 * The on-chain token-metadata `uri` points at METADATA_URI. These are
 * immutable — Arweave data cannot be changed or taken down, which is the point
 * for a token whose holders must always be able to resolve its identity.
 * `apps/web/public/furl/metadata.json` is a mirror for the website only; the
 * chain uses Arweave.
 */
export const METADATA_URI = 'https://gateway.irys.xyz/4WYcrbavrRd4BA7Ls61czF8z1cjNg6M3xPdzw24HQgFH'
export const IMAGE_URL = 'https://gateway.irys.xyz/FZZrqRxi2qg8ZN1ER8oh9n7QFGJocchTstNFojkREAkH'
export const EXTERNAL_URL = 'https://furlpay.com'

/**
 * Extra key/value pairs written to the mint's Token-2022 token-metadata via
 * UpdateField, AFTER InitializeTokenMetadata. Kept factual and consistent with
 * the off-chain JSON: chain, role, and a link back to the canonical metadata /
 * site. No unbacked-peg claim appears here. These are actually written on-chain
 * (rent is sized to include them), so on-chain and off-chain agree.
 */
export const ON_CHAIN_ADDITIONAL_METADATA: readonly (readonly [string, string])[] = [
  ['project', 'FurlPay'],
  ['chain', 'solana'],
  ['role', 'ecosystem-payment-currency'],
  ['external_url', EXTERNAL_URL],
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

  // 6 is the final product decision (USD-payment convention, matches USDC).
  // The SPL legal range is 0-9; we pin 6 so a stray edit can't ship a mint
  // with the wrong precision.
  if (FURL.decimals !== 6) errors.push('decimals must be 6 (USD-payment convention, final)')
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
