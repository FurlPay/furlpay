/**
 * The twenty checks that must ALL pass before 1,000,000,000 FURL moves.
 *
 * WHY THIS IS A SEPARATE MODULE. The checks used to live inline in
 * `migrate-allocations.ts`, which meant the dry run and the execute path could
 * drift apart — and a dry run that verifies something different from what
 * execution verifies is worse than no dry run, because it manufactures
 * confidence. Both paths now call the SAME function, and the pure half is unit
 * tested without a network.
 *
 * FAIL CLOSED, AND FAIL WHOLE. Every check returns a finding; a single failure
 * blocks the entire migration. There is deliberately no "continue with the legs
 * that passed": a partial migration of a treasury leaves a state nobody planned
 * for and nobody can describe, and unwinding it costs more than redoing it.
 *
 * The checks are split in two because they have different trust properties:
 *   - PURE checks run on configuration alone. They are deterministic and
 *     testable, and they catch the mistakes made while editing this repo.
 *   - CHAIN checks read mainnet. They catch the mistakes reality makes —
 *     a mint that is not what the config says, a balance that moved, a supply
 *     that changed under us.
 * Passing the pure checks means the plan is coherent. Passing both means it is
 * also true.
 */

import { FURL, MINT_ADDRESS, DEPLOYER_PUBKEY, toBaseUnits } from './config.ts'
import { DESTINATIONS, migrationLegs } from './treasury.ts'

/** Token-2022. FURL is not a legacy SPL mint and never will be. */
export const EXPECTED_TOKEN_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'
export const LEGACY_TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'

/**
 * Lamports that must remain available for fees.
 *
 * Six transfers, each creating an associated token account. ATA rent is
 * ~0.00204 SOL per account and is NOT refundable while the account is open, so
 * this is a real cost, not a deposit. Plus per-signature fees and headroom for
 * priority fees during congestion.
 */
export const ATA_RENT_LAMPORTS = 2_039_280n
export const SIGNATURE_FEE_LAMPORTS = 5_000n
export const PRIORITY_HEADROOM_LAMPORTS = 20_000_000n // 0.02 SOL

export type Severity = 'PASS' | 'FAIL'

export interface Finding {
  readonly id: number
  readonly check: string
  readonly severity: Severity
  readonly detail: string
}

export interface PureFacts {
  /** Allocation keys that may never appear. */
  readonly bannedAllocationKeys?: readonly string[]
}

export interface ChainFacts {
  /** Owning program of the mint account, base58. */
  readonly mintOwnerProgram: string
  /** Decimals as reported by the mint. */
  readonly decimals: number
  /** Total supply in base units, as reported by the mint. */
  readonly supplyBaseUnits: bigint
  /** Owner of the source token account. */
  readonly sourceOwner: string
  /** FURL balance of the source token account, base units. */
  readonly sourceBalanceBaseUnits: bigint
  /** SOL balance of the fee payer, lamports. */
  readonly payerLamports: bigint
  /** Public key the loaded keypair actually resolves to, if one was loaded. */
  readonly signerPubkey?: string
  /** Destination token accounts that already hold a non-zero FURL balance. */
  readonly destinationsAlreadyFunded?: readonly string[]
}

const pass = (id: number, check: string, detail: string): Finding => ({ id, check, severity: 'PASS', detail })
const fail = (id: number, check: string, detail: string): Finding => ({ id, check, severity: 'FAIL', detail })

/** Required lamports for the whole migration. */
export function requiredLamports(legCount: number): bigint {
  return (
    BigInt(legCount) * (ATA_RENT_LAMPORTS + SIGNATURE_FEE_LAMPORTS) + PRIORITY_HEADROOM_LAMPORTS
  )
}

/**
 * Checks 7–12 and 15: everything decidable from configuration alone.
 * No network, no keypair, deterministic — which is what makes them testable.
 */
