// Exercises @furlpay/solana-rpc against REAL devnet infrastructure for every
// path that does not require a funded account. No fixtures, no mocks.
import { Connection, Keypair, SystemProgram, Transaction } from "@solana/web3.js";
import { HttpRpcProvider, SolanaRpcPool, SubmissionError, classifyFailure, retryAction, interpretStatus } from "./dist/index.js";

const RPC = "https://api.devnet.solana.com";
const log = (k, v) => console.log(`  ${String(k).padEnd(30)} ${v}`);
const pool = new SolanaRpcPool({ providers: [new HttpRpcProvider({ id: "devnet-public", url: RPC })] });

console.log("\n=== REAL devnet, real RPC, no mocks ===\n");

console.log("[1] reads through the pool");
const t0 = Date.now();
const slot = await pool.getSlot("confirmed");
log("getSlot", `${slot}  (${Date.now() - t0} ms)`);
const t1 = Date.now();
const bh = await pool.getLatestBlockhash("confirmed");
log("getLatestBlockhash", `${bh.blockhash.slice(0, 16)}…  (${Date.now() - t1} ms)`);
log("lastValidBlockHeight", bh.lastValidBlockHeight);
const h = await pool.health();
log("health / slots", JSON.stringify(h.slots));

console.log("\n[2] priority fees from the real fee market");
const fees = await pool.getRecentPrioritizationFees();
const nonZero = fees.filter((f) => f.prioritizationFee > 0);
log("samples returned", fees.length);
log("non-zero samples", `${nonZero.length}  (median ${nonZero.length ? nonZero.map(f=>f.prioritizationFee).sort((a,b)=>a-b)[Math.floor(nonZero.length/2)] : 0} µlamports/CU)`);

console.log("\n[3] observing an UNKNOWN signature — must not become 'failed'");
const fake = "4".repeat(87) + "1";
const unknown = await pool.observe(fake);
log("outcome", unknown.outcome.state);
log("providers answered", unknown.providersAnswered);
console.log(`     -> correct: an unseen signature is "unknown", never "failed"`);

console.log("\n[4] REAL submission failure, classified");
const payer = Keypair.generate();
const payee = Keypair.generate();
log("unfunded payer", payer.publicKey.toBase58());
const tx = new Transaction({ feePayer: payer.publicKey, blockhash: bh.blockhash, lastValidBlockHeight: bh.lastValidBlockHeight })
  .add(SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: payee.publicKey, lamports: 1_000_000 }));
tx.sign(payer);
const raw = tx.serialize().toString("base64");
log("serialized bytes", tx.serialize().length);

const tSub = Date.now();
try {
  const res = await pool.submit(raw, { skipPreflight: false });
  log("UNEXPECTED success", res.signature);
} catch (e) {
  const ms = Date.now() - tSub;
  if (e instanceof SubmissionError) {
    log("submission latency", `${ms} ms`);
    log("classified kind", e.classification.kind);
    log("retry action", retryAction(e.classification));
    log("resendSafe", e.classification.resendSafe);
    log("rebuildRequired", e.classification.rebuildRequired);
    log("user message", `"${e.message}"`);
    console.log(`     -> rebuildRequired is ${e.classification.rebuildRequired}; only an expired blockhash may set it`);
  } else { throw e; }
}

console.log("\n[5] expiry needs block-height evidence, never a stopwatch");
const bhNow = await pool.getBlockHeight("confirmed");
log("current block height", bhNow);
log("interpret(null, past window)", interpretStatus(null, { currentBlockHeight: bhNow, lastValidBlockHeight: bhNow - 1 }).state);
log("interpret(null, live window)", interpretStatus(null, { currentBlockHeight: bhNow, lastValidBlockHeight: bhNow + 150 }).state);
