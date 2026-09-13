/**
 * Prepare (and, only with explicit approval, execute) the migration of FURL
 * from the single deployer account into the six separated allocation wallets.
 *
 *   # dry run — the default, and the only thing that runs without flags
 *   npx tsx scripts/migrate-allocations.ts --cluster mainnet-beta
 *
 *   # execute: needs EVERY destination set in src/treasury.ts, a keypair, and
 *   # both acknowledgement flags
 *   FURL_KEYPAIR=~/.config/solana/furlpay-deployer.json \
 *   npx tsx scripts/migrate-allocations.ts --cluster mainnet-beta --execute \
 *     --i-understand-this-moves-real-funds
 *
 * WHAT A DRY RUN GIVES YOU: every leg with its exact base-unit amount, the
 * derived destination token accounts, the expected post-migration balance of
 * every account including the deployer, the rent cost, and — when an RPC is
 * reachable — the CURRENT on-chain balance so you can confirm the source
 * actually holds what the plan assumes. It prints a serialized unsigned
 * transaction per leg so the instructions can be inspected before anyone signs.
 *
 * WHY ONE TRANSACTION PER LEG rather than one atomic transaction: six
 * transferChecked instructions plus six idempotent ATA creations comfortably
 * fit a single transaction today, but an all-or-nothing migration that fails
 * mid-flight on a transient RPC error leaves you guessing which state you are
 * in. Per-leg transactions are individually idempotent-ish (re-running after a
 * partial success would double-send, which is why the script re-reads balances
 * and refuses a leg whose destination already holds its full amount).
 *
 * THIS SCRIPT NEVER: creates a wallet, funds a wallet, revokes an authority, or
 * touches liquidity. It moves existing FURL to addresses you have already
 * created and pasted into src/treasury.ts.
 */
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
  clusterApiUrl,
} from '@solana/web3.js'
import {
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getMint,
  getAccount,
} from '@solana/spl-token'
import { readFileSync } from 'node:fs'
import { FURL, MINT_ADDRESS, DEPLOYER_PUBKEY, toBaseUnits, type Cluster } from '../src/config.ts'
import { DESTINATIONS, migrationLegs, assertMigrationReady } from '../src/treasury.ts'

const flag = (n: string) => process.argv.includes(`--${n}`)
const arg = (n: string) => {
  const i = process.argv.indexOf(`--${n}`)
  return i !== -1 ? process.argv[i + 1] : undefined
}

const cluster = (arg('cluster') || 'mainnet-beta') as Cluster
const execute = flag('execute')

function loadKeypair(): Keypair {
  const path = process.env.FURL_KEYPAIR
  if (!path) throw new Error('set FURL_KEYPAIR to a keypair file path (never commit it)')
  const home = process.env.HOME || process.env.USERPROFILE || ''
  const secret = JSON.parse(readFileSync(path.replace(/^~/, home), 'utf8'))
  return Keypair.fromSecretKey(Uint8Array.from(secret))
}

function endpoint(): string {
  return cluster === 'devnet'
    ? clusterApiUrl('devnet')
    : process.env.SOLANA_RPC_URL || clusterApiUrl('mainnet-beta')
}

