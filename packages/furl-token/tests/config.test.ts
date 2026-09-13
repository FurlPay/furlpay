/**
 * Invariant tests for the FURL config/supply math. Pure logic — no network,
 * no keypair, safe to run in CI. These assert the properties that must hold
 * for the token to be launchable and honest.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  FURL, ALLOCATIONS, USDC, TOKEN_2022_PROGRAM_ID,
  METADATA_URI, EXTERNAL_URL, IMAGE_URL, ON_CHAIN_ADDITIONAL_METADATA,
  assertConfigLaunchable, allocationAmounts, toBaseUnits,
} from '../src/config.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const METADATA_JSON_PATH = join(HERE, '..', '..', '..', 'apps', 'web', 'public', 'furl', 'metadata.json')
const offchain = JSON.parse(readFileSync(METADATA_JSON_PATH, 'utf8'))

test('allocations total exactly 100%', () => {
  assert.equal(ALLOCATIONS.reduce((a, b) => a + b.percent, 0), 100)
})

test('supply splits to base units with no rounding loss', () => {
  const total = toBaseUnits(FURL.maxSupply)
  const sum = allocationAmounts().reduce((a, r) => a + r.amount, 0n)
  assert.equal(sum, total)
})

test('no banned Token-2022 extension is enabled', () => {
  const banned = ['transferFeeConfig', 'permanentDelegate', 'transferHook', 'defaultAccountState']
  for (const ext of FURL.extensions) assert.ok(!banned.includes(ext), `${ext} must not be enabled`)
})

test('devnet is launchable with placeholder wallets', () => {
  assert.doesNotThrow(() => assertConfigLaunchable('devnet'))
})

test('mainnet is launchable now that all six allocations have addresses', () => {
  assert.doesNotThrow(() => assertConfigLaunchable('mainnet-beta'))
})

test('every allocation has a wallet + is only ever a public address (never a secret)', () => {
  for (const a of ALLOCATIONS) {
    assert.ok(a.wallet, `${a.key} has a wallet`)
    // base58 public key shape; a 64-byte secret array or base58 seed would not match
    assert.match(a.wallet!, /^[1-9A-HJ-NP-Za-km-z]{32,44}$/, `${a.key} is a base58 pubkey`)
  }
})

test('mint authority is set to be revoked (hard cap enforced by runtime)', () => {
  assert.equal(FURL.revokeMintAuthorityAfterInitialMint, true)
})

test('freeze authority is null (holders cannot be censored)', () => {
  assert.equal(FURL.freezeAuthority, null)
})

test('decimals are 6 (USD-stablecoin convention, matches USDC on Solana)', () => {
  assert.equal(FURL.decimals, 6)
})

test('config description carries the intended positioning', () => {
  assert.match(FURL.description, /FurlPay/)
  assert.match(FURL.description, /intended to operate as its stablecoin/i)
  assert.match(FURL.description, /USDC/)
})

test('config does not assert a live USD peg (honesty guard)', () => {
  // The description may say "stablecoin" (positioning) but must not claim the
  // token is already USD-redeemable / reserve-backed, which the mint does not
  // implement.
  assert.doesNotMatch(FURL.description, /redeemable|1:1|fully backed|reserve-backed/i)
})

test('verified addresses look well-formed', () => {
  assert.match(USDC.arbitrumOne, /^0x[0-9a-fA-F]{40}$/)
  assert.match(USDC.arbitrumSepolia, /^0x[0-9a-fA-F]{40}$/)
  assert.match(USDC.solanaMainnet, /^[1-9A-HJ-NP-Za-km-z]{32,44}$/) // base58
  assert.equal(TOKEN_2022_PROGRAM_ID, 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb')
})

test('USDC settlement config is intact on both chains', () => {
  assert.ok(USDC.solanaMainnet && USDC.solanaDevnet, 'Solana USDC set')
  assert.ok(USDC.arbitrumOne && USDC.arbitrumSepolia, 'Arbitrum USDC set')
})

test('symbol is FURL and name is FurlPay', () => {
  assert.equal(FURL.symbol, 'FURL')
  assert.equal(FURL.name, 'FurlPay')
})

/* ---- off-chain metadata JSON (apps/web/public/furl/metadata.json) ---- */

test('metadata JSON is valid and complete', () => {
  assert.equal(offchain.name, 'FurlPay')
  assert.equal(offchain.symbol, 'FURL')
  assert.equal(typeof offchain.description, 'string')
  assert.ok(offchain.description.length > 40)
  assert.match(offchain.image, /^https:\/\/gateway\.irys\.xyz\/[A-Za-z0-9_-]{40,}$/)
  assert.equal(offchain.external_url, EXTERNAL_URL)
})

test('metadata JSON has no duplicate description (single key)', () => {
  const raw = readFileSync(METADATA_JSON_PATH, 'utf8')
  assert.equal((raw.match(/"description"\s*:/g) || []).length, 1)
})

test('on-chain name/symbol agree with the off-chain JSON', () => {
  assert.equal(FURL.name, offchain.name)
  assert.equal(FURL.symbol, offchain.symbol)
})

test('metadata URI + image are permanent Arweave (Irys) URLs, not the 404 furlpay.com', () => {
  assert.match(METADATA_URI, /^https:\/\/gateway\.irys\.xyz\/[A-Za-z0-9_-]{40,}$/)
  assert.match(IMAGE_URL, /^https:\/\/gateway\.irys\.xyz\/[A-Za-z0-9_-]{40,}$/)
  assert.doesNotMatch(METADATA_URI, /furlpay\.com/)
  // the off-chain mirror image must also point at the permanent Arweave icon
  assert.equal(offchain.image, IMAGE_URL)
})

test('metadata positions FURL as the ecosystem stablecoin/payment currency', () => {
  const d = offchain.description.toLowerCase()
  assert.match(d, /furlpay/)
  assert.match(d, /solana/)
  assert.match(d, /usdc/)
  assert.match(d, /stablecoin|payment currency/)
})

test('metadata does NOT falsely claim a live peg / reserves / redemption', () => {
  const d = offchain.description.toLowerCase()
  assert.doesNotMatch(d, /reserve-backed|fully backed|1:1|redeemable|guaranteed/)
})

test('on-chain additional metadata is factual (no unbacked-peg claim)', () => {
  const flat = ON_CHAIN_ADDITIONAL_METADATA.map(([k, v]) => `${k}=${v}`).join(' ').toLowerCase()
  assert.match(flat, /chain=solana/)
  assert.doesNotMatch(flat, /peg|reserve|redeem|backed|utility/)
})
