/**
 * Mint the FIXED FURL supply to the published allocation wallets, verify the
 * total equals maxSupply exactly, then (optionally, and irreversibly) revoke
 * the mint authority so the cap can never be exceeded.
 *
 *   FURL_KEYPAIR=~/.config/solana/furlpay-deployer.json FURL_MINT=<addr> \
 *   npx tsx scripts/mint-and-lock.ts --cluster devnet --execute
 *
 *   # revoke mint authority in the same run (only after you've verified balances)
 *   ... --execute --revoke-mint-authority --i-understand-this-is-irreversible
 *
 * Order matters: we mint everything, re-read the on-chain supply and assert it
 * equals maxSupply, and ONLY then revoke. Revoking first would strand the
 * unminted supply forever.
 */
import {
  Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction, clusterApiUrl,
} from '@solana/web3.js'
import {
  TOKEN_2022_PROGRAM_ID, AuthorityType, getMint, getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction, createMintToInstruction, createSetAuthorityInstruction,
} from '@solana/spl-token'
import { readFileSync } from 'node:fs'
import { FURL, ALLOCATIONS, assertConfigLaunchable, allocationAmounts, toBaseUnits, type Cluster } from '../src/config'

const flag = (n: string) => process.argv.includes(`--${n}`)
const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i !== -1 ? process.argv[i + 1] : undefined }

const cluster = (arg('cluster') || 'devnet') as Cluster
const execute = flag('execute')
const revoke = flag('revoke-mint-authority')

function loadKeypair(): Keypair {
  const path = process.env.FURL_KEYPAIR
  if (!path) throw new Error('set FURL_KEYPAIR to a keypair file path (never commit it)')
  const secret = JSON.parse(readFileSync(path.replace(/^~/, process.env.HOME || process.env.USERPROFILE || ''), 'utf8'))
  return Keypair.fromSecretKey(Uint8Array.from(secret))
}

async function main() {
  assertConfigLaunchable(cluster)
  if (cluster === 'mainnet-beta' && !flag('i-understand-this-is-irreversible')) {
    throw new Error('mainnet mint/revoke requires --i-understand-this-is-irreversible')
  }
  if (revoke && !flag('i-understand-this-is-irreversible')) {
    throw new Error('--revoke-mint-authority is irreversible; add --i-understand-this-is-irreversible')
  }
  const mintStr = process.env.FURL_MINT
  if (!mintStr) throw new Error('set FURL_MINT to the mint address from create-furl-mint')
  const mint = new PublicKey(mintStr)
  const payer = loadKeypair()

  const rows = allocationAmounts()
  const total = toBaseUnits(FURL.maxSupply)
  const plan = ALLOCATIONS.map((a) => {
    const amount = rows.find((r) => r.key === a.key)!.amount
    return { key: a.key, wallet: a.wallet, percent: a.percent, amount: amount.toString() }
  })
  console.log('FURL supply plan:\n' + JSON.stringify({ cluster, mint: mintStr, total: total.toString(), plan, revoke, execute }, null, 2))

  if (cluster === 'mainnet-beta' && plan.some((p) => !p.wallet)) {
    throw new Error('every allocation needs a wallet before mainnet mint')
  }
  if (!execute) { console.log('\nDRY RUN — nothing sent.'); return }

  const endpoint = cluster === 'devnet' ? clusterApiUrl('devnet') : (process.env.SOLANA_RPC_URL || clusterApiUrl('mainnet-beta'))
  const connection = new Connection(endpoint, 'confirmed')

  for (const a of ALLOCATIONS) {
    if (!a.wallet) { console.log(`  skip ${a.key}: no wallet (devnet)`); continue }
    const owner = new PublicKey(a.wallet)
    const amount = rows.find((r) => r.key === a.key)!.amount
    const ata = getAssociatedTokenAddressSync(mint, owner, true, TOKEN_2022_PROGRAM_ID)
    const tx = new Transaction().add(
      createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, ata, owner, mint, TOKEN_2022_PROGRAM_ID),
      createMintToInstruction(mint, ata, payer.publicKey, amount, [], TOKEN_2022_PROGRAM_ID),
    )
    const sig = await sendAndConfirmTransaction(connection, tx, [payer])
    console.log(`  minted ${a.key}: ${amount} → ${a.wallet}  (${sig})`)
  }

  // Verify on-chain supply equals the cap BEFORE considering revocation.
  const info = await getMint(connection, mint, 'confirmed', TOKEN_2022_PROGRAM_ID)
  console.log(`\non-chain supply: ${info.supply}  expected: ${total}`)
  if (info.supply !== total) {
    throw new Error('on-chain supply != maxSupply; refusing to revoke (would strand supply)')
  }

  if (revoke) {
    const tx = new Transaction().add(
      createSetAuthorityInstruction(mint, payer.publicKey, AuthorityType.MintTokens, null, [], TOKEN_2022_PROGRAM_ID),
    )
    const sig = await sendAndConfirmTransaction(connection, tx, [payer])
    console.log(`\nMint authority permanently revoked. (${sig})  Supply is now fixed at ${FURL.maxSupply} FURL.`)
  } else {
    console.log('\nSupply minted. Mint authority NOT revoked — do so with --revoke-mint-authority once verified.')
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
