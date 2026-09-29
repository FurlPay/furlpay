// CCTP V2 decoder tests, against real logs.
//
// The fixture is not synthesised. `fixtures/cctp-v2-base.json` holds
// `DepositForBurn` and `MessageReceived` logs read off Base mainnet with
// eth_getLogs on 2026-09-29. That matters more than usual here, because a
// hand-written fixture would only ever prove that the decoder agrees with
// whatever the test author believed the layout to be — which is precisely the
// thing that needs checking.
//
// A wrong offset in these decoders does not throw. It reads an adjacent 32-byte
// word and produces a plausible-looking number: a destination domain that is some
// other chain, or an amount off by a factor of 2^96. Every assertion below is
// about pinning offsets that fail silently when wrong.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  decodeDepositForBurn,
  decodeMessageReceived,
  decodeMintAndWithdraw,
  isEvmBytes32,
  isPendingNonce,
  pendingNonceKey,
} from "./cctpScanner.js";
import { cctpMatchKey } from "./iris.js";
import { CCTP_DOMAINS, USDC_ASSETS, isNativeUsdc } from "./registry.js";

interface RawLog {
  address: string;
  topics: string[];
  data: string;
  blockNumber: string;
  transactionHash: string;
  logIndex: string;
}

const HERE = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  readFileSync(join(HERE, "fixtures", "cctp-v2-base.json"), "utf8")
) as {
  depositForBurn: RawLog[];
  messageReceived: RawLog[];
};

/* ------------------------------------------------------------------ */
/* DepositForBurn                                                      */
/* ------------------------------------------------------------------ */

test("every real DepositForBurn log decodes", () => {
  assert.ok(fixture.depositForBurn.length > 0, "fixture has no burns");

  for (const l of fixture.depositForBurn) {
    const d = decodeDepositForBurn(l);
    assert.ok(d, `failed to decode burn in ${l.transactionHash}`);

    // These logs came from Base, so the burn token must be Base's native USDC.
    // This one assertion catches a wrong topics index for burnToken.
    assert.equal(
      d.burnToken,
      USDC_ASSETS.base!.contractOrMint,
      "burnToken did not decode to Base native USDC"
    );
    assert.ok(isNativeUsdc("base", d.burnToken));

    assert.match(d.depositor, /^0x[0-9a-f]{40}$/);

    // A real destination domain, not an adjacent word read as one. A wrong offset
    // here typically yields an enormous number or zero.
    assert.ok(
      CCTP_DOMAINS[d.destinationDomain],
      `destinationDomain ${d.destinationDomain} is not a real CCTP domain — offset is wrong`
    );

    // Amount sanity. A single USDC transfer above a billion would be
    // extraordinary; seeing one here means the 6-decimal scaling is wrong.
    assert.ok(d.amount > 0, "amount decoded as zero or negative");
    assert.ok(d.amount < 1e9, `amount ${d.amount} implausible — check decimal scaling`);

    // maxFee is a fee, so it must be small relative to the amount. This is the
    // assertion that catches maxFee being read from the wrong word — it would
    // come back as a mint recipient interpreted as a number, which is astronomical.
    assert.ok(d.maxFee >= 0);
    assert.ok(
      d.maxFee < d.amount + 1,
      `maxFee ${d.maxFee} exceeds amount ${d.amount} — maxFee offset is wrong`
    );

    // CCTP V2 uses 1000 for fast and 2000 for standard. Anything else means
    // topics[3] is not minFinalityThreshold.
    assert.ok(
      d.minFinalityThreshold === 1000 || d.minFinalityThreshold === 2000,
      `unexpected finality threshold ${d.minFinalityThreshold}`
    );

    assert.match(d.mintRecipient, /^0x[0-9a-f]{64}$/, "mintRecipient is not a bytes32");
  }
});

