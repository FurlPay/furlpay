/**
 * Canonical FURL token constants for the web app — the ONE place the app reads
 * FURL's on-chain identity from. Verified against Solana mainnet on 2026-09-13.
 *
 * FURL is the FurlPay ecosystem's USD-denominated payment token, intended to
 * operate as its stablecoin. IMPORTANT: the on-chain token does NOT implement a
 * USD peg, reserves, or a redemption mechanism. Do not render copy that claims
 * it is reserve-backed, 1:1 redeemable, or price-guaranteed.
 *
 * WHY EVERY FURL CONSTANT LIVES HERE. A second spelling of the mint address
 * anywhere in the tree is a path to sending real money to the wrong token, and
 * the error is unrecoverable. `src/lib/__tests__/furlConfig.spec.ts` asserts
 * that this file agrees with `packages/furl-token/src/config.ts` (the launch
 * package) and with the public metadata mirror, so the three cannot drift.
 */

/** The live mainnet mint. Never change without a real re-launch. */
export const FURL_MINT = 'FYatJq71zqvaQNLLtbBy4hQcsV25dMATYfCSVBzV3gY1'

/** Token-2022 program (FURL is a Token-2022 mint, NOT legacy SPL). */
export const FURL_TOKEN_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'

/** Legacy SPL Token program — here only so code can assert FURL is NOT it.
 *  Deriving a FURL associated-token account under this program id yields a
 *  different address that no transfer can ever reach. */
export const SPL_TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'

export const FURL_SYMBOL = 'FURL'
export const FURL_NAME = 'FurlPay'
export const FURL_DECIMALS = 6
export const FURL_TOTAL_SUPPLY = 1_000_000_000 // whole FURL (fixed at mint)

/** Total supply in base units (u64). 1e9 FURL × 1e6 = 1e15 — inside u64, but
 *  past Number.MAX_SAFE_INTEGER once multiplied further, so bigint only. */
export const FURL_TOTAL_SUPPLY_BASE_UNITS = 1_000_000_000_000_000n

/** Mainnet launch date (mint creation), for "as of" labelling. */
export const FURL_LAUNCHED_AT = '2026-09-13'

/** Permanent Arweave (Irys) metadata + icon. */
export const FURL_METADATA_URI = 'https://gateway.irys.xyz/4WYcrbavrRd4BA7Ls61czF8z1cjNg6M3xPdzw24HQgFH'
export const FURL_IMAGE_URI = 'https://gateway.irys.xyz/FZZrqRxi2qg8ZN1ER8oh9n7QFGJocchTstNFojkREAkH'

/** Deployer / current sole holder. A PUBLIC address — published so anyone can
 *  verify the concentration claim on /token rather than take our word for it. */
export const FURL_DEPLOYER = 'FgeSXvrWcqE93byDoF3Vhwou7XTUhY42cYhs7vXkJPUL'

export const FURL_EXPLORER = `https://solscan.io/token/${FURL_MINT}`
export const FURL_EXPLORER_SOLANA = `https://explorer.solana.com/address/${FURL_MINT}`
export const FURL_DEPLOYER_EXPLORER = `https://solscan.io/account/${FURL_DEPLOYER}`

/** Published allocation model (percent of total supply). Sums to 100. */
export const FURL_ALLOCATIONS = [
  { key: 'community', label: 'Community & ecosystem', percent: 40 },
  { key: 'liquidity', label: 'Liquidity', percent: 20 },
  { key: 'treasury', label: 'Treasury', percent: 15 },
  { key: 'team', label: 'Team & founders', percent: 15 },
  { key: 'partnerships', label: 'Partnerships', percent: 5 },
  { key: 'reserve', label: 'Security & launch reserve', percent: 5 },
] as const

/** FURL amount (whole) for each allocation, derived from the model. */
export function furlAllocationAmount(percent: number): number {
  return (FURL_TOTAL_SUPPLY * percent) / 100
}

/** Base58, 32–44 chars — the shape of every Solana address. */
const BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

export function isSolanaAddress(value: string): boolean {
  return BASE58_ADDRESS.test(value)
}

/** Exact, case-sensitive match against the live mint. Base58 is case-sensitive,
 *  so a lowercased comparison would accept a string that is not this mint. */
export function isFurlMint(mint: string): boolean {
  return mint === FURL_MINT
}

/**
 * Throw unless `mint` is the live FURL mint. Called on every path that is about
 * to build a transfer, because a lookalike mint (same symbol, same icon,
 * different address) is the standard way a payments UI is turned into a theft
 * surface — and the user cannot tell from the token name.
 */
export function assertFurlMint(mint: string): void {
  if (!isFurlMint(mint)) {
    throw new Error(`Not the FURL mint: ${mint} (expected ${FURL_MINT})`)
  }
}

/**
 * Whole FURL → base units, integer-exact.
 *
 * Takes a STRING (or bigint) rather than a number: `0.1 + 0.2` arithmetic on a
 * money amount loses cents at scale, and `Math.round(x * 1e6)` on a float that
 * arrived from JSON silently shifts the amount. Anything with more than 6
 * decimal places is rejected rather than truncated — quietly dropping a digit
 * is a wrong payment, not a formatting detail.
 */
export function furlToBaseUnits(whole: string | bigint): bigint {
  if (typeof whole === 'bigint') return whole * 10n ** BigInt(FURL_DECIMALS)

  const trimmed = whole.trim()
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`Invalid FURL amount: "${whole}" (expected a non-negative decimal)`)
  }
  const [intPart, fracPart = ''] = trimmed.split('.')
  if (fracPart.length > FURL_DECIMALS) {
    throw new Error(
      `FURL amount "${whole}" has ${fracPart.length} decimal places; the mint has ${FURL_DECIMALS}`,
    )
  }
  const padded = fracPart.padEnd(FURL_DECIMALS, '0')
  return BigInt(intPart) * 10n ** BigInt(FURL_DECIMALS) + BigInt(padded || '0')
}

/** Base units → a whole-FURL decimal STRING. No float ever holds the amount. */
export function baseUnitsToFurl(base: bigint | string): string {
  const raw = typeof base === 'bigint' ? base : BigInt(base)
  const scale = 10n ** BigInt(FURL_DECIMALS)
  const whole = raw / scale
  const frac = raw % scale
  if (frac === 0n) return whole.toString()
  return `${whole}.${frac.toString().padStart(FURL_DECIMALS, '0').replace(/0+$/, '')}`
}

/** Display formatting with thousands separators. Presentation only. */
export function formatFurl(base: bigint | string): string {
  const s = baseUnitsToFurl(base)
  const [intPart, frac] = s.split('.')
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return frac ? `${grouped}.${frac}` : grouped
}
