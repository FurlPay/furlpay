// FurlPay tracked-wallet configuration.
//
// WHY THIS IS THE MOST SAFETY-CRITICAL PARSER IN THE SUBSYSTEM. A FurlPay wallet
// bypasses the alert threshold completely — `isUsdcAlertWorthy` returns true at any
// size — so anything labelled FurlPay alerts on every transfer it touches. Two
// distinct failures follow from that:
//
//   MISLABELLING. This feature shipped with three invented "FurlPay treasury"
//   addresses as seed data, and one of them,
//   0x1111111254fb6c44bac0bed2854e76f90643097d, is the real 1inch v4 aggregation
//   router. Every USDC swap routed through 1inch posted a FurlPay wallet alert
//   naming a treasury that does not exist.
//
//   SILENT INERTNESS. The parser lowercased every address. For EVM that is right;
//   for Solana it is fatal, because base58 is case-sensitive and stored with its
//   original case, so a configured Solana wallet matched nothing, forever, with no
//   error anywhere. The operator's only clue would have been alerts that never came.
//
// So the tests below are mostly about refusing input, and about refusing it loudly.

import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";

let entities: typeof import("./entities.js");

before(async () => {
  // Imported dynamically for the same reason as the lease tests: env.ts reads
  // process.env at module load, and these tests need to vary
  // FURLPAY_TRACKED_WALLETS between cases.
  entities = await import("./entities.js");
});

/**
 * Set the configuration and force a re-parse.
 *
 * Injected rather than set through process.env: env.ts snapshots the environment at
 * module load, so an assignment here would be read by nothing.
 */
function configure(value: string | undefined): void {
  entities.resetFurlPayWalletCache(value ?? null);
}

beforeEach(() => configure(undefined));

const EVM = "0x1234567890abcdef1234567890abcdef12345678";
const SOL = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";

/* ------------------------------------------------------------------ */
/* Nothing configured                                                  */
/* ------------------------------------------------------------------ */

test("no configuration means no wallets, and no invented ones", () => {
  // The seed block that used to live here is why this assertion exists. An empty list
  // is the correct answer to "no wallets configured".
  assert.deepEqual(entities.loadFurlPayTrackedWallets(), []);
  assert.deepEqual(entities.furlPayConfigProblems(), []);
});

test("an empty or whitespace value is not an error", () => {
  configure("   ");
  assert.deepEqual(entities.loadFurlPayTrackedWallets(), []);
  assert.deepEqual(entities.furlPayConfigProblems(), [], "blank is absence, not a mistake");
});

/* ------------------------------------------------------------------ */
/* Accepting valid configuration                                       */
/* ------------------------------------------------------------------ */

test("a JSON array entry is accepted and normalised", () => {
  configure(JSON.stringify([{ chain: "base", address: EVM.toUpperCase().replace("0X", "0x"), label: "Treasury", wallet_type: "furlpay_treasury" }]));
  const w = entities.loadFurlPayTrackedWallets();
  assert.equal(w.length, 1);
  assert.equal(w[0]!.chainSlug, "base");
  assert.equal(w[0]!.address, EVM, "EVM addresses are lowercased to match ingestion");
  assert.equal(w[0]!.entity, "FurlPay");
  assert.deepEqual(entities.furlPayConfigProblems(), []);
});

test("the comma-separated form is accepted", () => {
  configure(`base:${EVM}:Hot Wallet:furlpay_hot_wallet`);
  const w = entities.loadFurlPayTrackedWallets();
  assert.equal(w.length, 1);
  assert.equal(w[0]!.label, "Hot Wallet");
  assert.equal(w[0]!.walletType, "furlpay_hot_wallet");
});

test("a single JSON object, not wrapped in an array, is accepted", () => {
  // The old parser used a failed JSON.parse as the signal to try the comma form, so a
  // value that parsed but was not an array silently produced zero wallets and never
  // reached the fallback.
  configure(JSON.stringify({ chain: "base", address: EVM }));
  assert.equal(entities.loadFurlPayTrackedWallets().length, 1);
});

