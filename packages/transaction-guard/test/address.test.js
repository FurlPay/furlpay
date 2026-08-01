import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isAddress,
  isNonZeroAddress,
  toChecksumAddress,
  sameAddress,
} from "../dist/index.js";

// ---------------------------------------------------------------------------
// EIP-55, against the canonical vectors from the ERC itself.
//
// These double as a keccak correctness test: the checksum is derived from
// keccak(lowercase address), so if the hash were wrong none of them would pass.
// ---------------------------------------------------------------------------

/** From the "Test Cases" section of ERC-55. */
const CANONICAL = [
  "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
  "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359",
  "0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB",
  "0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb",
];

test("accepts correctly checksummed addresses", () => {
  for (const address of CANONICAL) {
    assert.ok(isAddress(address), address);
  }
});

test("rejects a mixed-case address whose checksum is wrong", () => {
  // One character's case flipped — the typo EIP-55 exists to catch, and the
  // reason a length-only regex is not enough.
  for (const address of CANONICAL) {
    const body = address.slice(2);
    const i = body.search(/[a-fA-F]/);
    const flipped =
      body[i] === body[i].toUpperCase() ? body[i].toLowerCase() : body[i].toUpperCase();
    const broken = "0x" + body.slice(0, i) + flipped + body.slice(i + 1);
    assert.ok(!isAddress(broken), broken);
  }
});

test("accepts all-lowercase and all-uppercase — neither claims a checksum", () => {
  // Getting this inverted turns a safety check into an outage: lowercase is
  // what plenty of explorers and RPC responses emit, and ERC-55 says it is
  // valid.
  for (const address of CANONICAL) {
    assert.ok(isAddress(address.toLowerCase()), "lowercase");
    assert.ok(isAddress("0x" + address.slice(2).toUpperCase()), "uppercase");
  }
});

test("rejects anything that is not a 20-byte hex address", () => {
  const bad = [
    "0x123",
    "",
    "not-an-address",
    "0x" + "z".repeat(40),
    "5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed", // no 0x
    "0x" + "a".repeat(41),
    null,
    undefined,
    42,
    {},
  ];
  for (const value of bad) {
    assert.ok(!isAddress(value), String(value));
  }
});

test("treats the zero address as well-formed but never a counterparty", () => {
  const zero = "0x" + "0".repeat(40);
  assert.ok(isAddress(zero), "well-formed");
  // Sending to it burns funds; approving it is meaningless.
  assert.ok(!isNonZeroAddress(zero), "never a counterparty");
  assert.ok(isNonZeroAddress(CANONICAL[0]), "a real address is");
});

test("toChecksumAddress round-trips the canonical vectors", () => {
  for (const address of CANONICAL) {
    assert.equal(toChecksumAddress(address.toLowerCase()), address);
    assert.equal(toChecksumAddress(address), address);
  }
});

test("toChecksumAddress refuses a malformed input rather than guessing", () => {
  assert.throws(() => toChecksumAddress("0x123"), TypeError);
});

test("sameAddress compares accounts, not casing", () => {
  const a = CANONICAL[0];
  assert.ok(sameAddress(a, a.toLowerCase()));
  assert.ok(!sameAddress(a, CANONICAL[1]));
  // Malformed input is never "the same" as anything.
  assert.ok(!sameAddress(a, "0x123"));
  assert.ok(!sameAddress(null, null));
});
