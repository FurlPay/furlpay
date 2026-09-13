/**
 * Guide + validator for creating the six FURL treasury multisigs.
 *
 *   npx tsx scripts/create-multisigs.ts            # print the checklist
 *   npx tsx scripts/create-multisigs.ts --verify   # validate what you pasted in
 *
 * THIS SCRIPT CREATES NOTHING. It holds no key, signs nothing, and calls no
 * program. That is deliberate and not a limitation to be fixed later:
 *
 *   Creating the wallet that will hold 1,000,000,000 FURL is the single act in
 *   this whole project where an automated convenience is most likely to cost
 *   everything. A script that creates a multisig has to choose the members —
 *   and a member list assembled from a config file, by a program, at 2am, is
 *   exactly how a treasury ends up with a signer nobody can identify. You will
 *   create these by hand, in the Squads app, looking at each member address, and
 *   then this script checks your work.
 *
 * Squads v4 (app.squads.so) supports creating a multisig from the UI: connect a
 * Solana wallet, add each member's address, set the approval threshold. v4 also
 * has time locks, spending limits and roles — none of which this script
 * configures for you, and all of which you should consider.
 *
 * VERIFIED 2026-09-13: squads.xyz/blog/v4-and-new-squads-app (UI creation,
 * members + threshold), github.com/Squads-Protocol/v4 (program).
 */
import { PublicKey } from '@solana/web3.js'
import { FURL, MINT_ADDRESS, DEPLOYER_PUBKEY, toBaseUnits } from '../src/config.ts'
import { DESTINATIONS, migrationLegs, assertMigrationReady } from '../src/treasury.ts'

const flag = (n: string) => process.argv.includes(`--${n}`)

const RULE = '─'.repeat(74)

function printChecklist() {
  console.log('FURL treasury multisigs — creation checklist')
  console.log(RULE)
  console.log('')
  console.log('Mint     ', MINT_ADDRESS, '(Token-2022)')
  console.log('Currently', `100% of supply in ONE account owned by ${DEPLOYER_PUBKEY}`)
  console.log('')
  console.log('Create SIX separate multisigs at https://app.squads.so — one per allocation.')
  console.log('Do NOT reuse one multisig for several buckets: allocations that share a wallet')
  console.log('cannot be audited apart, and the public cannot verify any of them.')
  console.log('')

  const legs = migrationLegs()
  for (const dest of DESTINATIONS) {
    const leg = legs.find((l) => l.key === dest.key)!
    console.log(`${dest.key.toUpperCase()}`)
    console.log(`  will hold      ${Number(leg.whole).toLocaleString('en-US')} FURL (${leg.percent}%)`)
    console.log(`  threshold      ${dest.threshold}   (${dest.requiredCustody})`)
    console.log(`  why            ${dest.rationale}`)
    console.log(`  status         ${dest.wallet ? `SET → ${dest.wallet}` : 'NOT SET — create it, then paste the address into src/treasury.ts'}`)
    console.log('')
  }

  console.log(RULE)
  console.log('For EACH multisig, before you paste its address anywhere:')
  console.log('')
  console.log('  1. Read every member address out loud against its owner. A member you cannot')
  console.log('     name is a member you must remove.')
  console.log('  2. Confirm the threshold matches the table above. A 1-of-N "multisig" is a')
  console.log('     single key with extra steps.')
  console.log('  3. Confirm no member key is the deployer key. Migrating to a multisig whose')
  console.log('     only signer is the key you are migrating away from changes nothing.')
  console.log('  4. Confirm each member is on separate hardware, held by a separate person.')
  console.log('     Three keys in one drawer is one key.')
  console.log('  5. Send a TINY test amount of FURL to it, and execute a transfer back out')
  console.log('     with the full approval flow. An untested multisig is an assumption.')
  console.log('  6. Record who holds which key, and what happens if that person is')
  console.log('     unreachable. Write it down outside this repository.')
  console.log('')
  console.log('THEN: paste each PUBLIC address into DESTINATIONS in src/treasury.ts and run:')
  console.log('  npx tsx scripts/create-multisigs.ts --verify')
  console.log('')
  console.log('Never paste a private key, seed phrase, or keypair file into this repository.')
  console.log('Only public addresses belong here.')
}

function verify() {
  console.log('Verifying the destinations in src/treasury.ts')
  console.log(RULE)

  const problems: string[] = []

  for (const dest of DESTINATIONS) {
    if (!dest.wallet) {
      problems.push(`${dest.key}: still null`)
      continue
    }
    // Base58 of the right length is not the same as 32 decodable bytes.
    try {
      new PublicKey(dest.wallet)
    } catch {
      problems.push(`${dest.key}: "${dest.wallet}" is not a valid Solana public key`)
      continue
    }
    if (dest.wallet === DEPLOYER_PUBKEY) {
      problems.push(`${dest.key}: equals the deployer — that is not a migration`)
    }
    if (dest.wallet === MINT_ADDRESS) {
      problems.push(`${dest.key}: equals the MINT address — tokens sent there are unrecoverable`)
    }
    console.log(`  ${dest.key.padEnd(13)} ${dest.wallet}  [${dest.threshold}]`)
  }

  const wallets = DESTINATIONS.map((d) => d.wallet).filter((w): w is string => !!w)
  const dupes = [...new Set(wallets.filter((w, i) => wallets.indexOf(w) !== i))]
  if (dupes.length) problems.push(`duplicate destination(s): ${dupes.join(', ')}`)

  console.log('')
  if (problems.length) {
    console.log('NOT READY:')
    for (const p of problems) console.log(`  - ${p}`)
    console.log('')
    console.log('Fix these, then re-run. The migration script refuses to execute until this passes.')
    process.exitCode = 1
    return
  }

  // The shared invariant check the migration itself runs.
  assertMigrationReady()

  const legs = migrationLegs()
  const sum = legs.reduce((a, l) => a + l.amount, 0n)
  const total = toBaseUnits(FURL.maxSupply)

  console.log('All six destinations are set, distinct, valid, and not the deployer.')
  console.log(`Legs sum to ${sum} base units; supply is ${total}. Exact match: ${sum === total ? 'YES' : 'NO'}`)
  console.log('')
  console.log('Next: review the full migration plan (still a dry run, moves nothing):')
  console.log('  npm run plan:migrate -w @furlpay/furl-token')
  console.log('')
  console.log('[THE NEXT STEP AFTER THAT MOVES REAL FUNDS — APPROVAL REQUIRED]')
}

if (flag('verify')) verify()
else printChecklist()
