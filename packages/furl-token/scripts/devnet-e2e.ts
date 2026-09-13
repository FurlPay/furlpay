/**
 * DEVNET end-to-end proof of the FURL launch flow. Free — no real money.
 *
 *   FURL_KEYPAIR=~/.config/solana/furlpay-deployer.json npx tsx scripts/devnet-e2e.ts
 *
 * Steps:
 *   1. ensure the deployer has devnet SOL (airdrop if low)
 *   2. create the Token-2022 mint with metadata pointer + token metadata
 *   3. mint the full fixed supply to the deployer (devnet has no allocation
 *      wallets set, so everything goes to the deployer ATA for the demo)
 *   4. re-read on-chain supply and assert it equals maxSupply
 *   5. print the mint address + explorer link
 *
 * It does NOT revoke the mint authority (so you can re-run/experiment on
 * devnet). Revocation is a separate, deliberate, irreversible step.
 */
import {
  Connection, Keypair, SystemProgram, Transaction, sendAndConfirmTransaction, PublicKey, clusterApiUrl, LAMPORTS_PER_SOL,
} from '@solana/web3.js'
import {
  ExtensionType, TOKEN_2022_PROGRAM_ID, getMintLen, LENGTH_SIZE, TYPE_SIZE, getMint,
  createInitializeMetadataPointerInstruction, createInitializeMintInstruction,
  getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction, createMintToInstruction,
} from '@solana/spl-token'
import { pack, createInitializeInstruction, createUpdateFieldInstruction, type TokenMetadata } from '@solana/spl-token-metadata'
import { readFileSync } from 'node:fs'
import { FURL, assertConfigLaunchable, toBaseUnits, METADATA_URI, ON_CHAIN_ADDITIONAL_METADATA } from '../src/config.ts'

function loadKeypair(): Keypair {
  const path = process.env.FURL_KEYPAIR
  if (!path) throw new Error('set FURL_KEYPAIR to a keypair file path (run new-deployer-keypair.ts first)')
  const resolved = path.replace(/^~/, process.env.HOME || process.env.USERPROFILE || '')
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(resolved, 'utf8'))))
}

async function ensureSol(connection: Connection, pubkey: PublicKey) {
  const bal = await connection.getBalance(pubkey)
  console.log(`  deployer balance: ${(bal / LAMPORTS_PER_SOL).toFixed(4)} SOL`)
  if (bal >= 0.5 * LAMPORTS_PER_SOL) return
  console.log('  requesting devnet airdrop (1 SOL)...')
  try {
    const sig = await connection.requestAirdrop(pubkey, 1 * LAMPORTS_PER_SOL)
    await connection.confirmTransaction(sig, 'confirmed')
    console.log(`  airdrop confirmed: ${sig}`)
  } catch (e) {
    console.warn(`  airdrop failed (devnet faucet is often rate-limited): ${e instanceof Error ? e.message : e}`)
    console.warn(`  fund it manually: https://faucet.solana.com/  address: ${pubkey.toBase58()}`)
    throw new Error('insufficient devnet SOL to proceed')
  }
}

async function main() {
  assertConfigLaunchable('devnet')
  const payer = loadKeypair()
  const connection = new Connection(clusterApiUrl('devnet'), 'confirmed')
  console.log(`FURL devnet e2e — deployer ${payer.publicKey.toBase58()}`)

  await ensureSol(connection, payer.publicKey)

  // 2. create mint
  const mint = Keypair.generate()
  const metadata: TokenMetadata = {
    mint: mint.publicKey, name: FURL.name, symbol: FURL.symbol,
    uri: METADATA_URI,
    additionalMetadata: ON_CHAIN_ADDITIONAL_METADATA.map((kv) => [kv[0], kv[1]] as [string, string]),
  }
  const mintLen = getMintLen([ExtensionType.MetadataPointer])
  const metadataLen = TYPE_SIZE + LENGTH_SIZE + pack(metadata).length
  const lamports = await connection.getMinimumBalanceForRentExemption(mintLen + metadataLen)
  const freeze = FURL.freezeAuthority ? new PublicKey(FURL.freezeAuthority) : null

  const createTx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey, newAccountPubkey: mint.publicKey,
      space: mintLen, lamports, programId: TOKEN_2022_PROGRAM_ID,
    }),
    createInitializeMetadataPointerInstruction(mint.publicKey, payer.publicKey, mint.publicKey, TOKEN_2022_PROGRAM_ID),
    createInitializeMintInstruction(mint.publicKey, FURL.decimals, payer.publicKey, freeze, TOKEN_2022_PROGRAM_ID),
    createInitializeInstruction({
      programId: TOKEN_2022_PROGRAM_ID, mint: mint.publicKey, metadata: mint.publicKey,
      name: metadata.name, symbol: metadata.symbol, uri: metadata.uri,
      mintAuthority: payer.publicKey, updateAuthority: payer.publicKey,
    }),
    ...ON_CHAIN_ADDITIONAL_METADATA.map(([field, value]) =>
      createUpdateFieldInstruction({
        programId: TOKEN_2022_PROGRAM_ID, metadata: mint.publicKey,
        updateAuthority: payer.publicKey, field, value,
      }),
    ),
  )
  const createSig = await sendAndConfirmTransaction(connection, createTx, [payer, mint])
  console.log(`  mint created: ${mint.publicKey.toBase58()}  (${createSig})`)

  // 3. mint full supply to deployer ATA (devnet demo — no allocation wallets)
  const total = toBaseUnits(FURL.maxSupply)
  const ata = getAssociatedTokenAddressSync(mint.publicKey, payer.publicKey, false, TOKEN_2022_PROGRAM_ID)
  const mintTx = new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, ata, payer.publicKey, mint.publicKey, TOKEN_2022_PROGRAM_ID),
    createMintToInstruction(mint.publicKey, ata, payer.publicKey, total, [], TOKEN_2022_PROGRAM_ID),
  )
  const mintSig = await sendAndConfirmTransaction(connection, mintTx, [payer])
  console.log(`  minted ${FURL.maxSupply} FURL → deployer ATA  (${mintSig})`)

  // 4. verify supply
  const info = await getMint(connection, mint.publicKey, 'confirmed', TOKEN_2022_PROGRAM_ID)
  console.log(`  on-chain supply: ${info.supply}  expected: ${total}  decimals: ${info.decimals}`)
  if (info.supply !== total) throw new Error('supply mismatch — devnet run FAILED')
  if (info.freezeAuthority) throw new Error('unexpected freeze authority set')

  console.log('\n✅ devnet e2e PASSED')
  console.log(`   mint:     ${mint.publicKey.toBase58()}`)
  console.log(`   explorer: https://explorer.solana.com/address/${mint.publicKey.toBase58()}?cluster=devnet`)
  console.log('   (mint authority intentionally NOT revoked on devnet)')
}

main().catch((e) => { console.error('\n✗', e instanceof Error ? e.message : e); process.exit(1) })
