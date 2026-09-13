/**
 * [IRREVERSIBLE — APPROVAL REQUIRED]
 *
 * Prepare the transaction that permanently removes FURL's mint authority.
 *
 *   # prepare + inspect (default; sends nothing)
 *   npx tsx scripts/revoke-mint-authority.ts --cluster mainnet-beta
 *
 *   # execute — PERMANENT, cannot be undone by anyone, ever
 *   FURL_KEYPAIR=... npx tsx scripts/revoke-mint-authority.ts \
 *     --cluster mainnet-beta --execute --i-understand-this-is-irreversible
 *
 * WHAT IT DOES: SetAuthority(mint, AuthorityType.MintTokens, newAuthority=None).
 * After it lands, no key — including this one — can ever mint another FURL. The
 * 1,000,000,000 cap stops being a promise and becomes a property of the runtime.
 *
 * WHAT IT CANNOT DO: be reversed. There is no "re-grant" instruction for an
 * authority set to None. If FurlPay ever needs controlled issuance (a real
 * stablecoin model with reserves and redemption), that requires a NEW mint and a
 * public migration — not a quiet switch. So read the two models below and decide
 * deliberately.
 *
 * ── MODEL A — fixed-supply payment / utility token ────────────────────────────
 *   * 1B hard cap, enforced by the runtime after this script runs.
 *   * Supply finality is verifiable by anyone; "can they print more?" is
 *     answered by the chain, not by a document.
 *   * Simplest architecture: no issuance controls, no reserve accounting, no
 *     redemption desk, no attestation cadence.
 *   * Cost: FurlPay can never mint FURL again. Any future supply-based
 *     mechanism (new rewards tranche, stablecoin conversion) needs a new token.
 *   * This is what FURL is today, minus the revocation.
 *
 * ── MODEL B — actual stablecoin issuer ───────────────────────────────────────
 *   * Mint/burn kept, held by a MULTISIG, driven by deposits and redemptions.
 *   * Requires: segregated reserves, a redemption mechanism that honours 1:1,
 *     third-party attestations, issuer controls (including — realistically — a
 *     freeze authority for sanctions and law-enforcement holds, which FURL does
 *     NOT have; freeze authority is null and cannot be added to this mint), and
 *     authorisation under the relevant regime (EU MiCA e-money token, US
 *     stablecoin legislation).
 *   * A USD stablecoin is MORE regulated than a utility token, not less.
 *   * FURL implements NONE of this today. Until it does, FURL must not be
 *     described publicly as reserve-backed or redeemable.
 *
 * Because FURL cannot gain a freeze authority without a new mint, Model B is
 * already only reachable via a re-launch. That makes revoking here a smaller
 * decision than it looks: it forecloses an option that is, in practice, already
 * foreclosed for this mint.
 *
 * STILL: this script does nothing without --execute AND
 * --i-understand-this-is-irreversible. The default path prints the transaction
 * and exits.
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
  AuthorityType,
  createSetAuthorityInstruction,
  getMint,
} from '@solana/spl-token'
import { readFileSync } from 'node:fs'
import { FURL, MINT_ADDRESS, DEPLOYER_PUBKEY, toBaseUnits, type Cluster } from '../src/config.ts'

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
  return Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(path.replace(/^~/, home), 'utf8'))),
  )
}

function endpoint(): string {
  return cluster === 'devnet'
    ? clusterApiUrl('devnet')
    : process.env.SOLANA_RPC_URL || clusterApiUrl('mainnet-beta')
}

async function main() {
  const mint = new PublicKey(MINT_ADDRESS)
  const currentAuthority = new PublicKey(DEPLOYER_PUBKEY)

  console.log('[IRREVERSIBLE — APPROVAL REQUIRED]  FURL mint-authority revocation')
  console.log('─'.repeat(72))
  console.log(`cluster            ${cluster}`)
  console.log(`mint               ${MINT_ADDRESS}`)
  console.log(`token program      ${TOKEN_2022_PROGRAM_ID.toBase58()}`)
  console.log(`current authority  ${DEPLOYER_PUBKEY}`)
  console.log(`new authority      None  (permanent)`)
  console.log('')

  // The exact instruction, built the same way the execute path builds it, so
  // what is reviewed is what would be sent.
  const ix = createSetAuthorityInstruction(
    mint,
    currentAuthority,
    AuthorityType.MintTokens,
    null,
    [],
    TOKEN_2022_PROGRAM_ID,
  )
  const tx = new Transaction().add(ix)
  tx.feePayer = currentAuthority
  tx.recentBlockhash = '11111111111111111111111111111111' // preview only

  console.log('Instruction:')
  console.log(`  program   ${ix.programId.toBase58()}`)
  console.log(`  accounts  ${ix.keys.map((k) => `${k.pubkey.toBase58()}${k.isSigner ? ' (signer)' : ''}`).join('\n            ')}`)
  console.log(`  data      ${Buffer.from(ix.data as Uint8Array).toString('hex')}`)
  console.log('')
  console.log('Unsigned transaction (base64, preview blockhash):')
  console.log(
    '  ' + tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64'),
  )
  console.log('')

  // Pre-flight against the chain. Revoking before the full supply is minted
  // would strand the remainder forever — that is the one ordering mistake here
  // that cannot be repaired.
  let liveSupplyOk = false
  try {
    const connection = new Connection(endpoint(), 'confirmed')
    const info = await getMint(connection, mint, 'confirmed', TOKEN_2022_PROGRAM_ID)
    const expected = toBaseUnits(FURL.maxSupply)
    console.log('Live pre-flight:')
    console.log(`  supply            ${info.supply}  (expected ${expected})`)
    console.log(`  decimals          ${info.decimals}`)
    console.log(`  mint authority    ${info.mintAuthority?.toBase58() ?? 'ALREADY REVOKED'}`)
    console.log(`  freeze authority  ${info.freezeAuthority?.toBase58() ?? 'none'}`)
    if (!info.mintAuthority) {
      console.log('\nNothing to do: the mint authority is already None.')
      return
    }
    if (!info.mintAuthority.equals(currentAuthority)) {
      throw new Error(
        `on-chain mint authority ${info.mintAuthority.toBase58()} != expected ${DEPLOYER_PUBKEY}`,
      )
    }
    if (info.supply !== expected) {
      throw new Error(
        `refusing: supply ${info.supply} != ${expected}. Revoking now would strand the ` +
          `unminted remainder permanently.`,
      )
    }
    liveSupplyOk = true
    console.log('')
  } catch (e) {
    console.log(`Live pre-flight UNAVAILABLE or FAILED: ${e instanceof Error ? e.message : e}`)
    console.log('')
    if (execute) throw e instanceof Error ? e : new Error(String(e))
  }

  if (!execute) {
    console.log('PREPARED ONLY — nothing was sent. The mint authority is unchanged.')
    console.log('')
    console.log('Decide between Model A and Model B (see the header of this file) first.')
    console.log('Then, to execute:')
    console.log('  FURL_KEYPAIR=<deployer keypair> npx tsx scripts/revoke-mint-authority.ts \\')
    console.log(`    --cluster ${cluster} --execute --i-understand-this-is-irreversible`)
    console.log('')
    console.log('[IRREVERSIBLE — APPROVAL REQUIRED]')
    return
  }

  if (!flag('i-understand-this-is-irreversible')) {
    throw new Error('--execute requires --i-understand-this-is-irreversible (this cannot be undone)')
  }
  if (!liveSupplyOk) {
    throw new Error('refusing to execute without a successful live pre-flight')
  }

  const payer = loadKeypair()
  if (!payer.publicKey.equals(currentAuthority)) {
    throw new Error(
      `keypair ${payer.publicKey.toBase58()} is not the mint authority ${DEPLOYER_PUBKEY}`,
    )
  }

  const connection = new Connection(endpoint(), 'confirmed')
  const sig = await sendAndConfirmTransaction(connection, new Transaction().add(ix), [payer])
  console.log(`mint authority revoked permanently: ${sig}`)

  const after = await getMint(connection, mint, 'confirmed', TOKEN_2022_PROGRAM_ID)
  console.log(`verified: mintAuthority = ${after.mintAuthority?.toBase58() ?? 'None'}`)
  console.log('Update ../MAINNET-LAUNCH.md and /token — the live page reads this from chain, but the')
  console.log('launch record is a written document and must be corrected by hand.')
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
