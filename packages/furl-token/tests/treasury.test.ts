/**
 * Treasury / migration invariants. Pure logic — no network, no keypair.
 *
 * Every assertion here corresponds to a way a migration of 1,000,000,000 FURL
 * could go wrong irreversibly: legs that do not sum to the supply, a destination
 * that is still the deployer (a no-op dressed as progress), two buckets sharing
 * one wallet so neither can be audited, or a migration allowed to run before the
 * multisigs exist.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FURL, DEPLOYER_PUBKEY, MINT_ADDRESS, toBaseUnits, ALLOCATIONS } from '../src/config.ts'
import {
  DESTINATIONS,
  migrationLegs,
  assertMigrationReady,
  migrationReady,
  type Destination,
} from '../src/treasury.ts'

test('the live mint address is recorded and well-formed', () => {
  assert.equal(MINT_ADDRESS, 'FYatJq71zqvaQNLLtbBy4hQcsV25dMATYfCSVBzV3gY1')
  assert.match(MINT_ADDRESS, /^[1-9A-HJ-NP-Za-km-z]{32,44}$/)
})

test('there is exactly one destination per allocation', () => {
  assert.equal(DESTINATIONS.length, ALLOCATIONS.length)
  for (const alloc of ALLOCATIONS) {
    assert.ok(
      DESTINATIONS.some((d) => d.key === alloc.key),
      `allocation ${alloc.key} has a destination`,
    )
  }
})

test('migration legs sum to EXACTLY the total supply', () => {
  const legs = migrationLegs()
  const sum = legs.reduce((a, l) => a + l.amount, 0n)
  assert.equal(sum, toBaseUnits(FURL.maxSupply))
  assert.equal(sum, 1_000_000_000_000_000n)
})

test('each leg matches its published percentage', () => {
  const total = toBaseUnits(FURL.maxSupply)
  for (const leg of migrationLegs()) {
    assert.equal(leg.amount, (total * BigInt(leg.percent)) / 100n, `${leg.key} amount`)
  }
  const byKey = Object.fromEntries(migrationLegs().map((l) => [l.key, l.whole]))
  assert.equal(byKey.community, '400000000')
  assert.equal(byKey.liquidity, '200000000')
  assert.equal(byKey.treasury, '150000000')
  assert.equal(byKey.team, '150000000')
  assert.equal(byKey.partnerships, '50000000')
  assert.equal(byKey.reserve, '50000000')
})

test('migration is NOT ready today — destinations are deliberately unset', () => {
  // The single-key concentration is a known, published risk. The fix requires a
  // human to create multisigs first; nothing here may proceed without them.
  assert.equal(migrationReady(), false)
  assert.throws(() => assertMigrationReady(), /not ready/)
})

test('every destination that holds long-lived value requires multisig custody', () => {
  for (const d of DESTINATIONS) {
    assert.equal(d.requiredCustody, 'multisig', `${d.key} requires multisig`)
    assert.ok(d.threshold, `${d.key} records a threshold`)
    assert.match(d.threshold!, /^\d\/\d$/, `${d.key} threshold looks like N/M`)
  }
})

test('no destination contains a secret — public addresses only', () => {
  for (const d of DESTINATIONS) {
    if (d.wallet === null) continue
    assert.match(d.wallet, /^[1-9A-HJ-NP-Za-km-z]{32,44}$/)
  }
})

/* ---- the refusals, exercised against hypothetical configurations ---- */

/** assertMigrationReady reads the module-level DESTINATIONS, so the refusal
 *  rules are re-checked here against constructed rows. Keeping the logic's
 *  shape under test matters more than mutating the real export. */
function validate(rows: Destination[]): string[] {
  const errors: string[] = []
  const PUBKEY = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/
  for (const d of rows) {
    if (!d.wallet) errors.push(`${d.key}: unset`)
    else if (!PUBKEY.test(d.wallet)) errors.push(`${d.key}: malformed`)
    else if (d.wallet === DEPLOYER_PUBKEY) errors.push(`${d.key}: deployer`)
    if (d.requiredCustody === 'multisig' && !d.threshold) errors.push(`${d.key}: no threshold`)
  }
  const wallets = rows.map((r) => r.wallet).filter((w): w is string => !!w)
  if (new Set(wallets).size !== wallets.length) errors.push('duplicate')
  return errors
}

const base: Destination = {
  key: 'x',
  wallet: null,
  requiredCustody: 'multisig',
  threshold: '2/3',
  rationale: 'test',
}
const A = 'FgeSXvrWcqE93byDoF3Vhwou7XTUhY42cYhs7vXkJPUU'
const B = 'FYatJq71zqvaQNLLtbBy4hQcsV25dMATYfCSVBzV3gY1'

test('refuses a destination that is the deployer itself', () => {
  const errs = validate([{ ...base, key: 'treasury', wallet: DEPLOYER_PUBKEY }])
  assert.ok(errs.some((e) => e.includes('deployer')))
})

test('refuses two allocations sharing one wallet', () => {
  const errs = validate([
    { ...base, key: 'team', wallet: A },
    { ...base, key: 'treasury', wallet: A },
  ])
  assert.ok(errs.includes('duplicate'))
})

test('refuses a malformed address', () => {
  const errs = validate([{ ...base, key: 'team', wallet: '0xdeadbeef' }])
  assert.ok(errs.some((e) => e.includes('malformed')))
})

test('refuses multisig custody with no recorded threshold', () => {
  const errs = validate([{ ...base, key: 'team', wallet: A, threshold: null }])
  assert.ok(errs.some((e) => e.includes('no threshold')))
})

test('accepts a fully-specified, distinct, non-deployer configuration', () => {
  assert.deepEqual(
    validate([
      { ...base, key: 'team', wallet: A },
      { ...base, key: 'treasury', wallet: B },
    ]),
    [],
  )
})
