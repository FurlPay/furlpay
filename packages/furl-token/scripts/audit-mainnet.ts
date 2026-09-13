/**
 * READ-ONLY mainnet audit of the live FURL deployment.
 *
 *   npx tsx scripts/audit-mainnet.ts
 *
 * Sends nothing. Signs nothing. Loads no keypair. Every call below is a query —
 * `getAccountInfo`, `getBalance`, `getTokenLargestAccounts`, `getTokenSupply`.
 * There is no code path in this file that can write to the chain, which is the
 * point: an audit you have to trust not to touch anything is not an audit.
 *
 * It reports what the CHAIN says, then compares it to what the repository
 * CLAIMS, and flags every divergence. The repository is not the source of
 * truth here; the chain is.
 */
import { Connection, PublicKey, clusterApiUrl } from '@solana/web3.js'
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getMint,
  getAssociatedTokenAddressSync,
  getExtensionTypes,
  ExtensionType,
} from '@solana/spl-token'
import {
  FURL,
  MINT_ADDRESS,
  DEPLOYER_PUBKEY,
  METADATA_URI,
  IMAGE_URL,
  USDC,
  toBaseUnits,
} from '../src/config.ts'

const RULE = '─'.repeat(78)
const findings: { level: 'OK' | 'NOTE' | 'WARN' | 'FAIL'; text: string }[] = []
const record = (level: 'OK' | 'NOTE' | 'WARN' | 'FAIL', text: string) => {
  findings.push({ level, text })
  console.log(`  [${level.padEnd(4)}] ${text}`)
}

function endpoint(): string {
  return process.env.SOLANA_RPC_URL || clusterApiUrl('mainnet-beta')
}

/** Whole-token string from base units, integer math only. */
function whole(raw: bigint, decimals: number): string {
  const scale = 10n ** BigInt(decimals)
  const w = raw / scale
  const f = raw % scale
  if (f === 0n) return w.toLocaleString('en-US')
  return `${w.toLocaleString('en-US')}.${f.toString().padStart(decimals, '0').replace(/0+$/, '')}`
}