test("a DepositForBurn log with the wrong topic0 is refused", () => {
  const l = { ...fixture.depositForBurn[0]! };
  l.topics = [
    "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
    ...l.topics.slice(1),
  ];
  assert.equal(decodeDepositForBurn(l), null);
});

test("a truncated DepositForBurn returns null rather than a partial burn", () => {
  // Half-decoded is the dangerous outcome: it would enter the table as real.
  const l = { ...fixture.depositForBurn[0]!, data: "0x00" };
  assert.equal(decodeDepositForBurn(l), null);
});

test("a zero-amount burn is refused", () => {
  const l = fixture.depositForBurn[0]!;
  const zeroed = "0x" + "0".repeat(64) + l.data.slice(66);
  assert.equal(decodeDepositForBurn({ ...l, data: zeroed }), null);
});

/* ------------------------------------------------------------------ */
/* MessageReceived                                                     */
/* ------------------------------------------------------------------ */

test("every real MessageReceived header decodes", () => {
  assert.ok(fixture.messageReceived.length > 0, "fixture has no mints");

  for (const l of fixture.messageReceived) {
    const d = decodeMessageReceived(l);
    assert.ok(d, `failed to decode mint in ${l.transactionHash}`);

    // The nonce is the correlation key, and it is a bytes32 topic. If this is not
    // a 32-byte hex value, the join will never match anything.
    assert.match(d.nonce, /^0x[0-9a-f]{64}$/, "nonce is not a bytes32 topic");

    assert.ok(
      CCTP_DOMAINS[d.sourceDomain],
      `sourceDomain ${d.sourceDomain} is not a real CCTP domain`
    );

    assert.ok(
      d.finalityThresholdExecuted === 1000 || d.finalityThresholdExecuted === 2000,
      `unexpected executed finality ${d.finalityThresholdExecuted}`
    );
  }
});

test("MessageTransmitterV2 carries non-token messages, and they yield no amount", () => {
  // THE BUG THIS TEST EXISTS FOR. MessageTransmitterV2 is generic cross-chain
  // messaging; anyone can use it. The fixture contains a real third-party message
  // from HyperEVM (domain 19) whose body version is 0, not 1. Decoding it as a
  // CCTP BurnMessage produced an "amount" of $42,949,672,960 — a fabricated
  // figure that would have gone straight into a daily total.
  const nonToken = fixture.messageReceived
    .map((l) => decodeMessageReceived(l))
    .filter((d) => d !== null && d.bodyVersion !== 1);

  assert.ok(
    nonToken.length > 0,
    "fixture no longer contains a non-token message — the guard is untested"
  );

  for (const d of nonToken) {
    assert.equal(d!.amount, null, "a non-token CCTP message must never report an amount");
    assert.equal(d!.mintRecipient, null);
  }
});

test("a CCTP V2 burn message body decodes to a plausible amount", () => {
  const tokenMsgs = fixture.messageReceived
    .map((l) => decodeMessageReceived(l))
    .filter((d) => d !== null && d.bodyVersion === 1);

  assert.ok(tokenMsgs.length > 0, "fixture has no token transfers");

  for (const d of tokenMsgs) {
    assert.ok(d!.amount !== null, "a version-1 body must yield an amount");
    assert.ok(d!.amount! > 0 && d!.amount! < 1e9, `amount ${d!.amount} implausible`);
    assert.match(d!.mintRecipient!, /^0x[0-9a-f]{64}$/);
  }
});