export function pureGates(facts: PureFacts = {}): Finding[] {
  const out: Finding[] = []
  const banned = facts.bannedAllocationKeys ?? ['investor', 'investors', 'seed', 'strategic', 'private', 'presale']

  // 7. Every destination explicitly configured.
  const unset = DESTINATIONS.filter((d) => !d.wallet).map((d) => d.key)
  out.push(
    unset.length
      ? fail(7, 'destinations configured', `not set: ${unset.join(', ')} — create the multisigs first`)
      : pass(7, 'destinations configured', 'all six destinations have an address'),
  )

  // 8. Destinations unique. Two buckets sharing a wallet cannot be audited apart.
  //
  // NOT VACUOUS. With every destination unset the duplicate scan trivially finds
  // nothing, and an earlier version of this check reported "destinations unique:
  // 0 distinct address(es)" — a PASS in a report where no destination exists at
  // all. A safety report that prints a tick for a property it could not evaluate
  // is worse than one that prints nothing. Uniqueness is only decidable once all
  // six are set, so anything less fails.
  const wallets = DESTINATIONS.map((d) => d.wallet).filter((w): w is string => !!w)
  const dupes = [...new Set(wallets.filter((w, i) => wallets.indexOf(w) !== i))]
  if (wallets.length !== DESTINATIONS.length) {
    out.push(
      fail(
        8,
        'destinations unique',
        `cannot be established: ${wallets.length} of ${DESTINATIONS.length} destinations are set`,
      ),
    )
  } else if (dupes.length) {
    out.push(fail(8, 'destinations unique', `duplicate address(es): ${dupes.join(', ')}`))
  } else {
    out.push(pass(8, 'destinations unique', `${wallets.length} distinct address(es)`))
  }

  // 9 + 10. Amounts integer-safe and summing to exactly the full supply.
  let legs: ReturnType<typeof migrationLegs> = []
  try {
    legs = migrationLegs()
    const allBigint = legs.every((l) => typeof l.amount === 'bigint')
    out.push(
      allBigint
        ? pass(9, 'amounts integer-safe', 'every leg amount is a bigint; no float arithmetic')
        : fail(9, 'amounts integer-safe', 'a leg amount is not a bigint'),
    )

    const sum = legs.reduce((a, l) => a + l.amount, 0n)
    const total = toBaseUnits(FURL.maxSupply)
    out.push(
      sum === total
        ? pass(10, 'allocation sums to 1B', `${sum} base units == ${total}`)
        : fail(10, 'allocation sums to 1B', `legs sum to ${sum}, expected exactly ${total}`),
    )
  } catch (e) {
    out.push(fail(9, 'amounts integer-safe', e instanceof Error ? e.message : String(e)))
    out.push(fail(10, 'allocation sums to 1B', 'could not compute legs'))
  }

  // 11. No investor bucket. None was ever minted; reintroducing one in config
  //     would silently restate published tokenomics.
  const offenders = DESTINATIONS.filter((d) =>
    banned.some((b) => d.key.toLowerCase().includes(b)),
  ).map((d) => d.key)
  out.push(
    offenders.length
      ? fail(11, 'no investor allocation', `found: ${offenders.join(', ')} — no such allocation exists on-chain`)
      : pass(11, 'no investor allocation', 'none present'),
  )

  // 12. Exactly the six known buckets, in the published order.
  const expectedKeys = ['community', 'liquidity', 'treasury', 'team', 'partnerships', 'reserve']
  const actualKeys = DESTINATIONS.map((d) => d.key)
  out.push(
    actualKeys.length === expectedKeys.length && expectedKeys.every((k, i) => actualKeys[i] === k)
      ? pass(12, 'exactly six known buckets', actualKeys.join(', '))
      : fail(12, 'exactly six known buckets', `got ${actualKeys.join(', ')}, expected ${expectedKeys.join(', ')}`),
  )

  // 15. No destination is the source.
  const selfSends = DESTINATIONS.filter((d) => d.wallet === DEPLOYER_PUBKEY).map((d) => d.key)
  out.push(
    selfSends.length
      ? fail(15, 'no destination is the source', `${selfSends.join(', ')} → the deployer itself; that is a no-op that looks like progress`)
      : pass(15, 'no destination is the source', 'no destination equals the deployer'),
  )

  return out
}

/**
 * Checks 1–6, 13, 14, 16: everything that requires reading mainnet.
 * Takes plain facts rather than a Connection so it stays unit-testable.
 */
