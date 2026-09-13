/**
 * FURL/USDC liquidity PLANNER. Computes and prints a pool configuration.
 *
 *   npx tsx scripts/liquidity-plan.ts --usdc 25000 --furl 5000000
 *   npx tsx scripts/liquidity-plan.ts --usdc 10000 --price 0.005
 *
 * THIS SCRIPT CANNOT CREATE A POOL. There is no execute path, no keypair
 * loading, and no RPC write anywhere in this file — by construction, not by a
 * flag. Creating a pool is an irreversible, funds-moving act that needs explicit
 * approval and is done deliberately through the venue's own interface or SDK
 * after the numbers below have been reviewed.
 *
 * WHAT IT IS FOR: making the consequences of an initial price arithmetic instead
 * of vibes. The initial deposit ratio IS the opening price, and the opening price
 * times 1B is the headline number people will quote at you. A thin pool at a
 * flattering price is not a valuation; it is a number that can be moved by a
 * single trade, and publishing it as though it were a market price is the
 * dishonest part of most launches.
 *
 * Price impact below is exact constant-product math (x·y=k) against the pool you
 * are proposing — the real slippage a buyer would eat, not an estimate.
 */
import { FURL, MINT_ADDRESS, USDC, toBaseUnits } from '../src/config.ts'

const arg = (n: string) => {
  const i = process.argv.indexOf(`--${n}`)
  return i !== -1 ? process.argv[i + 1] : undefined
}
const num = (n: string, dflt?: number) => {
  const raw = arg(n)
  if (raw === undefined) return dflt
  const v = Number(raw)
  if (!Number.isFinite(v) || v <= 0) throw new Error(`--${n} must be a positive number`)
  return v
}

/** Exact constant-product output for an input trade, with a fee in bps. */
function swapOut(reserveIn: number, reserveOut: number, amountIn: number, feeBps: number): number {
  const inAfterFee = amountIn * (1 - feeBps / 10_000)
  return (reserveOut * inAfterFee) / (reserveIn + inAfterFee)
}

/** Price impact of a buy, as a percentage of the pre-trade price. */
function buyImpactPct(usdcReserve: number, furlReserve: number, usdcIn: number, feeBps: number) {
  const spot = usdcReserve / furlReserve
  const furlOut = swapOut(usdcReserve, furlReserve, usdcIn, feeBps)
  const effective = usdcIn / furlOut
  return { furlOut, effective, impactPct: ((effective - spot) / spot) * 100 }
}

