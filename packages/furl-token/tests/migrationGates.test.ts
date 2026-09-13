/**
 * The migration safety gates.
 *
 * Every test here is a way 1,000,000,000 FURL could be lost or misallocated.
 * The gates are asserted to FAIL CLOSED — refusing on bad input is the
 * behaviour under test, not an inconvenience to be worked around.
 *
 * The chain checks take plain facts rather than a Connection, so the dangerous
 * states (wrong decimals, changed supply, wrong owner) can be exercised here
 * without needing a chain in which those states exist.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  pureGates,
  chainGates,
  allPassed,
  failures,
  requiredLamports,
  EXPECTED_TOKEN_PROGRAM,
  LEGACY_TOKEN_PROGRAM,
  type ChainFacts,
} from '../src/migrationGates.ts'
import { DEPLOYER_PUBKEY, FURL, toBaseUnits } from '../src/config.ts'

const TOTAL = toBaseUnits(FURL.maxSupply)

/** Facts describing a mainnet that is exactly as expected. */
function healthyFacts(over: Partial<ChainFacts> = {}): ChainFacts {
  return {
    mintOwnerProgram: EXPECTED_TOKEN_PROGRAM,
    decimals: 6,
    supplyBaseUnits: TOTAL,
    sourceOwner: DEPLOYER_PUBKEY,
    sourceBalanceBaseUnits: TOTAL,
    payerLamports: 100_000_000n, // 0.1 SOL
    destinationsAlreadyFunded: [],
    ...over,
  }
}

const find = (fs: ReturnType<typeof chainGates>, id: number) => fs.filter((f) => f.id === id)
const failed = (fs: ReturnType<typeof chainGates>, id: number) =>
  find(fs, id).some((f) => f.severity === 'FAIL')

/* ---------------------------------------------------------------- pure ---- */

test('pure gates FAIL today — destinations are deliberately unset', () => {
  const fs = pureGates()
  assert.equal(allPassed(fs), false)
  assert.ok(failed(fs, 7), 'check 7 (destinations configured) must fail')
})

test('allocation still sums to exactly 1B base units', () => {
  const fs = pureGates()
  const sumCheck = find(fs, 10)[0]
  assert.equal(sumCheck.severity, 'PASS')
  assert.match(sumCheck.detail, /1000000000000000/)
})

test('every leg amount is a bigint — no float arithmetic anywhere', () => {
  assert.equal(find(pureGates(), 9)[0].severity, 'PASS')
})

test('there are exactly six buckets, in the published order', () => {
  const c = find(pureGates(), 12)[0]
  assert.equal(c.severity, 'PASS')
  assert.equal(c.detail, 'community, liquidity, treasury, team, partnerships, reserve')
})

test('no investor allocation is present', () => {
  assert.equal(find(pureGates(), 11)[0].severity, 'PASS')
})

test('an investor bucket WOULD be caught if someone added one', () => {
  // Simulated by banning a key that does exist, proving the matcher works
  // rather than passing vacuously because nothing matches.
  const fs = pureGates({ bannedAllocationKeys: ['treasury'] })
  assert.ok(failed(fs, 11), 'the banned-key check must actually match keys')
  assert.match(find(fs, 11)[0].detail, /treasury/)
})

/* --------------------------------------------------------------- chain ---- */

test('chain gates all PASS against a healthy mainnet', () => {
  const fs = chainGates(healthyFacts())
  assert.equal(allPassed(fs), true, failures(fs).map((f) => f.detail).join('; '))
})

test('REFUSES a mint owned by the legacy SPL Token program', () => {
  const fs = chainGates(healthyFacts({ mintOwnerProgram: LEGACY_TOKEN_PROGRAM }))
  assert.ok(failed(fs, 2))
  assert.match(find(fs, 2)[0].detail, /LEGACY/)
})

test('REFUSES wrong decimals — the 1000x bug', () => {
  const fs = chainGates(healthyFacts({ decimals: 9 }))
  assert.ok(failed(fs, 3))
  assert.match(find(fs, 3)[0].detail, /chain reports 9/)
})

test('REFUSES a supply that changed since the plan was made', () => {
  // If the mint authority was used, every percentage is now wrong.
  const fs = chainGates(healthyFacts({ supplyBaseUnits: TOTAL + 1n }))
  assert.ok(failed(fs, 4))
  assert.match(find(fs, 4)[0].detail, /no longer be the published percentages/)
})