export function chainGates(facts: ChainFacts): Finding[] {
  const out: Finding[] = []
  const legs = migrationLegs()
  const total = toBaseUnits(FURL.maxSupply)
  const sum = legs.reduce((a, l) => a + l.amount, 0n)

  // 1. The mint is the canonical FURL mint. A second mint address anywhere is
  //    a path to migrating the wrong token.
  out.push(
    MINT_ADDRESS === 'FYatJq71zqvaQNLLtbBy4hQcsV25dMATYfCSVBzV3gY1'
      ? pass(1, 'canonical mint', MINT_ADDRESS)
      : fail(1, 'canonical mint', `config mint ${MINT_ADDRESS} is not the launched FURL mint`),
  )

  // 2. Token-2022, asserted against the account owner, not assumed.
  if (facts.mintOwnerProgram === EXPECTED_TOKEN_PROGRAM) {
    out.push(pass(2, 'Token-2022 program', facts.mintOwnerProgram))
  } else if (facts.mintOwnerProgram === LEGACY_TOKEN_PROGRAM) {
    out.push(fail(2, 'Token-2022 program', 'mint is owned by the LEGACY SPL Token program'))
  } else {
    out.push(fail(2, 'Token-2022 program', `unexpected owning program ${facts.mintOwnerProgram}`))
  }

  // 3. Decimals. Wrong scale moves 1000x the intended amount.
  out.push(
    facts.decimals === FURL.decimals
      ? pass(3, 'decimals = 6', `${facts.decimals}`)
      : fail(3, 'decimals = 6', `chain reports ${facts.decimals}, config says ${FURL.decimals}`),
  )

  // 4. Total supply unchanged. A supply that grew means the mint authority was
  //    used since the plan was made, and every percentage is now wrong.
  out.push(
    facts.supplyBaseUnits === total
      ? pass(4, 'supply is exactly 1B', `${facts.supplyBaseUnits} base units`)
      : fail(4, 'supply is exactly 1B', `chain supply ${facts.supplyBaseUnits} != expected ${total} — allocations would no longer be the published percentages`),
  )

  // 5. Source owner is the expected deployer.
  out.push(
    facts.sourceOwner === DEPLOYER_PUBKEY
      ? pass(5, 'source owner is the deployer', facts.sourceOwner)
      : fail(5, 'source owner is the deployer', `source is owned by ${facts.sourceOwner}, expected ${DEPLOYER_PUBKEY}`),
  )

  // 6 + 13. Source holds exactly, and therefore sufficiently, what we plan to move.
  if (facts.sourceBalanceBaseUnits === sum) {
    out.push(pass(6, 'source balance is exact', `${facts.sourceBalanceBaseUnits} base units`))
    out.push(pass(13, 'sufficient FURL', 'source covers every leg'))
  } else {
    out.push(
      fail(6, 'source balance is exact', `source holds ${facts.sourceBalanceBaseUnits}, plan moves ${sum}`),
    )
    out.push(
      facts.sourceBalanceBaseUnits >= sum
        ? pass(13, 'sufficient FURL', 'source covers every leg, though the balance is not exactly the planned total')
        : fail(13, 'sufficient FURL', `short by ${sum - facts.sourceBalanceBaseUnits} base units — the migration would stop part-way`),
    )
  }

  // 14. SOL for fees and the six ATAs.
  const needed = requiredLamports(legs.length)
  out.push(
    facts.payerLamports >= needed
      ? pass(14, 'sufficient SOL', `${facts.payerLamports} lamports >= ${needed} required`)
      : fail(
          14,
          'sufficient SOL',
          `${facts.payerLamports} lamports available, ~${needed} needed ` +
            `(${legs.length} ATAs at ${ATA_RENT_LAMPORTS} rent + fees + priority headroom)`,
        ),
  )

  // 16. Destination accounts must not already be funded — that means either a
  //     partial prior run or an address in use, and both need a human.
  const funded = facts.destinationsAlreadyFunded ?? []
  out.push(
    funded.length === 0
      ? pass(16, 'destinations are empty', 'no destination already holds FURL')
      : fail(16, 'destinations are empty', `already funded: ${funded.join(', ')} — resolve manually rather than topping up`),
  )

  // Signer identity, when a keypair was loaded.
  if (facts.signerPubkey !== undefined) {
    out.push(
      facts.signerPubkey === DEPLOYER_PUBKEY
        ? pass(5, 'signer is the source owner', facts.signerPubkey)
        : fail(5, 'signer is the source owner', `keypair is ${facts.signerPubkey}, source owner is ${DEPLOYER_PUBKEY}`),
    )
  }

  return out
}

/** True only when every finding passed. */
export function allPassed(findings: readonly Finding[]): boolean {
  return findings.every((f) => f.severity === 'PASS')
}

/** The failures, for a caller that wants to print or throw. */
export function failures(findings: readonly Finding[]): Finding[] {
  return findings.filter((f) => f.severity === 'FAIL')
}
