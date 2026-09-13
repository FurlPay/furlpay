/**
 * Generate a NEW Solana deployer keypair, stored locally OUTSIDE the repo.
 *
 *   npx tsx scripts/new-deployer-keypair.ts               # default path
 *   npx tsx scripts/new-deployer-keypair.ts --out <path>  # custom path
 *
 * Design choices that keep the secret safe:
 *   - Default location is ~/.config/solana/furlpay-deployer.json — the standard
 *     Solana CLI keypair dir, deliberately NOT inside this git repo.
 *   - Refuses to write anywhere under the repo working tree.
 *   - Refuses to overwrite an existing file (no silent key rotation).
 *   - On POSIX, chmods the file to 0600.
 *   - Prints ONLY the public address. The secret bytes never touch stdout.
 *
 * This is a DEPLOYER key (pays gas, holds mint authority until revoked). It is
 * NOT your treasury. Treasury/team/liquidity should be separate wallets, and a
 * multisig for anything holding real value.
 */
import { Keypair } from '@solana/web3.js'
import { writeFileSync, existsSync, chmodSync, mkdirSync } from 'node:fs'
import { homedir, platform } from 'node:os'
import { join, resolve, dirname } from 'node:path'

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i !== -1 ? process.argv[i + 1] : undefined }

const home = homedir()
const defaultPath = join(home, '.config', 'solana', 'furlpay-deployer.json')
const outPath = resolve(arg('out') || defaultPath)

// Never let the secret land inside the repo (where it could be committed).
const repoRoot = resolve(join(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..', '..'))
if (outPath.startsWith(repoRoot)) {
  console.error(`refusing to write a key inside the repo (${outPath}).\nUse --out with a path outside ${repoRoot}, or the default ~/.config/solana/.`)
  process.exit(1)
}
if (existsSync(outPath)) {
  console.error(`refusing to overwrite existing keypair at ${outPath}. Delete it yourself if you truly mean to rotate.`)
  process.exit(1)
}

const kp = Keypair.generate()
mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, JSON.stringify(Array.from(kp.secretKey)))
if (platform() !== 'win32') { try { chmodSync(outPath, 0o600) } catch {} }

console.log('Deployer keypair created.')
console.log(`  public address : ${kp.publicKey.toBase58()}`)
console.log(`  secret stored  : ${outPath}  (keep this private; never commit it)`)
console.log('\nUse it by exporting the path:')
console.log(`  export FURL_KEYPAIR="${outPath}"`)
console.log('\nFund this address with a little SOL for gas:')
console.log('  devnet  : the deploy script will airdrop automatically')
console.log('  mainnet : send ~0.05 SOL to the address above')