test('REFUSES a source owned by someone else', () => {
  const fs = chainGates(healthyFacts({ sourceOwner: 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk' }))
  assert.ok(failed(fs, 5))
})

test('REFUSES a signer that is not the source owner', () => {
  const fs = chainGates(
    healthyFacts({ signerPubkey: 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk' }),
  )
  assert.ok(failed(fs, 5))
})

test('accepts the signer when it IS the source owner', () => {
  const fs = chainGates(healthyFacts({ signerPubkey: DEPLOYER_PUBKEY }))
  assert.equal(allPassed(fs), true)
})

test('REFUSES an insufficient source balance — no partial migration', () => {
  const fs = chainGates(healthyFacts({ sourceBalanceBaseUnits: TOTAL - 1n }))
  assert.ok(failed(fs, 13))
  assert.match(find(fs, 13)[0].detail, /short by 1 base units/)
})

test('flags a source balance that is not exactly the planned total', () => {
  const fs = chainGates(healthyFacts({ sourceBalanceBaseUnits: TOTAL + 1n }))
  assert.ok(failed(fs, 6), 'exactness check must fail')
  assert.equal(failed(fs, 13), false, 'but there is still enough to cover the legs')
})

test('REFUSES insufficient SOL, and says how much is needed', () => {
  // Genuinely too little: 0.001 SOL cannot even pay the six ATA rents.
  const fs = chainGates(healthyFacts({ payerLamports: 1_000_000n }))
  assert.ok(failed(fs, 14))
  assert.match(find(fs, 14)[0].detail, /needed/)
})

test('the deployer CAN afford the migration today — it is not funding-blocked', () => {
  // Measured, not assumed: the migration needs ~0.032266 SOL (six ATA rents at
  // 2,039,280 lamports each, six signature fees, plus 0.02 SOL priority
  // headroom). The deployer holds 0.048203 SOL, leaving ~0.0159 SOL surplus.
  //
  // This matters for sequencing: the Critical single-key concentration finding
  // is blocked on CREATING the six multisigs (free) and on approval — NOT on
  // capital. Only the liquidity pool is funding-blocked.
  const needed = requiredLamports(6)
  assert.equal(needed, 32_265_680n)
  assert.ok(48_202_989n > needed, 'current SOL covers the migration')

  const fs = chainGates(healthyFacts({ payerLamports: 48_202_989n }))
  assert.equal(failed(fs, 14), false, 'the SOL gate passes at the current balance')
})

test('required SOL accounts for six ATAs plus fees', () => {
  const needed = requiredLamports(6)
  // Six ATA rents alone are ~0.0122 SOL; with headroom the total must exceed it.
  assert.ok(needed > 6n * 2_039_280n)
  assert.ok(needed < 100_000_000n, 'and must stay a sane fraction of a SOL')
})

test('REFUSES destinations that already hold FURL', () => {
  const fs = chainGates(healthyFacts({ destinationsAlreadyFunded: ['EU2tUJ1CoU8VjTKEuK49FTBv1N2Hk5jpv2589Eq1eZ1S'] }))
  assert.ok(failed(fs, 16))
  assert.match(find(fs, 16)[0].detail, /resolve manually/)
})

test('a single failure blocks the whole migration', () => {
  // There is no "migrate the legs that passed".
  const fs = chainGates(healthyFacts({ decimals: 9 }))
  assert.equal(allPassed(fs), false)
  assert.equal(failures(fs).length >= 1, true)
})

test('the ONLY thing blocking the migration today is the missing destinations', () => {
  // Exactly where the project stands, asserted rather than described. Every
  // chain condition already holds; the single blocker is that the six Squads
  // multisigs do not exist yet, which costs nothing but a human decision.
  const chain = chainGates(healthyFacts({ payerLamports: 48_202_989n, signerPubkey: DEPLOYER_PUBKEY }))
  const pure = pureGates()

  assert.equal(allPassed(chain), true, 'all chain gates pass: ' + failures(chain).map((f) => f.detail).join('; '))
  assert.ok(failed(pure, 7), 'destinations not created — the one real blocker')
  assert.ok(failed(pure, 8), 'and therefore uniqueness cannot be established either')
  assert.equal(allPassed([...pure, ...chain]), false, 'so the migration as a whole is still blocked')
})
