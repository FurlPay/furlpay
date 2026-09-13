import { FURL, toBaseUnits } from './config.ts'

/**
 * Cross-chain supply reconciliation for a hub-and-spoke FURL bridge.
 *
 * THE CLAIM THIS EXISTS TO CHECK. A lockbox bridge says: FURL locked on Solana
 * equals FURL minted across every EVM spoke, and the two together never exceed
 * 1,000,000,000. That is an architectural promise, and an architectural promise
 * nobody measures is a belief.
 *
 *     solanaCirculating + solanaLocked == TOTAL_SUPPLY
 *     sum(spokeSupplies)               == solanaLocked
 *
 * WHY IT MATTERS MORE THAN IT LOOKS. Every bridge exploit of the last few years
 * ends in the same place: tokens minted on a spoke that no locked balance backs.
 * The mint looks ordinary, the spoke's own accounting is self-consistent, and
 * the only thing that ever reveals it is comparing the two sides. This module is
 * that comparison, written before the bridge exists so it cannot be written
 * afterwards to match whatever the bridge happens to be doing.
 *
 * INTEGER ONLY. Balances are bigint base units end to end; a float comparison
 * would start agreeing with itself somewhere above 9,007 FURL.
 */

/** 1,000,000,000 FURL in base units — the canonical cap. */
export const TOTAL_SUPPLY_BASE_UNITS = toBaseUnits(FURL.maxSupply)

export interface SpokeSupply {
  /** Human-readable chain name, e.g. "Arbitrum One". */
  readonly chain: string
  /** The CanonicalFURL contract address on that chain. */
  readonly token: string
  /** `totalSupply()` in base units. */
  readonly supplyBaseUnits: bigint
  /** Decimals the spoke contract reports. MUST be 6. */
  readonly decimals: number
}

export interface HubState {
  /** Solana mint total supply, base units. Must equal the canonical cap. */
  readonly mintSupplyBaseUnits: bigint
  /** FURL held by the bridge lockbox vault on Solana. */
  readonly lockedBaseUnits: bigint
}

export type Severity = 'OK' | 'WARN' | 'BREACH'

export interface InvariantFinding {
  readonly check: string
  readonly severity: Severity
  readonly detail: string
}

export interface ReconciliationResult {
  readonly findings: InvariantFinding[]
  readonly holds: boolean
  readonly totalSpokeSupply: bigint
  /** spokeSupply - locked. Positive means unbacked FURL exists on spokes. */
  readonly unbacked: bigint
}

const ok = (check: string, detail: string): InvariantFinding => ({ check, severity: 'OK', detail })
const warn = (check: string, detail: string): InvariantFinding => ({ check, severity: 'WARN', detail })
const breach = (check: string, detail: string): InvariantFinding => ({ check, severity: 'BREACH', detail })

/** Whole-token string from base units. Integer math only. */
export function formatFurl(base: bigint): string {
  const scale = 10n ** BigInt(FURL.decimals)
  const whole = base / scale
  const frac = base % scale
  if (frac === 0n) return whole.toLocaleString('en-US')
  return `${whole.toLocaleString('en-US')}.${frac.toString().padStart(FURL.decimals, '0').replace(/0+$/, '')}`
}

/**
 * Reconcile the hub against every spoke.
 *
 * Takes plain values rather than RPC clients so the dangerous states — a spoke
 * minting more than is locked, a spoke with wrong decimals — can be exercised
 * in tests without needing chains in which those states exist.
 */