test("a Solana address keeps its case and resolves", () => {
  // THE SILENT-INERTNESS BUG. Lowercasing this made it match nothing forever.
  configure(`solana:${SOL}:Solana Treasury`);
  const w = entities.loadFurlPayTrackedWallets();
  assert.equal(w.length, 1, "a valid Solana wallet must be accepted");
  assert.equal(w[0]!.address, SOL, "base58 must not be case-folded");

  const hit = entities.getFurlPayWallet("solana", SOL);
  assert.ok(hit, "and it must actually resolve, which is what lowercasing broke");
  assert.equal(hit.label, "Solana Treasury");

  const resolved = entities.resolveEntity("solana", SOL);
  assert.equal(resolved.isFurlPay, true);
  assert.equal(resolved.entity, "FurlPay");
});

/* ------------------------------------------------------------------ */
/* Refusing dangerous configuration                                    */
/* ------------------------------------------------------------------ */

test("a known third-party address cannot be relabelled as FurlPay", () => {
  // THE 1INCH CASE, made impossible to reintroduce by configuration. Coinbase Prime
  // on Ethereum is in the seeded entity map; claiming it as FurlPay would alert on
  // every transfer Coinbase Prime touches, at any size.
  const COINBASE_PRIME = "0xa9d1e08c7793af67e9d92fe308d5697fb81d3e43";
  configure(`ethereum:${COINBASE_PRIME}:Definitely Ours`);

  assert.deepEqual(entities.loadFurlPayTrackedWallets(), [], "refused");
  const problems = entities.furlPayConfigProblems();
  assert.equal(problems.length, 1);
  assert.match(problems[0]!.problem, /known Coinbase address/i);

  // And it still resolves as Coinbase, not as FurlPay.
  const r = entities.resolveEntity("ethereum", COINBASE_PRIME);
  assert.equal(r.isFurlPay, false);
  assert.equal(r.entity, "Coinbase");
});

test("a Circle CCTP contract cannot be claimed as a wallet", () => {
  configure("base:0x28b5a0e9c621a5badaa536219b3a228c8168cf5d:Bridge");
  assert.deepEqual(entities.loadFurlPayTrackedWallets(), []);
  assert.match(entities.furlPayConfigProblems()[0]!.problem, /CCTP contract/i);
});

test("the zero address is refused", () => {
  // It is the mint/burn counterparty. Labelling it FurlPay would attribute every
  // Circle issuance and redemption to a FurlPay wallet.
  configure("base:0x0000000000000000000000000000000000000000:Zero");
  assert.deepEqual(entities.loadFurlPayTrackedWallets(), []);
  assert.match(entities.furlPayConfigProblems()[0]!.problem, /zero \/ system address/i);
});

/* ------------------------------------------------------------------ */
/* Refusing inert configuration                                        */
/* ------------------------------------------------------------------ */

test("a malformed EVM address is refused rather than silently matching nothing", () => {
  configure("base:0xnothex:Typo");
  assert.deepEqual(entities.loadFurlPayTrackedWallets(), []);
  assert.match(entities.furlPayConfigProblems()[0]!.problem, /not a valid address/i);
});

test("a truncated EVM address is refused", () => {
  configure("base:0x1234:Short");
  assert.deepEqual(entities.loadFurlPayTrackedWallets(), []);
  assert.equal(entities.furlPayConfigProblems().length, 1);
});

test("a case-folded Solana address is refused, not silently accepted", () => {
  // This is the exact shape the old parser produced from valid input. It CANNOT be
  // caught by format — lower-casing base58 yields another syntactically valid
  // account, just a different one — so the check is statistical: a real ~44-character
  // pubkey essentially always contains upper case. Missing it is silent and permanent;
  // a false positive costs one clear error.
  configure(`solana:${SOL.toLowerCase()}:Oops`);
  assert.deepEqual(entities.loadFurlPayTrackedWallets(), []);
  assert.match(entities.furlPayConfigProblems()[0]!.problem, /case-folded/i);
});

test("an EVM address on a Solana chain slug is refused", () => {
  configure(`solana:${EVM}:Wrong family`);
  assert.deepEqual(entities.loadFurlPayTrackedWallets(), []);
});

