/**
 * PHASE 4 — permanent metadata hosting on Arweave via Irys (SOL-paid).
 *
 *   FURL_KEYPAIR=~/.config/solana/furlpay-deployer.json \
 *   npx tsx scripts/upload-arweave.ts
 *
 * Steps:
 *   1. upload the FURL icon PNG  -> permanent Arweave URL
 *   2. build the metadata JSON referencing that image URL (name/symbol/desc/
 *      image/external_url/properties)
 *   3. upload the metadata JSON  -> permanent Arweave URL (this becomes the
 *      token's on-chain `uri`)
 *   4. independently verify BOTH URLs resolve (HTTP 200, JSON parses, fields ok)
 *   5. write the URIs to arweave-uris.json (gitignored) for the mint step
 *
 * Payment: the deployer keypair funds the Irys node with a small amount of SOL.
 * The secret never leaves this process; only the public tx result is printed.
 */
import { Uploader } from '@irys/upload'
import { Solana } from '@irys/upload-solana'
import bs58 from 'bs58'
import { readFileSync, writeFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { FURL, EXTERNAL_URL } from '../src/config.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const ICON_PATH = join(HERE, '..', '..', '..', 'apps', 'web', 'public', 'furl', 'icon.png')
const URIS_OUT = join(HERE, '..', 'arweave-uris.json')
const GATEWAY = 'https://gateway.irys.xyz'

function loadSecretBase58(): string {
  const path = process.env.FURL_KEYPAIR
  if (!path) throw new Error('set FURL_KEYPAIR to the deployer keypair file path')
  const resolved = path.replace(/^~/, process.env.HOME || process.env.USERPROFILE || '')
  const bytes = Uint8Array.from(JSON.parse(readFileSync(resolved, 'utf8')))
  return bs58.encode(bytes) // Irys Solana wallet wants a base58 secret key
}

async function getUploader() {
  const rpc = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com'
  return await Uploader(Solana).withWallet(loadSecretBase58()).withRpc(rpc).mainnet()
}

/** Fund the node for `bytes` if it isn't already covered (Irys free tier <100KiB). */
async function ensureFunded(irys: any, bytes: number) {
  const price = await irys.getPrice(bytes) // atomic units (lamports)
  const bal = await irys.getBalance()
  console.log(`    price=${price.toString()} lamports  nodeBalance=${bal.toString()}`)
  if (bal.lt(price)) {
    const toFund = price.minus(bal).multipliedBy(1.15).integerValue()
    console.log(`    funding Irys node with ${toFund.toString()} lamports...`)
    const f = await irys.fund(toFund)
    console.log(`    funded: ${JSON.stringify(f.id ?? f)}`)
  }
}

async function httpCheck(url: string): Promise<{ ok: boolean; status: number; body?: string; ct?: string }> {
  const r = await fetch(url)
  const ct = r.headers.get('content-type') || ''
  const body = ct.includes('json') || ct.includes('text') ? await r.text() : undefined
  return { ok: r.ok, status: r.status, body, ct }
}

async function main() {
  const irys = await getUploader()
  console.log(`Irys uploader ready — address ${irys.address}`)

  // 1. icon
  const iconBytes = statSync(ICON_PATH).size
  console.log(`\n[1/4] uploading icon (${iconBytes} bytes)`)
  await ensureFunded(irys, iconBytes)
  const iconRes = await irys.uploadFile(ICON_PATH, { tags: [{ name: 'Content-Type', value: 'image/png' }] })
  const imageUrl = `${GATEWAY}/${iconRes.id}`
  console.log(`    icon  -> ${imageUrl}`)

  // 2. metadata JSON (image points at the Arweave icon URL)
  const metadata = {
    name: FURL.name,
    symbol: FURL.symbol,
    description: FURL.description,
    image: imageUrl,
    external_url: EXTERNAL_URL,
    properties: { category: 'image', files: [{ uri: imageUrl, type: 'image/png' }] },
  }
  const metaBuf = Buffer.from(JSON.stringify(metadata, null, 2), 'utf8')
  console.log(`\n[2/4] uploading metadata JSON (${metaBuf.length} bytes)`)
  await ensureFunded(irys, metaBuf.length)
  const metaRes = await irys.upload(metaBuf, { tags: [{ name: 'Content-Type', value: 'application/json' }] })
  const metadataUrl = `${GATEWAY}/${metaRes.id}`
  console.log(`    meta  -> ${metadataUrl}`)

  // 3. verify BOTH resolve
  console.log('\n[3/4] verifying gateway resolution...')
  // Irys is eventually-consistent; poll briefly.
  const waitOk = async (url: string, label: string) => {
    for (let i = 0; i < 10; i++) {
      const c = await httpCheck(url).catch(() => ({ ok: false, status: 0 } as any))
      if (c.ok) return c
      process.stdout.write(`    ${label} not ready (status ${c.status}); retry ${i + 1}/10 in 6s\n`)
      await new Promise((r) => setTimeout(r, 6000))
    }
    throw new Error(`${label} did not resolve at ${url}`)
  }
  const imgCheck = await waitOk(imageUrl, 'image')
  const metaCheck = await waitOk(metadataUrl, 'metadata')
  const parsed = JSON.parse(metaCheck.body!)
  const checks = {
    imageStatus: imgCheck.status, imageContentType: imgCheck.ct,
    metadataStatus: metaCheck.status,
    nameOk: parsed.name === 'FurlPay',
    symbolOk: parsed.symbol === 'FURL',
    imageMatches: parsed.image === imageUrl,
    externalUrlOk: parsed.external_url === EXTERNAL_URL,
  }
  console.log('    ' + JSON.stringify(checks))
  if (!checks.nameOk || !checks.symbolOk || !checks.imageMatches || !checks.externalUrlOk) {
    throw new Error('metadata verification failed — see checks above')
  }

  // 4. record
  const out = {
    uploadedAt: new Date().toISOString(),
    metadataTx: metaRes.id, metadataUrl,
    imageTx: iconRes.id, imageUrl,
    checks,
  }
  writeFileSync(URIS_OUT, JSON.stringify(out, null, 2))
  console.log('\n[4/4] wrote arweave-uris.json')
  console.log(JSON.stringify(out, null, 2))
  console.log('\nNEXT: set METADATA_URI + IMAGE_URL in src/config.ts to these Arweave URLs, update the test, then mint.')
}

main().catch((e) => { console.error('\n✗ Arweave upload failed:', e instanceof Error ? e.message : e); process.exit(1) })