test("a non-EVM source chain's burn token is not coerced into an address", () => {
  // Measured: a third of the mints arriving on Base came from Solana, Stellar and
  // Arc. A Solana mint fills all 32 bytes, so taking the last 20 as an EVM address
  // produces a meaningless value — and one that would fail an isNativeUsdc check
  // and cause the mint to be discarded. `burnToken` is therefore null for those,
  // with the raw bytes kept separately.
  let sawNonEvm = false;
  for (const l of fixture.messageReceived) {
    const d = decodeMessageReceived(l);
    if (!d || d.bodyVersion !== 1 || !d.burnTokenRaw) continue;

    const sourceIsEvm = Object.values(USDC_ASSETS).some(
      (a) => a.cctpDomain === d.sourceDomain && a.kind === "evm"
    );
    if (sourceIsEvm) {
      // For an EVM source the token IS an address, and it must be that chain's
      // native USDC.
      const slug = Object.values(USDC_ASSETS).find((a) => a.cctpDomain === d.sourceDomain)!.chainSlug;
      assert.ok(d.burnToken, `EVM source ${slug} should decode to an address`);
      assert.ok(
        isNativeUsdc(slug, d.burnToken!),
        `source ${slug} burnToken ${d.burnToken} is not its native USDC`
      );
    } else {
      sawNonEvm = true;
      assert.equal(
        d.burnToken,
        null,
        `non-EVM source domain ${d.sourceDomain} must not produce an EVM address`
      );
      assert.match(d.burnTokenRaw, /^0x[0-9a-f]{64}$/);
    }
  }
  assert.ok(sawNonEvm, "fixture has no non-EVM-origin mint — the rule is untested");
});

test("isEvmBytes32 separates a padded address from full-width bytes", () => {
  assert.ok(isEvmBytes32("0x" + "0".repeat(24) + "a".repeat(40)));
  // A Solana mint uses the leading bytes, so it is not a padded address.
  assert.equal(isEvmBytes32("0x" + "c6fa7af3" + "b".repeat(56)), false);
  // All zeros is not a usable address either.
  assert.equal(isEvmBytes32("0x" + "0".repeat(64)), false);
  assert.equal(isEvmBytes32("0xabc"), false);
});

/* ------------------------------------------------------------------ */
/* MintAndWithdraw                                                     */
/* ------------------------------------------------------------------ */

test("MintAndWithdraw decodes, and rejects the wrong topic", () => {
  // Synthesised from the verified layout, because the fixture captured the
  // MessageTransmitter and TokenMessenger reads separately. The layout itself was
  // read off a live Base log — see registry.ts.
  const log = {
    topics: [
      "0x50c55e915134d457debfa58eb6f4342956f8b0616d51a89a3659360178e1ab63",
      "0x" + "0".repeat(24) + "1234567890abcdef1234567890abcdef12345678", // mintRecipient
      "0x" + "0".repeat(24) + USDC_ASSETS.base!.contractOrMint.slice(2), // mintToken
    ],
    // amount = 14577769 base units ($14.577769), feeCollected = 1457 ($0.001457).
    // Both taken from a real observed Base mint.
    data:
      "0x" +
      (14577769).toString(16).padStart(64, "0") +
      (1457).toString(16).padStart(64, "0"),
  };

  const d = decodeMintAndWithdraw(log);
  assert.ok(d);
  assert.equal(d.mintToken, USDC_ASSETS.base!.contractOrMint);
  assert.ok(isNativeUsdc("base", d.mintToken), "mintToken must validate against the DESTINATION chain");
  assert.equal(d.amount, 14.577769);
  assert.equal(d.feeCollected, 0.001457);
  assert.equal(d.mintRecipient, "0x1234567890abcdef1234567890abcdef12345678");

  // Wrong topic0 must be refused outright.
  assert.equal(
    decodeMintAndWithdraw({ ...log, topics: ["0x" + "1".repeat(64), ...log.topics.slice(1)] }),
    null
  );
  // A zero-amount mint is not a transfer.
  assert.equal(
    decodeMintAndWithdraw({ ...log, data: "0x" + "0".repeat(128) }),
    null
  );
});