function main() {
  const usdc = num('usdc', 25_000)!
  const priceArg = num('price')
  const furl = priceArg ? usdc / priceArg : num('furl', 5_000_000)!
  const feeBps = num('fee-bps', 25)! // Raydium CPMM / Orca standard tier

  const price = usdc / furl
  const totalSupply = Number(FURL.maxSupply)
  const fdv = price * totalSupply
  const poolShareOfSupply = (furl / totalSupply) * 100

  console.log('FURL/USDC initial liquidity — PROPOSAL ONLY (nothing is created)')
  console.log('═'.repeat(74))
  console.log('')
  console.log('Pair')
  console.log(`  FURL mint          ${MINT_ADDRESS}  (Token-2022, ${FURL.decimals}dp)`)
  console.log(`  USDC mint          ${USDC.solanaMainnet}  (legacy SPL, 6dp)`)
  console.log('')
  console.log('Deposit')
  console.log(`  USDC               ${usdc.toLocaleString('en-US')}`)
  console.log(`  FURL               ${furl.toLocaleString('en-US')}`)
  console.log(`  FURL base units    ${toBaseUnits(BigInt(Math.trunc(furl)))}`)
  console.log(`  pool fee tier      ${feeBps} bps`)
  console.log('')
  console.log('Implied opening numbers')
  console.log(`  price              $${price.toPrecision(6)} per FURL`)
  console.log(`  FDV (price × 1B)   $${Math.round(fdv).toLocaleString('en-US')}`)
  console.log(`  pool holds         ${poolShareOfSupply.toFixed(3)}% of total supply`)
  console.log(`  depth one side     $${usdc.toLocaleString('en-US')} — this is the whole USDC float`)
  console.log('')

  console.log('Price impact (exact x·y=k, including the pool fee)')
  console.log('  buy size      FURL out        effective price    impact')
  for (const size of [100, 500, 1_000, 5_000, 10_000, 25_000].filter((s) => s <= usdc * 4)) {
    const r = buyImpactPct(usdc, furl, size, feeBps)
    console.log(
      `  $${String(size).padStart(7)}   ${r.furlOut.toFixed(2).padStart(14)}   ` +
        `$${r.effective.toPrecision(6).padStart(14)}   ${r.impactPct.toFixed(2).padStart(7)}%`,
    )
  }
  console.log('')
  console.log('  Read the bottom row before choosing a price. If a single mid-size buy moves the')
  console.log('  quote double digits, the "price" this pool produces is not a market price, and')
  console.log('  the FDV above should never be published as a valuation.')
  console.log('')

  console.log('Venues — Token-2022 compatibility (verified 2026-09-13)')
  console.log('  Raydium CPMM   Token-2022 supported. The modern standard and cheaper than AMM v4.')
  console.log('                 ~0.2 SOL for pool rent + token accounts + priority fees.')
  console.log('                 Source: docs.raydium.io/user-flows/create-cpmm-pool')
  console.log('  Orca Whirlpool Token-2022 supported. MetadataPointer + TokenMetadata are on the')
  console.log('                 SUPPORTED list and need NO Token Badge — which is exactly and only')
  console.log('                 what FURL enables. Concentrated liquidity, so the same capital')
  console.log('                 gives far better depth inside a chosen range.')
  console.log('                 Source: docs.orca.so/create/pools/extensions')
  console.log('  Meteora        DAMM v2 (constant product, configurable fees) and DLMM. Routed by')
  console.log('                 Jupiter. Token-2022 supported.')
  console.log('  Jupiter        Aggregates all three; indexes the pair once a pool exists with')
  console.log('                 real liquidity. No application needed for routing itself.')
  console.log('')
  console.log('  FURL enables ONLY metadataPointer + tokenMetadata. No transfer fee, no transfer')
  console.log('  hook, no permanent delegate, no default-frozen state, and freeze authority is')
  console.log('  null. That is the configuration every venue above accepts without review — the')
  console.log('  extensions that trigger a badge or a block are the ones FURL deliberately omits.')
  console.log('')

  console.log('LP custody — decide BEFORE creating anything')
  console.log('  owner          the liquidity multisig from src/treasury.ts, NOT the deployer key.')
  console.log('                 An LP position on a single key means liquidity can be pulled by one')
  console.log('                 signature, which is the definition of the risk holders fear.')
  console.log('  locking        a lock makes "cannot be pulled" verifiable instead of promised.')
  console.log('                 Locking is itself irreversible for the lock duration — read the')
  console.log('                 specific locker contract before using it, and prefer a published')
  console.log('                 multisig over a lock you do not understand.')
  console.log('  disclosure     publish the pool address and LP owner on /token once it exists, so')
  console.log('                 the custody claim is checkable.')
  console.log('')

  console.log('Costs')
  console.log(`  pool creation      ~0.2 SOL (Raydium CPMM: rent + token accounts + priority fees)`)
  console.log(`  capital at risk    ${usdc.toLocaleString('en-US')} USDC + ${furl.toLocaleString('en-US')} FURL`)
  console.log(`  impermanent loss   any FURL price move away from $${price.toPrecision(6)} costs the LP`)
  console.log('')

  console.log('What is NOT part of this plan, and must never be')
  console.log('  * no wash trading, no self-trading, no volume manufacturing')
  console.log('  * no splitting the treasury across wallets to disguise concentration')
  console.log('  * no price chosen to make FDV look large')
  console.log('  * no announcement of a listing, partnership or audit that does not exist')
  console.log('')
  console.log('[CREATES A POOL / MOVES REAL FUNDS — APPROVAL REQUIRED]')
  console.log('This script printed numbers. It did not and cannot create a pool.')
}

main()