async function main() {
  const connection = new Connection(endpoint(), 'confirmed')
  const mint = new PublicKey(MINT_ADDRESS)
  const deployer = new PublicKey(DEPLOYER_PUBKEY)

  console.log('FURL mainnet audit — READ ONLY')
  console.log(RULE)
  console.log(`rpc        ${endpoint().replace(/api-key=[^&]+/, 'api-key=***')}`)
  console.log(`slot       ${await connection.getSlot('confirmed')}`)
  console.log(`audited    ${new Date().toISOString()}`)
  console.log('')

  // ---- 1. the mint account ------------------------------------------------
  console.log('MINT')
  const info = await connection.getAccountInfo(mint, 'confirmed')
  if (!info) {
    record('FAIL', `no account exists at ${MINT_ADDRESS}`)
    return
  }
  record('OK', `address ${MINT_ADDRESS}`)

  const owner = info.owner.toBase58()
  if (owner === TOKEN_2022_PROGRAM_ID.toBase58()) {
    record('OK', `owning program is Token-2022 (${owner})`)
  } else if (owner === TOKEN_PROGRAM_ID.toBase58()) {
    record('FAIL', `owning program is LEGACY SPL Token, not Token-2022 (${owner})`)
  } else {
    record('FAIL', `unexpected owning program ${owner}`)
  }

  const m = await getMint(connection, mint, 'confirmed', TOKEN_2022_PROGRAM_ID)

  m.decimals === FURL.decimals
    ? record('OK', `decimals ${m.decimals} (config agrees)`)
    : record('FAIL', `decimals ${m.decimals} but config says ${FURL.decimals}`)

  const expectedSupply = toBaseUnits(FURL.maxSupply)
  m.supply === expectedSupply
    ? record('OK', `supply ${m.supply} base units = ${whole(m.supply, m.decimals)} FURL (config agrees)`)
    : record('FAIL', `supply ${m.supply} but config expects ${expectedSupply}`)

  // ---- 2. authorities -----------------------------------------------------
  console.log('')
  console.log('AUTHORITIES')
  if (m.mintAuthority) {
    const isDeployer = m.mintAuthority.equals(deployer)
    record(
      'WARN',
      `mint authority ACTIVE → ${m.mintAuthority.toBase58()}${isDeployer ? ' (the deployer)' : ' (NOT the deployer — investigate)'}`,
    )
    record('NOTE', 'more FURL can be minted; the 1B cap is published intent, not runtime-enforced')
  } else {
    record('OK', 'mint authority revoked (None) — supply is capped by the runtime')
  }

  if (m.freezeAuthority) {
    record('WARN', `freeze authority ACTIVE → ${m.freezeAuthority.toBase58()} (accounts can be frozen)`)
  } else {
    record('OK', 'freeze authority None — no account can ever be frozen')
  }

  // ---- 3. Token-2022 extensions ------------------------------------------
  console.log('')
  console.log('TOKEN-2022 EXTENSIONS')
  // Token-2022 mint layout: 82-byte base mint, zero-padded to 165 (the size of a
  // token Account), then ONE account-type discriminator byte at offset 165, and
  // the extension TLV list from 166. Slicing at 165 includes the discriminator
  // and makes the TLV parse yield nothing — which reads as "no extensions" and
  // would have been reported as a missing metadata pointer on a mint that has one.
  const present = getExtensionTypes(info.data.subarray(166)).map((t) => ExtensionType[t])
  const expected = [...FURL.extensions]
  record('NOTE', `on-chain: ${present.length ? present.join(', ') : '(none)'}`)
  record('NOTE', `config expects: ${expected.join(', ')}`)

  // The extensions that make a token dangerous to hold. Their ABSENCE is the
  // security property, so it is asserted rather than assumed.
  const DANGEROUS: [string, string][] = [
    ['TransferFeeConfig', 'a transfer tax on every payment'],
    ['PermanentDelegate', 'an address that can move or burn anyone’s tokens, forever'],
    ['TransferHook', 'arbitrary program invoked on every transfer'],
    ['DefaultAccountState', 'new accounts frozen until blessed'],
    ['ConfidentialTransferMint', 'balances not publicly verifiable'],
    ['MintCloseAuthority', 'the mint itself can be closed'],
  ]
  for (const [ext, why] of DANGEROUS) {
    present.some((p) => p?.startsWith(ext))
      ? record('FAIL', `${ext} IS PRESENT — ${why}`)
      : record('OK', `${ext} absent (${why} — not possible)`)
  }

  for (const want of ['MetadataPointer', 'TokenMetadata']) {
    present.some((p) => p === want)
      ? record('OK', `${want} present`)
      : record('WARN', `${want} expected by config but NOT found on chain`)
  }

  // ---- 4. metadata --------------------------------------------------------
  console.log('')
  console.log('METADATA')
  try {
    // Token-2022 token-metadata lives in the mint account itself.
    const { getTokenMetadata } = await import('@solana/spl-token')
    const meta = await getTokenMetadata(connection, mint, 'confirmed', TOKEN_2022_PROGRAM_ID)
    if (!meta) {
      record('WARN', 'no Token-2022 token-metadata found on the mint')
    } else {
      meta.name === FURL.name
        ? record('OK', `name "${meta.name}"`)
        : record('WARN', `on-chain name "${meta.name}" != config "${FURL.name}"`)
      meta.symbol === FURL.symbol
        ? record('OK', `symbol "${meta.symbol}"`)
        : record('WARN', `on-chain symbol "${meta.symbol}" != config "${FURL.symbol}"`)
      meta.uri === METADATA_URI
        ? record('OK', `uri ${meta.uri}`)
        : record('WARN', `on-chain uri ${meta.uri} != config ${METADATA_URI}`)
      record('NOTE', `update authority: ${meta.updateAuthority?.toBase58() ?? 'None (immutable)'}`)
      if (meta.additionalMetadata?.length) {
        for (const [k, v] of meta.additionalMetadata) record('NOTE', `additional: ${k}=${v}`)
      }
      record('NOTE', 'standard is Token-2022 token-metadata — NOT Metaplex. No migration is needed.')
    }
  } catch (e) {
    record('WARN', `metadata read failed: ${e instanceof Error ? e.message : e}`)
  }

  // ---- 5. holder distribution --------------------------------------------
  console.log('')
  console.log('HOLDERS')
  const largest = await connection.getTokenLargestAccounts(mint, 'confirmed')
  const holders = largest.value.filter((v) => BigInt(v.amount) > 0n)
  record('NOTE', `${holders.length} non-zero token account(s) (RPC caps this list at 20)`)

  const deployerAta = getAssociatedTokenAddressSync(mint, deployer, true, TOKEN_2022_PROGRAM_ID)
  record('NOTE', `deployer ATA ${deployerAta.toBase58()}`)

  let deployerHeld = 0n
  for (const h of holders) {
    const amount = BigInt(h.amount)
    const pct = (amount * 10_000n) / m.supply
    const isDeployerAta = h.address.equals(deployerAta)
    deployerHeld += isDeployerAta ? amount : 0n
    record(
      isDeployerAta ? 'NOTE' : 'WARN',
      `${h.address.toBase58()} holds ${whole(amount, m.decimals)} FURL (${(Number(pct) / 100).toFixed(2)}%)` +
        (isDeployerAta ? ' — deployer ATA' : ' — NOT the deployer ATA, investigate'),
    )
  }

  if (deployerHeld === m.supply) {
    record('WARN', 'deployer holds 100% of supply — single-key concentration, total-loss risk')
    record('NOTE', 'circulating supply outside the issuer is therefore ZERO')
  } else {
    record('NOTE', `deployer holds ${whole(deployerHeld, m.decimals)} of ${whole(m.supply, m.decimals)} FURL`)
  }

  // ---- 6. deployer account ------------------------------------------------
  console.log('')
  console.log('DEPLOYER ACCOUNT')
  const lamports = await connection.getBalance(deployer, 'confirmed')
  const sol = lamports / 1e9
  record('NOTE', `address ${DEPLOYER_PUBKEY}`)
  record(sol < 0.1 ? 'WARN' : 'OK', `SOL balance ${sol.toFixed(6)} SOL (${lamports} lamports)`)
  if (sol < 0.1) {
    record('NOTE', 'below the ~0.15–0.35 SOL a pool creation would need; funding-blocked')
  }

  const usdcMint = new PublicKey(USDC.solanaMainnet)
  const usdcAccounts = await connection.getParsedTokenAccountsByOwner(deployer, { mint: usdcMint })
  if (!usdcAccounts.value.length) {
    record('WARN', 'no USDC token account — deployer holds $0 USDC')
  } else {
    for (const a of usdcAccounts.value) {
      record('NOTE', `USDC ${a.account.data.parsed.info.tokenAmount.uiAmountString}`)
    }
  }

  // ---- 7. unexpected authorities -----------------------------------------
  console.log('')
  console.log('UNEXPECTED STATE')
  const solChecks: [string, PublicKey][] = [
    ['deployer', deployer],
    ['deployer FURL ATA', deployerAta],
  ]
  for (const [label, pk] of solChecks) {
    const acc = await connection.getAccountInfo(pk, 'confirmed')
    if (!acc) {
      record('NOTE', `${label}: account does not exist on chain`)
      continue
    }
    const ownerStr = acc.owner.toBase58()
    const expectedOwner =
      label === 'deployer' ? '11111111111111111111111111111111' : TOKEN_2022_PROGRAM_ID.toBase58()
    ownerStr === expectedOwner
      ? record('OK', `${label} owned by the expected program`)
      : record('WARN', `${label} owned by ${ownerStr}, expected ${expectedOwner}`)
    if (label === 'deployer' && acc.executable) record('FAIL', 'deployer account is executable')
  }

  // Delegates on the treasury account would let a third party move the supply.
  const parsedAta = await connection.getParsedAccountInfo(deployerAta, 'confirmed')
  const ataInfo = (parsedAta.value?.data as { parsed?: { info?: Record<string, unknown> } })?.parsed?.info
  if (ataInfo) {
    const delegate = ataInfo.delegate as string | undefined
    delegate
      ? record('FAIL', `treasury ATA has a DELEGATE: ${delegate} — it can move FURL`)
      : record('OK', 'treasury ATA has no delegate')
    const state = ataInfo.state as string | undefined
    record(state === 'initialized' ? 'OK' : 'WARN', `treasury ATA state: ${state}`)
    const closeAuthority = ataInfo.closeAuthority as string | undefined
    closeAuthority
      ? record('WARN', `treasury ATA close authority: ${closeAuthority}`)
      : record('OK', 'treasury ATA has no close authority')
  }

  // ---- summary ------------------------------------------------------------
  console.log('')
  console.log(RULE)
  const counts = findings.reduce<Record<string, number>>((a, f) => {
    a[f.level] = (a[f.level] ?? 0) + 1
    return a
  }, {})
  console.log(`SUMMARY  OK:${counts.OK ?? 0}  NOTE:${counts.NOTE ?? 0}  WARN:${counts.WARN ?? 0}  FAIL:${counts.FAIL ?? 0}`)
  const fails = findings.filter((f) => f.level === 'FAIL')
  if (fails.length) {
    console.log('')
    console.log('FAILURES:')
    for (const f of fails) console.log(`  - ${f.text}`)
    process.exitCode = 1
  }
  console.log('')
  console.log('Nothing was sent, signed, or modified. This script cannot write to the chain.')
  console.log('Also published: image', IMAGE_URL)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