async function main() {
  const mint = new PublicKey(MINT_ADDRESS)
  const source = new PublicKey(DEPLOYER_PUBKEY)
  const sourceAta = getAssociatedTokenAddressSync(mint, source, true, TOKEN_2022_PROGRAM_ID)
  const total = toBaseUnits(FURL.maxSupply)

  const legs = migrationLegs()

  console.log('FURL allocation migration plan')
  console.log('─'.repeat(72))
  console.log(`cluster        ${cluster}`)
  console.log(`mint           ${MINT_ADDRESS}`)
  console.log(`source owner   ${DEPLOYER_PUBKEY}`)
  console.log(`source ATA     ${sourceAta.toBase58()}`)
  console.log(`total supply   ${total} base units (${FURL.maxSupply} FURL)`)
  console.log('')

  let ready = true
  try {
    assertMigrationReady()
  } catch (e) {
    ready = false
    console.log('NOT READY — destinations are incomplete:')
    console.log(String(e instanceof Error ? e.message : e))
    console.log('')
  }

  // ---- the legs ----------------------------------------------------------
  console.log('Legs (exact amounts, integer math, sum asserted == total supply):')
  for (const leg of legs) {
    const dest = DESTINATIONS.find((d) => d.key === leg.key)!
    const to = leg.to || '(unset)'
    const destAta = leg.to
      ? getAssociatedTokenAddressSync(mint, new PublicKey(leg.to), true, TOKEN_2022_PROGRAM_ID)
      : null
    console.log(
      `  ${leg.key.padEnd(13)} ${String(leg.percent).padStart(3)}%  ` +
        `${leg.amount.toString().padStart(16)} base  ${leg.whole.padStart(13)} FURL  → ${to}` +
        `  [${dest.requiredCustody}${dest.threshold ? ' ' + dest.threshold : ''}]`,
    )
    if (destAta) console.log(`  ${' '.repeat(13)} destination token account: ${destAta.toBase58()}`)
  }
  const sum = legs.reduce((a, l) => a + l.amount, 0n)
  console.log('─'.repeat(72))
  console.log(`  sum            ${sum} base units`)
  console.log(`  supply         ${total} base units`)
  console.log(`  exact match    ${sum === total ? 'YES' : 'NO — REFUSING'}`)
  console.log('')

  // ---- expected balances after migration ---------------------------------
  console.log('Expected balances AFTER migration:')
  for (const leg of legs) {
    console.log(`  ${leg.key.padEnd(13)} ${leg.whole.padStart(13)} FURL`)
  }
  console.log(`  ${'deployer'.padEnd(13)} ${'0'.padStart(13)} FURL  (fully divested of FURL)`)
  console.log('')

  // ---- live state, if an RPC is available --------------------------------
  try {
    const connection = new Connection(endpoint(), 'confirmed')
    const mintInfo = await getMint(connection, mint, 'confirmed', TOKEN_2022_PROGRAM_ID)
    const acct = await getAccount(connection, sourceAta, 'confirmed', TOKEN_2022_PROGRAM_ID)
    console.log('Live on-chain state:')
    console.log(`  supply            ${mintInfo.supply}`)
    console.log(`  decimals          ${mintInfo.decimals}`)
    console.log(`  mint authority    ${mintInfo.mintAuthority?.toBase58() ?? 'revoked (none)'}`)
    console.log(`  freeze authority  ${mintInfo.freezeAuthority?.toBase58() ?? 'none'}`)
    console.log(`  source balance    ${acct.amount}`)
    if (acct.amount < sum) {
      console.log(
        `  WARNING: source holds ${acct.amount} but the plan moves ${sum}. The migration would fail part-way.`,
      )
    }
    if (mintInfo.decimals !== FURL.decimals) {
      throw new Error(`on-chain decimals ${mintInfo.decimals} != config ${FURL.decimals}`)
    }
    console.log('')
  } catch (e) {
    // An unreachable RPC must not be mistaken for verified state.
    console.log(`Live state UNAVAILABLE (${e instanceof Error ? e.message : e}).`)
    console.log('The plan above is derived from config only — it has NOT been checked against chain.')
    console.log('')
  }

  // ---- unsigned transaction previews ------------------------------------
  console.log('Unsigned transaction preview (base64, one per leg):')
  for (const leg of legs) {
    if (!leg.to) {
      console.log(`  ${leg.key}: skipped — no destination set`)
      continue
    }
    const owner = new PublicKey(leg.to)
    const destAta = getAssociatedTokenAddressSync(mint, owner, true, TOKEN_2022_PROGRAM_ID)
    const tx = new Transaction()
    tx.add(
      createAssociatedTokenAccountIdempotentInstruction(
        source, destAta, owner, mint, TOKEN_2022_PROGRAM_ID,
      ),
    )
    tx.add(
      createTransferCheckedInstruction(
        sourceAta, mint, destAta, source, leg.amount, FURL.decimals, [], TOKEN_2022_PROGRAM_ID,
      ),
    )
    tx.feePayer = source
    // Placeholder blockhash: this is a PREVIEW for instruction review, not a
    // signable transaction. A real run fetches a live blockhash.
    tx.recentBlockhash = '11111111111111111111111111111111'
    const b64 = tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64')
    console.log(`  ${leg.key}: ${tx.instructions.length} instructions, ${b64.length} b64 chars`)
    console.log(`    ${b64}`)
  }
  console.log('')

  if (!execute) {
    console.log('DRY RUN — nothing was sent. No funds moved.')
    console.log('')
    console.log('To execute you must, in order:')
    console.log('  1. Create each multisig (Squads) and verify its members + threshold yourself.')
    console.log('  2. Paste each public address into src/treasury.ts (DESTINATIONS).')
    console.log('  3. Re-run this dry run and check every leg and expected balance.')
    console.log('  4. Re-run with --execute --i-understand-this-moves-real-funds.')
    console.log('')
    console.log('[MOVES REAL FUNDS — APPROVAL REQUIRED]')
    return
  }

  // ---- execution path ----------------------------------------------------
  if (!ready) throw new Error('refusing to execute: destinations are not ready (see above)')
  if (!flag('i-understand-this-moves-real-funds')) {
    throw new Error('--execute requires --i-understand-this-moves-real-funds')
  }
  if (sum !== total) throw new Error('refusing to execute: legs do not sum to total supply')

  const payer = loadKeypair()
  if (!payer.publicKey.equals(source)) {
    throw new Error(
      `keypair ${payer.publicKey.toBase58()} is not the source owner ${DEPLOYER_PUBKEY}`,
    )
  }

  const connection = new Connection(endpoint(), 'confirmed')
  for (const leg of legs) {
    const owner = new PublicKey(leg.to)
    const destAta = getAssociatedTokenAddressSync(mint, owner, true, TOKEN_2022_PROGRAM_ID)

    // Re-entrancy guard: a re-run after a partial success must not double-send.
    try {
      const existing = await getAccount(connection, destAta, 'confirmed', TOKEN_2022_PROGRAM_ID)
      if (existing.amount >= leg.amount) {
        console.log(`  skip ${leg.key}: destination already holds ${existing.amount}`)
        continue
      }
      if (existing.amount > 0n) {
        throw new Error(
          `destination for ${leg.key} holds ${existing.amount}, which is neither 0 nor the full leg ` +
            `${leg.amount} — resolve manually rather than topping up blindly`,
        )
      }
    } catch (e) {
      // A missing account is the normal case (it gets created below); anything
      // else is a real error and must stop the run.
      const msg = e instanceof Error ? e.message : String(e)
      if (!/could not find account|TokenAccountNotFound/i.test(msg)) throw e
    }

    const tx = new Transaction().add(
      createAssociatedTokenAccountIdempotentInstruction(
        payer.publicKey, destAta, owner, mint, TOKEN_2022_PROGRAM_ID,
      ),
      createTransferCheckedInstruction(
        sourceAta, mint, destAta, payer.publicKey, leg.amount, FURL.decimals, [], TOKEN_2022_PROGRAM_ID,
      ),
    )
    const sig = await sendAndConfirmTransaction(connection, tx, [payer])
    console.log(`  moved ${leg.key}: ${leg.amount} → ${leg.to}  (${sig})`)
  }

  const after = await getAccount(connection, sourceAta, 'confirmed', TOKEN_2022_PROGRAM_ID)
  console.log(`\nsource balance after migration: ${after.amount}`)
  if (after.amount !== 0n) {
    console.log('NOTE: the source still holds FURL. Verify every leg before considering this done.')
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
