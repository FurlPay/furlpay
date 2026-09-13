/**
 * FURL treasury architecture — the destination wallets the supply is to be
 * migrated INTO, and the rules that make a migration refuse to run when it
 * would recreate the problem it is meant to solve.
 *
 * THE PROBLEM THIS EXISTS FOR. At launch all six allocations were minted to one
 * owner, so 100% of FURL sits in a single Token-2022 associated token account
 * controlled by a single keypair (see ../MAINNET-LAUNCH.md). That is the worst
 * treasury shape there is: one key compromise is a total loss, the public answer
 * to "who controls the supply" is "one address", and no allocation is
 * independently auditable. It is recorded on /token rather than hidden, and it
 * is the next thing to fix.
 *
 * WHAT THIS FILE IS NOT. It does not move anything, and it cannot: no secret
 * material appears here, only public addresses. Every destination starts `null`,
 * and `assertMigrationReady` refuses a mainnet migration until a real address is
 * set for each. Nothing is created or funded automatically — creating a multisig
 * is a deliberate, approved act.
 *
 * WHY MULTISIG (Squads) FOR MOST BUCKETS. A single-signer treasury means one
 * device, one phishing page, or one malicious dependency can drain it. A 2-of-3
 * or 3-of-5 threshold converts a total-loss event into a failed attempt. The
 * buckets that will hold the most value for the longest (treasury, team,
 * reserve) require it here; `assertMigrationReady` enforces that rather than
 * trusting the operator to remember.
 */

import { FURL, ALLOCATIONS, DEPLOYER_PUBKEY, toBaseUnits } from './config.ts'

/** Custody model required of a destination before value may be sent to it. */
export type Custody =
  /** Squads (or equivalent) multisig. Required for long-lived value. */
  | 'multisig'
  /** Single keypair. Acceptable only for an operational, low-balance wallet. */
  | 'single_signer'
  /** A program-owned account (e.g. a vesting or LP position). */
  | 'program'

export interface Destination {
  /** Allocation key, matching ALLOCATIONS in config.ts. */
  readonly key: string
  /** Public address of the destination. `null` = not created yet. */
  readonly wallet: string | null
  /** Custody the migration will REQUIRE for this bucket. */
  readonly requiredCustody: Custody
  /** Signature threshold to assert once the multisig exists, e.g. "2/3". */
  readonly threshold: string | null
  /** Why this bucket has this custody model. Published with the address. */
  readonly rationale: string
}

/**
 * Destination wallets. ALL `null` today — deliberately.
 *
 * Fill each `wallet` in only after the multisig actually exists on-chain and you
 * have verified its members and threshold in the Squads UI. A typo'd address
 * here sends real supply to a key nobody controls, and that is unrecoverable.
 */
export const DESTINATIONS: readonly Destination[] = [
  {
    key: 'community',
    wallet: null,
    requiredCustody: 'multisig',
    threshold: '2/3',
    rationale:
      'The largest bucket (40%). Distribution happens over years, so it is the most attractive single target on the chain; a threshold is mandatory.',
  },
  {
    key: 'liquidity',
    wallet: null,
    requiredCustody: 'multisig',
    threshold: '2/3',
    rationale:
      'Funds the FURL/USDC pool and holds the LP position. LP custody decides whether liquidity can be pulled, so it must not be one key.',
  },
  {
    key: 'treasury',
    wallet: null,
    requiredCustody: 'multisig',
    threshold: '3/5',
    rationale:
      'Operating treasury. Highest threshold because it is the bucket that pays out regularly and therefore signs most often.',
  },
  {
    key: 'team',
    wallet: null,
    requiredCustody: 'multisig',
    threshold: '2/3',
    rationale:
      'Team allocation, to sit behind a published vesting schedule. A single-signer team wallet is indistinguishable from an unlocked insider position.',
  },
  {
    key: 'partnerships',
    wallet: null,
    requiredCustody: 'multisig',
    threshold: '2/3',
    rationale:
      'Paid out per agreement. Small, but every payout is a counterparty-facing transfer that deserves a second signer.',
  },
  {
    key: 'reserve',
    wallet: null,
    requiredCustody: 'multisig',
    threshold: '3/5',
    rationale:
      'Security and launch reserve — the bucket that must still exist after an incident. Highest threshold, coldest keys, no routine use.',
  },
] as const

/** Base58 public-key shape. A secret-key array or seed would not match. */
const PUBKEY = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

export interface MigrationLeg {
  readonly key: string
  readonly percent: number
  /** Destination owner address. */
  readonly to: string
  /** Amount in base units (u64). */
  readonly amount: bigint
  /** Amount in whole FURL, for human review. */
  readonly whole: string
}

/**
 * The exact legs of the migration, derived from the allocation model.
 *
 * Integer math only: the percentages are integers, the multiplication happens
 * before the division, and the sum is asserted against the full supply — a
 * migration that silently loses or invents base units is a broken ledger.
 */
export function migrationLegs(): MigrationLeg[] {
  const total = toBaseUnits(FURL.maxSupply)
  const legs: MigrationLeg[] = []

  for (const alloc of ALLOCATIONS) {
    const dest = DESTINATIONS.find((d) => d.key === alloc.key)
    if (!dest) throw new Error(`no destination configured for allocation "${alloc.key}"`)
    const amount = (total * BigInt(alloc.percent)) / 100n
    legs.push({
      key: alloc.key,
      percent: alloc.percent,
      to: dest.wallet ?? '',
      amount,
      whole: (amount / 10n ** BigInt(FURL.decimals)).toString(),
    })
  }

  const sum = legs.reduce((a, l) => a + l.amount, 0n)
  if (sum !== total) {
    throw new Error(`migration legs sum to ${sum}, expected exactly ${total} base units`)
  }
  return legs
}

/**
 * Refuse a migration that would be unsafe, incomplete, or a no-op.
 *
 * Every check here is a mistake that would be expensive and irreversible:
 * sending to an unset address, sending back to the deployer (which "migrates"
 * nothing while looking like progress), a duplicate destination that silently
 * merges two buckets, a malformed address, or legs that do not sum to the
 * supply.
 */
export function assertMigrationReady(): void {
  const errors: string[] = []

  for (const dest of DESTINATIONS) {
    if (!dest.wallet) {
      errors.push(`${dest.key}: no destination wallet set (create the multisig first)`)
      continue
    }
    if (!PUBKEY.test(dest.wallet)) {
      errors.push(`${dest.key}: "${dest.wallet}" is not a base58 public key`)
    }
    if (dest.wallet === DEPLOYER_PUBKEY) {
      errors.push(
        `${dest.key}: destination equals the deployer — that is not a migration, it is a no-op that looks like one`,
      )
    }
    if (dest.requiredCustody === 'multisig' && !dest.threshold) {
      errors.push(`${dest.key}: requires multisig custody but no threshold is recorded`)
    }
  }

  const wallets = DESTINATIONS.map((d) => d.wallet).filter((w): w is string => !!w)
  const duplicates = wallets.filter((w, i) => wallets.indexOf(w) !== i)
  if (duplicates.length) {
    errors.push(
      `duplicate destination address(es) ${[...new Set(duplicates)].join(', ')} — two allocations sharing one wallet cannot be audited apart`,
    )
  }

  // Throws on its own if the legs do not sum to the full supply.
  migrationLegs()

  if (errors.length) {
    throw new Error(`FURL migration is not ready:\n  - ${errors.join('\n  - ')}`)
  }
}

/** True when every destination is set and the checks pass. Never throws. */
export function migrationReady(): boolean {
  try {
    assertMigrationReady()
    return true
  } catch {
    return false
  }
}
