/**
 * Token-2022 mint extension parsing — regression test for the offset bug.
 *
 * THE BUG THIS PINS. The audit script parsed the extension TLV list starting at
 * byte 165 of the mint account. The correct offset is 166. Token-2022 lays a
 * mint out as:
 *
 *   [0   .. 81 ]  the 82-byte base Mint struct
 *   [82  .. 164]  zero padding, so the account matches the 165-byte size of a
 *                 token Account (this is what makes a Mint and an Account
 *                 distinguishable only by the next byte)
 *   [165       ]  ONE account-type discriminator byte — 1 = Mint, 2 = Account
 *   [166 ..    ]  the extension TLV list
 *
 * Starting at 165 feeds the discriminator into the TLV parser as if it were the
 * first two bytes of an extension type. The parse yields NOTHING, and the audit
 * then reported "MetadataPointer expected by config but NOT found on chain" —
 * a false alarm about a mint that has the extension, on the one script whose
 * entire job is to be trusted about on-chain state.
 *
 * A false NEGATIVE from a security audit is worse than no audit: it produces a
 * warning that someone must chase, and it trains the reader to discount the
 * tool. Hence this test.
 *
 * OFFLINE AND DETERMINISTIC. It runs against `fixtures/furl-mint-account.json`,
 * the real mint account bytes captured from mainnet on 2026-09-13 (516 bytes,
 * owner TokenzQd…, byte 165 = 1). No network, so CI cannot be flaky and cannot
 * be fooled by an RPC that returns something else.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { getExtensionTypes, ExtensionType, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token'
import { MINT_ADDRESS, FURL } from '../src/config.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const fixture = JSON.parse(
  readFileSync(join(HERE, 'fixtures', 'furl-mint-account.json'), 'utf8'),
) as { mint: string; owner: string; dataLength: number; dataBase64: string }

const data = Buffer.from(fixture.dataBase64, 'base64')

/** The correct offset. 165 is the account-type byte; extensions follow it. */
const EXTENSION_TLV_OFFSET = 166

test('the fixture is the real FURL mint, owned by Token-2022', () => {
  assert.equal(fixture.mint, MINT_ADDRESS)
  assert.equal(fixture.owner, TOKEN_2022_PROGRAM_ID.toBase58())
  assert.equal(data.length, fixture.dataLength)
  // Longer than a bare 82-byte mint, which is what having extensions means.
  assert.ok(data.length > 165, 'mint account carries extension data')
})

test('byte 165 is the account-type discriminator, and it says Mint', () => {
  // This byte is the entire reason the offset is 166 and not 165.
  assert.equal(data[165], 1, 'account type 1 = Mint')
})

test('parsing at offset 166 finds BOTH extensions', () => {
  const names = getExtensionTypes(data.subarray(EXTENSION_TLV_OFFSET)).map((t) => ExtensionType[t])
  assert.ok(names.includes('MetadataPointer'), `MetadataPointer present (got: ${names.join(', ')})`)
  assert.ok(names.includes('TokenMetadata'), `TokenMetadata present (got: ${names.join(', ')})`)
})

test('REGRESSION: parsing at offset 165 loses the extensions', () => {
  // The exact failure mode. If someone "simplifies" the offset back to 165,
  // the assertion below stops holding and this test fails — which is the point.
  const wrong = getExtensionTypes(data.subarray(165)).map((t) => ExtensionType[t])
  const right = getExtensionTypes(data.subarray(EXTENSION_TLV_OFFSET)).map((t) => ExtensionType[t])

  assert.notDeepEqual(wrong, right, 'offset 165 and 166 must not agree — 165 is wrong')
  assert.ok(
    !wrong.includes('MetadataPointer'),
    'offset 165 fails to find MetadataPointer — this is the bug being pinned',
  )
  assert.ok(right.length > wrong.length, 'the correct offset finds strictly more extensions')
})

test('the audit script uses offset 166, not 165', () => {
  // Pins the call site itself, so the constant cannot drift back in the script
  // even if this test file keeps passing on its own.
  const script = readFileSync(join(HERE, '..', 'scripts', 'audit-mainnet.ts'), 'utf8')
  assert.match(script, /getExtensionTypes\(info\.data\.subarray\(166\)\)/)
  assert.doesNotMatch(script, /getExtensionTypes\(info\.data\.subarray\(165\)\)/)
})

test('FURL carries exactly the two extensions config declares — no more', () => {
  const names = getExtensionTypes(data.subarray(EXTENSION_TLV_OFFSET)).map((t) => ExtensionType[t])

  // Case-insensitive compare: the enum is PascalCase, the config is camelCase.
  const onChain = names.map((n) => n?.toLowerCase()).sort()
  const declared = [...FURL.extensions].map((n) => n.toLowerCase()).sort()
  assert.deepEqual(onChain, declared)
})

test('none of the dangerous extensions is present on the mint', () => {
  // Their absence is the security property, so it is asserted against the real
  // account bytes rather than assumed from the launch config.
  const names = getExtensionTypes(data.subarray(EXTENSION_TLV_OFFSET)).map((t) => ExtensionType[t])
  for (const banned of [
    'TransferFeeConfig',
    'TransferHook',
    'PermanentDelegate',
    'DefaultAccountState',
    'ConfidentialTransferMint',
    'MintCloseAuthority',
    'NonTransferable',
  ]) {
    assert.ok(!names.includes(banned), `${banned} must NOT be present`)
  }
})
