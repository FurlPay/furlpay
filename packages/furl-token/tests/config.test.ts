/**
 * Invariant tests for the FURL config/supply math. Pure logic — no network,
 * no keypair, safe to run in CI. These assert the properties that must hold
 * for the token to be launchable and honest.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  FURL, ALLOCATIONS, USDC, TOKEN_2022_PROGRAM_ID,
  assertConfigLaunchable, allocationAmounts, toBaseUnits,
} from '../src/config.ts'

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

test('mainnet is REFUSED while allocation wallets are unset', () => {
  assert.throws(() => assertConfigLaunchable('mainnet-beta'), /requires wallets for/)
})

test('mint authority is set to be revoked (hard cap enforced by runtime)', () => {
  assert.equal(FURL.revokeMintAuthorityAfterInitialMint, true)
})

test('freeze authority is null (holders cannot be censored)', () => {
  assert.equal(FURL.freezeAuthority, null)
})

test('decimals are 9 and NOT 6 (FURL is not a stablecoin)', () => {
  assert.equal(FURL.decimals, 9)
  assert.notEqual(FURL.decimals, 6)
})

test('verified addresses look well-formed', () => {
  assert.match(USDC.arbitrumOne, /^0x[0-9a-fA-F]{40}$/)
  assert.match(USDC.arbitrumSepolia, /^0x[0-9a-fA-F]{40}$/)
  assert.match(USDC.solanaMainnet, /^[1-9A-HJ-NP-Za-km-z]{32,44}$/) // base58
  assert.equal(TOKEN_2022_PROGRAM_ID, 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb')
})
