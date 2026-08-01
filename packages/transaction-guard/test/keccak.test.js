import { test } from "node:test";
import assert from "node:assert/strict";
import { keccak256 } from "../dist/index.js";
import { utf8, toHex } from "../dist/keccak.js";

// ---------------------------------------------------------------------------
// Keccak-256 against PUBLISHED digests.
//
// This package implements the hash rather than importing one, so these vectors
// are the only thing standing between it and a silently wrong EIP-55 check.
// They are external ground truth, not values captured from this implementation
// — a snapshot of our own output would have happily locked in the bug this
// caught during development (a rotation table indexed by lane instead of by
// loop iteration, which permutes plausibly and hashes wrongly).
// ---------------------------------------------------------------------------

test("matches published Keccak-256 digests", () => {
  const vectors = [
    ["", "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470"],
    ["abc", "4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45"],
    ["testing", "5f16f4c7f149ac4f9510d9cf8cf384038ad348b3bcdc01915f95de12df9d1b02"],
  ];
  for (const [input, expected] of vectors) {
    assert.equal(toHex(keccak256(utf8(input))), expected, `keccak256(${JSON.stringify(input)})`);
  }
});

test("is Keccak, not SHA3-256", () => {
  // The two differ by one padding byte (0x01 vs 0x06) and produce completely
  // different digests. SHA3-256("") is a6…a which must NOT appear here.
  const empty = toHex(keccak256(utf8("")));
  assert.equal(empty.slice(0, 2), "c5");
  assert.notEqual(empty, "a7ffc6f8bf1ed76651c14756a061d662f580ff4de43b49fa82d80a4b80f8434a");
});

test("absorbs inputs spanning multiple rate blocks", () => {
  // The rate is 136 bytes. Anything longer exercises the absorb loop, and the
  // boundary cases exercise the padding.
  for (const length of [135, 136, 137, 272, 300]) {
    const digest = toHex(keccak256(utf8("a".repeat(length))));
    assert.match(digest, /^[0-9a-f]{64}$/, `length ${length}`);
  }
});

test("is deterministic and avalanches", () => {
  const a = toHex(keccak256(utf8("furlpay")));
  const b = toHex(keccak256(utf8("furlpay")));
  const c = toHex(keccak256(utf8("furlpaz")));
  assert.equal(a, b);
  assert.notEqual(a, c);
});