export function reconcileSupply(hub: HubState, spokes: readonly SpokeSupply[]): ReconciliationResult {
  const findings: InvariantFinding[] = []

  // 1. The mint itself still holds the canonical supply. If this moved, the
  //    mint authority was used and every downstream number is stale.
  findings.push(
    hub.mintSupplyBaseUnits === TOTAL_SUPPLY_BASE_UNITS
      ? ok('canonical supply', `${formatFurl(hub.mintSupplyBaseUnits)} FURL`)
      : breach(
          'canonical supply',
          `Solana mint reports ${formatFurl(hub.mintSupplyBaseUnits)} FURL, expected ${formatFurl(TOTAL_SUPPLY_BASE_UNITS)}. ` +
            `The cap has changed — every bridged balance is now measured against the wrong total.`,
        ),
  )

  // 2. Every spoke must be 6-decimal. An 18-decimal spoke against a 6-decimal
  //    hub mis-scales by 10^12 while looking entirely normal.
  for (const spoke of spokes) {
    findings.push(
      spoke.decimals === FURL.decimals
        ? ok(`${spoke.chain} decimals`, `${spoke.decimals}`)
        : breach(
            `${spoke.chain} decimals`,
            `reports ${spoke.decimals} decimals, hub is ${FURL.decimals}. Bridged amounts are wrong by 10^${Math.abs(spoke.decimals - FURL.decimals)}.`,
          ),
    )
  }

  // 3. No spoke may individually exceed the cap.
  for (const spoke of spokes) {
    if (spoke.supplyBaseUnits > TOTAL_SUPPLY_BASE_UNITS) {
      findings.push(
        breach(
          `${spoke.chain} supply sanity`,
          `holds ${formatFurl(spoke.supplyBaseUnits)} FURL, more than the entire canonical supply.`,
        ),
      )
    }
  }

  // 4. THE INVARIANT: spoke supply must equal what is locked on the hub.
  const totalSpokeSupply = spokes.reduce((a, s) => a + s.supplyBaseUnits, 0n)
  const unbacked = totalSpokeSupply - hub.lockedBaseUnits

  if (unbacked === 0n) {
    findings.push(
      ok('spoke supply == locked', `${formatFurl(totalSpokeSupply)} FURL on ${spokes.length} spoke(s)`),
    )
  } else if (unbacked > 0n) {
    findings.push(
      breach(
        'spoke supply == locked',
        `${formatFurl(unbacked)} FURL exists on spokes with NOTHING locked behind it. ` +
          `spokes=${formatFurl(totalSpokeSupply)} locked=${formatFurl(hub.lockedBaseUnits)}. ` +
          `This is the shape every bridge exploit takes.`,
      ),
    )
  } else {
    // Locked exceeds minted. Not an exploit — usually a transfer in flight, or
    // tokens locked before the destination mint landed. Still must be explained.
    findings.push(
      warn(
        'spoke supply == locked',
        `${formatFurl(-unbacked)} FURL locked with no spoke supply behind it. ` +
          `Expected briefly during an in-flight transfer; investigate if it persists.`,
      ),
    )
  }

  // 5. Locked can never exceed the cap.
  findings.push(
    hub.lockedBaseUnits <= TOTAL_SUPPLY_BASE_UNITS
      ? ok('locked within cap', `${formatFurl(hub.lockedBaseUnits)} FURL locked`)
      : breach(
          'locked within cap',
          `${formatFurl(hub.lockedBaseUnits)} FURL locked exceeds the ${formatFurl(TOTAL_SUPPLY_BASE_UNITS)} cap.`,
        ),
  )

  return {
    findings,
    holds: !findings.some((f) => f.severity === 'BREACH'),
    totalSpokeSupply,
    unbacked,
  }
}

/** Circulating supply across all chains: total minus locked minus issuer-held. */
export function crossChainCirculating(params: {
  readonly hub: HubState
  readonly spokes: readonly SpokeSupply[]
  /** Issuer-controlled FURL on Solana (treasury, team, undistributed). */
  readonly issuerHeldBaseUnits: bigint
}): bigint {
  const { hub, spokes, issuerHeldBaseUnits } = params

  // Locked FURL is NOT circulating on Solana — its spoke representation is.
  // Counting both would double-count every bridged token.
  const solanaCirculating =
    hub.mintSupplyBaseUnits - hub.lockedBaseUnits - issuerHeldBaseUnits
  const spokeCirculating = spokes.reduce((a, s) => a + s.supplyBaseUnits, 0n)

  const total = solanaCirculating + spokeCirculating
  return total > 0n ? total : 0n
}