test("the mint side adds the collected fee back before keying the match", () => {
  // CCTP takes its fee out of the transfer, so the mint is SMALLER than the burn.
  // The burn side keys on what it burned; the mint side must therefore key on
  // amount + feeCollected or the two never agree. This is the arithmetic that
  // would silently disable the fallback join on every fast transfer.
  const burned = 14.579226;
  const minted = 14.577769;
  const fee = 0.001457;

  assert.ok(Math.abs(burned - (minted + fee)) < 1e-9, "fixture arithmetic is wrong");

  const recipient = "0x1234567890abcdef1234567890abcdef12345678";
  const burnKey = cctpMatchKey(0, 6, burned, "0x" + "0".repeat(24) + recipient.slice(2));
  const mintKey = cctpMatchKey(0, 6, minted + fee, recipient);
  assert.equal(burnKey, mintKey);

  // And without the fee added back, it must NOT match — proving the test is
  // actually exercising the correction rather than passing by luck.
  assert.notEqual(cctpMatchKey(0, 6, minted, recipient), burnKey);
});

test("a MessageReceived with a mangled body offset yields no amount, not a wrong one", () => {
  const l = fixture.messageReceived[0]!;
  // Point the body offset far past the end of the data.
  const words = (l.data.slice(2).match(/.{64}/g) ?? []).slice();
  words[2] = (99999).toString(16).padStart(64, "0");
  const d = decodeMessageReceived({ ...l, data: "0x" + words.join("") });
  assert.ok(d, "header should still decode");
  assert.equal(d.amount, null, "an unreadable body must not produce an amount");
});

/* ------------------------------------------------------------------ */
/* Correlation keys                                                    */
/* ------------------------------------------------------------------ */

test("a pending nonce is unique per burn and never looks like a real nonce", () => {
  const a = pendingNonceKey("0xABC", 3);
  const b = pendingNonceKey("0xABC", 4);

  assert.notEqual(a, b, "two burns in one tx must not share a key");
  assert.ok(isPendingNonce(a));
  // A real CCTP nonce is 0x + 64 hex. A placeholder must never be mistaken for
  // one, because the embed prints the nonce as provenance.
  assert.doesNotMatch(a, /^0x[0-9a-f]{64}$/);
  // Case-insensitive on the tx hash, so the same burn seen twice keys the same.
  assert.equal(pendingNonceKey("0xabc", 3), a);

  assert.equal(isPendingNonce("0x" + "a".repeat(64)), false);
});

test("the heuristic match key agrees across both sides of a transfer", () => {
  // The burn side knows (its domain, destination, amount, recipient). The mint
  // side reads the same four out of the message body. Both must compute the same
  // key or the fallback join never fires.
  const burnSide = cctpMatchKey(6, 3, 1234.56, "0x000000000000000000000000abcDEF1234567890abcdef1234567890ABcdef12");
  const mintSide = cctpMatchKey(6, 3, 1234.56, "0xabcdef1234567890abcdef1234567890abcdef12");
  assert.equal(burnSide, mintSide, "bytes32 padding or case broke the match key");
});

test("the match key distinguishes what it must", () => {
  const base = cctpMatchKey(6, 3, 100, "0xaa");
  assert.notEqual(base, cctpMatchKey(0, 3, 100, "0xaa"), "source domain ignored");
  assert.notEqual(base, cctpMatchKey(6, 0, 100, "0xaa"), "dest domain ignored");
  assert.notEqual(base, cctpMatchKey(6, 3, 101, "0xaa"), "amount ignored");
  assert.notEqual(base, cctpMatchKey(6, 3, 100, "0xbb"), "recipient ignored");
  // A sub-cent difference must still separate them — quantisation is to base
  // units, not to dollars.
  assert.notEqual(base, cctpMatchKey(6, 3, 100.000001, "0xaa"));
});

test("the match key survives a float round-trip", () => {
  // The burn side scales from a bigint; the mint side scales from a different
  // bigint by the same route. Equal amounts must still key equal after the
  // division, which is why the key quantises rather than stringifying the float.
  const a = cctpMatchKey(6, 3, Number(123456789n) / 1e6, "0xaa");
  const b = cctpMatchKey(6, 3, 123.456789, "0xaa");
  assert.equal(a, b);
});
