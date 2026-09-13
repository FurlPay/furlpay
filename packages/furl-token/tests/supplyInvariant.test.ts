/**
 * Cross-chain supply reconciliation.
 *
 * Every test is a way a bridged token ends up with more supply than anything
 * backs it. The reconciler is asserted to call that a BREACH — detecting it is
 * the entire purpose, and a checker that stays quiet is worse than none because
 * its silence is read as assurance.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  reconcileSupply,
  crossChainCirculating,
  formatFurl,
  TOTAL_SUPPLY_BASE_UNITS,
  type SpokeSupply,
  type HubState,
} from '../src/supplyInvariant.ts'

const FURL = (whole: bigint) => whole * 1_000_000n
const TOTAL = TOTAL_SUPPLY_BASE_UNITS

const spoke = (chain: string, supply: bigint, decimals = 6): SpokeSupply => ({
  chain,
  token: '0x0000000000000000000000000000000000000001',
  supplyBaseUnits: supply,
  decimals,
})

const hub = (locked: bigint, mintSupply = TOTAL): HubState => ({
  mintSupplyBaseUnits: mintSupply,
  lockedBaseUnits: locked,
})

const sev = (r: ReturnType<typeof reconcileSupply>, check: string) =>
  r.findings.find((f) => f.check === check)?.severity

test('today: nothing locked, no spokes, invariant holds', () => {
  // The current state — no bridge exists at all.
  const r = reconcileSupply(hub(0n), [])
  assert.equal(r.holds, true)
  assert.equal(r.totalSpokeSupply, 0n)
  assert.equal(r.unbacked, 0n)
})

test('balanced bridge: spoke supply exactly equals locked', () => {
  const r = reconcileSupply(hub(FURL(50_000_000n)), [
    spoke('Arbitrum One', FURL(30_000_000n)),
    spoke('Base', FURL(20_000_000n)),
  ])
  assert.equal(r.holds, true)
  assert.equal(r.unbacked, 0n)
  assert.equal(sev(r, 'spoke supply == locked'), 'OK')
})

test('BREACH: a spoke minted FURL with nothing locked behind it', () => {
  // The shape of every bridge exploit: spoke supply exceeds the lockbox.
  const r = reconcileSupply(hub(FURL(30_000_000n)), [
    spoke('Arbitrum One', FURL(30_000_000n)),
    spoke('Base', FURL(5_000_000n)), // unbacked
  ])
  assert.equal(r.holds, false)
  assert.equal(r.unbacked, FURL(5_000_000n))
  assert.equal(sev(r, 'spoke supply == locked'), 'BREACH')
  const f = r.findings.find((x) => x.check === 'spoke supply == locked')!
  assert.match(f.detail, /NOTHING locked behind it/)
})

test('BREACH is caught even when one base unit is unbacked', () => {
  const r = reconcileSupply(hub(FURL(1n)), [spoke('Base', FURL(1n) + 1n)])
  assert.equal(r.holds, false)
  assert.equal(r.unbacked, 1n)
})

test('WARN (not breach) when locked exceeds spoke supply — transfer in flight', () => {
  // Tokens locked before the destination mint landed. Not an exploit, but it
  // must be explained if it persists.
  const r = reconcileSupply(hub(FURL(10_000_000n)), [spoke('Base', FURL(9_000_000n))])
  assert.equal(r.holds, true, 'in-flight is not a breach')
  assert.equal(sev(r, 'spoke supply == locked'), 'WARN')
  assert.equal(r.unbacked, -FURL(1_000_000n))
})

test('BREACH: a spoke reports 18 decimals against a 6-decimal hub', () => {
  // Mis-scales every bridged amount by 10^12 while looking entirely normal.
  const r = reconcileSupply(hub(FURL(1_000n)), [spoke('Ethereum', FURL(1_000n), 18)])
  assert.equal(r.holds, false)
  assert.equal(sev(r, 'Ethereum decimals'), 'BREACH')
  assert.match(r.findings.find((f) => f.check === 'Ethereum decimals')!.detail, /10\^12/)
})

test('BREACH: the canonical supply on Solana changed', () => {
  // Means the mint authority was used; every bridged balance is now measured
  // against the wrong total.
  const r = reconcileSupply(hub(0n, TOTAL + FURL(1n)), [])
  assert.equal(r.holds, false)
  assert.equal(sev(r, 'canonical supply'), 'BREACH')
})

test('BREACH: a single spoke holds more than the entire supply', () => {
  const r = reconcileSupply(hub(TOTAL), [spoke('Base', TOTAL + 1n)])
  assert.equal(r.holds, false)
  assert.ok(r.findings.some((f) => f.check === 'Base supply sanity' && f.severity === 'BREACH'))
})

test('BREACH: more locked than the cap allows', () => {
  const r = reconcileSupply(hub(TOTAL + 1n), [spoke('Base', TOTAL + 1n)])
  assert.equal(r.holds, false)
  assert.equal(sev(r, 'locked within cap'), 'BREACH')
})

test('the full supply can be bridged out without breaching', () => {
  const r = reconcileSupply(hub(TOTAL), [
    spoke('Arbitrum One', FURL(400_000_000n)),
    spoke('Base', FURL(350_000_000n)),
    spoke('Ethereum', FURL(250_000_000n)),
  ])
  assert.equal(r.holds, true)
  assert.equal(r.totalSpokeSupply, TOTAL)
  assert.equal(r.unbacked, 0n)
})

/* ---- circulating supply across chains ---- */

test('locked FURL is not double-counted as circulating', () => {
  // Counting both the locked hub tokens AND their spoke representation would
  // report twice the float that exists.
  const circulating = crossChainCirculating({
    hub: hub(FURL(50_000_000n)),
    spokes: [spoke('Arbitrum One', FURL(50_000_000n))],
    issuerHeldBaseUnits: FURL(900_000_000n),
  })
  // 1B total - 50M locked - 900M issuer-held = 50M on Solana, + 50M on spoke.
  assert.equal(circulating, FURL(100_000_000n))
})

test('today: everything issuer-held, nothing bridged, circulating is 0', () => {
  const circulating = crossChainCirculating({
    hub: hub(0n),
    spokes: [],
    issuerHeldBaseUnits: TOTAL,
  })
  assert.equal(circulating, 0n)
})

test('circulating never goes negative', () => {
  const circulating = crossChainCirculating({
    hub: hub(0n),
    spokes: [],
    issuerHeldBaseUnits: TOTAL + FURL(1n),
  })
  assert.equal(circulating, 0n)
})

test('formatFurl is exact at the full supply and past MAX_SAFE_INTEGER', () => {
  assert.equal(formatFurl(TOTAL), '1,000,000,000')
  assert.equal(formatFurl(1_500_000n), '1.5')
  assert.equal(formatFurl(1n), '0.000001')
  assert.equal(formatFurl(9_007_199_254_740_993n), '9,007,199,254.740993')
})
