/**
 * Create the FURL mint (Token-2022) with an on-chain metadata pointer + token
 * metadata, in ONE transaction, in the order the runtime requires.
 *
 *   # devnet dry-run (default): builds nothing, just prints the plan
 *   npx tsx scripts/create-furl-mint.ts
 *
 *   # devnet, actually create the mint
 *   FURL_KEYPAIR=~/.config/solana/furlpay-deployer.json \
 *   npx tsx scripts/create-furl-mint.ts --cluster devnet --execute
 *
 *   # mainnet is refused unless config is fully launchable AND you pass the
 *   # explicit acknowledgement flag. Even then it only creates the mint —
 *   # minting/allocation/revocation are separate, deliberate steps.
 *   ... --cluster mainnet-beta --execute --i-understand-this-is-irreversible
 *
 * The deployer keypair is read from a file path in FURL_KEYPAIR. It is NEVER
 * read from a committed file, NEVER from a NEXT_PUBLIC_* var, and this script
 * never prints a secret key.
 *
 * Verified against Solana docs 2026-09-12: metadata-pointer init MUST precede
 * InitializeMint; token-metadata init MUST follow it; the mint account must be
 * rent-exempt for the FINAL size (base + pointer + packed metadata).
 */
import {
  Connection, Keypair, SystemProgram, Transaction, sendAndConfirmTransaction, PublicKey, clusterApiUrl,
} from '@solana/web3.js'
import {
  ExtensionType, TOKEN_2022_PROGRAM_ID, getMintLen, LENGTH_SIZE, TYPE_SIZE,
  createInitializeMetadataPointerInstruction, createInitializeMintInstruction,
} from '@solana/spl-token'
import { pack, createInitializeInstruction, createUpdateFieldInstruction, type TokenMetadata } from '@solana/spl-token-metadata'
import { readFileSync } from 'node:fs'
import {
  FURL, TOKEN_2022_PROGRAM_ID as CONFIG_PROGRAM_ID, assertConfigLaunchable,
  METADATA_URI, ON_CHAIN_ADDITIONAL_METADATA, type Cluster,
} from '../src/config'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i !== -1 ? (process.argv[i + 1]?.startsWith('--') ? '' : process.argv[i + 1]) : undefined
}
const flag = (name: string) => process.argv.includes(`--${name}`)

const cluster = (arg('cluster') || 'devnet') as Cluster
const execute = flag('execute')
const metadataUri = arg('metadata-uri') || METADATA_URI

function loadKeypair(): Keypair {
  const path = process.env.FURL_KEYPAIR
  if (!path) throw new Error('set FURL_KEYPAIR to a keypair file path (never commit it)')
  const secret = JSON.parse(readFileSync(path.replace(/^~/, process.env.HOME || process.env.USERPROFILE || ''), 'utf8'))
  return Keypair.fromSecretKey(Uint8Array.from(secret))
}

async function main() {
  assertConfigLaunchable(cluster)

  if (TOKEN_2022_PROGRAM_ID.toBase58() !== CONFIG_PROGRAM_ID) {
    throw new Error(`spl-token TOKEN_2022_PROGRAM_ID (${TOKEN_2022_PROGRAM_ID.toBase58()}) != config (${CONFIG_PROGRAM_ID})`)
  }
  if (cluster === 'mainnet-beta' && !flag('i-understand-this-is-irreversible')) {
    throw new Error('mainnet mint creation requires --i-understand-this-is-irreversible')
  }

  const payer = loadKeypair()
  const mint = Keypair.generate()

  // The metadata we will store ON the mint (metadata pointer → the mint itself).
  const metadata: TokenMetadata = {
    mint: mint.publicKey,
    name: FURL.name,
    symbol: FURL.symbol,
    uri: metadataUri,
    additionalMetadata: ON_CHAIN_ADDITIONAL_METADATA.map((kv) => [kv[0], kv[1]] as [string, string]),
  }

  // Rent must cover the FINAL account size: base mint + metadata-pointer
  // extension + the TLV-packed metadata (its own 4-byte type/length prefix).
  const mintLen = getMintLen([ExtensionType.MetadataPointer])
  const metadataLen = TYPE_SIZE + LENGTH_SIZE + pack(metadata).length

  const summary = {
    cluster,
    mint: mint.publicKey.toBase58(),
    payer: payer.publicKey.toBase58(),
    decimals: FURL.decimals,
    freezeAuthority: FURL.freezeAuthority,
    extensions: FURL.extensions,
    mintAccountBytes: mintLen + metadataLen,
    metadataUri,
    execute,
  }
  console.log('FURL mint plan:\n' + JSON.stringify(summary, null, 2))
  if (!execute) {
    console.log('\nDRY RUN — nothing sent. Re-run with --execute to create the mint.')
    return
  }

  const endpoint = cluster === 'devnet' ? clusterApiUrl('devnet') : (process.env.SOLANA_RPC_URL || clusterApiUrl('mainnet-beta'))
  const connection = new Connection(endpoint, 'confirmed')
  const lamports = await connection.getMinimumBalanceForRentExemption(mintLen + metadataLen)

  const freeze = FURL.freezeAuthority ? new PublicKey(FURL.freezeAuthority) : null

  const tx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: mint.publicKey,
      space: mintLen, // pointer ext only; metadata is added by InitializeMetadata
      lamports,
      programId: TOKEN_2022_PROGRAM_ID,
    }),
    // MUST come before InitializeMint.
    createInitializeMetadataPointerInstruction(
      mint.publicKey, payer.publicKey, mint.publicKey, TOKEN_2022_PROGRAM_ID,
    ),
    createInitializeMintInstruction(
      mint.publicKey, FURL.decimals, payer.publicKey /* mint authority */, freeze, TOKEN_2022_PROGRAM_ID,
    ),
    // MUST come after InitializeMint; writes name/symbol/uri onto the mint.
    createInitializeInstruction({
      programId: TOKEN_2022_PROGRAM_ID,
      mint: mint.publicKey,
      metadata: mint.publicKey,
      name: metadata.name,
      symbol: metadata.symbol,
      uri: metadata.uri,
      mintAuthority: payer.publicKey,
      updateAuthority: payer.publicKey,
    }),
    // Write the factual additional fields (chain/role/external_url) on-chain so
    // it agrees with the off-chain JSON. Rent above is sized to include these.
    ...ON_CHAIN_ADDITIONAL_METADATA.map(([field, value]) =>
      createUpdateFieldInstruction({
        programId: TOKEN_2022_PROGRAM_ID,
        metadata: mint.publicKey,
        updateAuthority: payer.publicKey,
        field,
        value,
      }),
    ),
  )

  const sig = await sendAndConfirmTransaction(connection, tx, [payer, mint])
  console.log(`\nMint created.\n  mint:      ${mint.publicKey.toBase58()}\n  signature: ${sig}`)
  console.log('\nNext: mint the fixed supply to allocation wallets, then revoke mint authority.')
  console.log('Save the mint address to your env + publish it on the official site before anything else.')
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