test("an unknown chain is refused", () => {
  // A typo'd chain name used to be accepted and then match nothing.
  configure(`etherium:${EVM}:Typo`);
  assert.deepEqual(entities.loadFurlPayTrackedWallets(), []);
  assert.match(entities.furlPayConfigProblems()[0]!.problem, /unknown chain/i);
});

test("an unknown wallet_type is refused", () => {
  configure(`base:${EVM}:Label:not_a_type`);
  assert.deepEqual(entities.loadFurlPayTrackedWallets(), []);
  assert.match(entities.furlPayConfigProblems()[0]!.problem, /wallet_type/i);
});

test("a malformed comma entry is refused with a usable message", () => {
  configure("justoneword");
  assert.deepEqual(entities.loadFurlPayTrackedWallets(), []);
  assert.match(entities.furlPayConfigProblems()[0]!.problem, /chain:address/i);
});

test("JSON that does not parse is reported, not silently ignored", () => {
  configure('[{"chain":"base",');
  assert.deepEqual(entities.loadFurlPayTrackedWallets(), []);
  assert.match(entities.furlPayConfigProblems()[0]!.problem, /does not parse/i);
});

/* ------------------------------------------------------------------ */
/* Mixed and duplicate input                                           */
/* ------------------------------------------------------------------ */

test("one bad entry does not discard the good ones", () => {
  const OTHER = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
  configure(`base:${EVM}:Good,base:0xbroken:Bad,ethereum:${OTHER}:AlsoGood`);

  const w = entities.loadFurlPayTrackedWallets();
  assert.equal(w.length, 2, "the valid entries are kept");
  assert.equal(entities.furlPayConfigProblems().length, 1, "and the bad one is reported");
});

test("a duplicate address is kept once and reported", () => {
  // Two entries for one address would resolve unpredictably depending on iteration
  // order, so which label wins would be arbitrary.
  configure(`base:${EVM}:First,base:${EVM}:Second`);
  const w = entities.loadFurlPayTrackedWallets();
  assert.equal(w.length, 1);
  assert.equal(w[0]!.label, "First", "the first wins, deterministically");
  assert.match(entities.furlPayConfigProblems()[0]!.problem, /more than once/i);
});

test("the same address on two chains is two distinct wallets", () => {
  // An EVM address legitimately exists on several chains and may hold funds on each.
  configure(`base:${EVM}:Base,ethereum:${EVM}:Ethereum`);
  assert.equal(entities.loadFurlPayTrackedWallets().length, 2);
  assert.deepEqual(entities.furlPayConfigProblems(), []);
});

/* ------------------------------------------------------------------ */
/* An unrelated address must never read as FurlPay                     */
/* ------------------------------------------------------------------ */

test("an untracked address that looks like a treasury is not FurlPay", () => {
  // The 1inch router itself, unconfigured. It must resolve as an ordinary unknown
  // wallet — subject to the normal alert threshold, not exempt from it.
  configure(`base:${EVM}:Ours`);
  const ONEINCH = "0x1111111254fb6c44bac0bed2854e76f90643097d";

  const r = entities.resolveEntity("ethereum", ONEINCH);
  assert.equal(r.isFurlPay, false, "never FurlPay by accident");
  assert.equal(r.entity, null);
  assert.equal(r.label, "Unknown Wallet");
  assert.equal(entities.getFurlPayWallet("ethereum", ONEINCH), null);
});

test("configuring one wallet does not make its chain's other addresses FurlPay", () => {
  configure(`base:${EVM}:Ours`);
  const neighbour = "0x1234567890abcdef1234567890abcdef12345679"; // last nibble differs
  assert.equal(entities.getFurlPayWallet("base", neighbour), null);
  assert.equal(entities.resolveEntity("base", neighbour).isFurlPay, false);
});

test("a configured wallet is FurlPay only on the chain it was configured for", () => {
  configure(`base:${EVM}:Ours`);
  assert.ok(entities.getFurlPayWallet("base", EVM), "on its own chain");
  assert.equal(entities.getFurlPayWallet("ethereum", EVM), null, "and not on another");
});
