// CCTP burn/mint correlation — the join that stops a cross-chain transfer being
// counted twice.
//
// A CCTP transfer is two on-chain events: USDC burned on the source chain and an
// equal amount minted on the destination. Counted naively a $10M transfer reads as
// $20M of movement, and on a heavy bridging day that inflates the headline figure by
// a large and unstable fraction — plausibly, which is what makes it dangerous.
//
// CCTP V2 makes the join hard in a way V1 did not: V1 emitted a uint64 nonce on the
// source chain, V2 does not (Circle's attestation service assigns it, and the source
// `MessageSent` payload carries thirty-two zero bytes where the nonce goes). So a
// burn arrives with NO correlation key and acquires one later. These tests pin both
// paths and, more importantly, pin that a burn which cannot be joined stays unjoined
// rather than being paired with a guess.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

import { MIGRATIONS } from "../db/schema.js";
import { cctpMatchKey } from "./iris.js";
import { CCTP_DOMAINS, cctpContractsFor, cctpDomainName, getChainByCctpDomain } from "./registry.js";

const HEURISTIC_WINDOW = 2 * 60 * 60 * 1000;
const T0 = 1_790_651_000_000;

let db: DatabaseSync;

beforeEach(() => {
  db = new DatabaseSync(":memory:");
  for (const m of MIGRATIONS) db.exec(m.sql);
});

/* ------------------------------------------------------------------ */
/* Helpers mirroring cctpDb                                            */
/* ------------------------------------------------------------------ */

function insertBurn(o: {
  sourceChain: string;
  sourceDomain: number;
  destDomain: number;
  nonce: string;
  amount: number;
  recipient: string;
  burnTs?: number;
  matchKey?: string | null;
}): number {
  db.prepare(
    `INSERT INTO usdc_cctp_transfers (
       source_chain, source_tx, source_domain, dest_chain, dest_tx, dest_domain,
       nonce, sender, recipient, amount, burn_ts, mint_ts, status,
       correlation, cctp_version, fee_usdc, finality_executed, match_key, alerted
     ) VALUES (?,?,?,?,NULL,?,?,'0xdep',?,?,?,NULL,'burned','none',2,NULL,NULL,?,0)
     ON CONFLICT(source_domain, nonce) DO NOTHING`
  ).run(
    o.sourceChain,
    `0xburn_${o.nonce}`,
    o.sourceDomain,
    getChainByCctpDomain(o.destDomain),
    o.destDomain,
    o.nonce,
    o.recipient,
    o.amount,
    o.burnTs ?? T0,
    o.matchKey ?? null
  );
  return Number((db.prepare("SELECT last_insert_rowid() AS id").get() as { id: number }).id);
}

/** Mirrors cctpDb.completeMint: authoritative nonce first, heuristic second. */
function completeMint(m: {
  nonce: string;
  sourceDomain: number;
  destChain: string;
  destTx: string;
  mintTs: number;
  matchKey: string;
  feeUsdc?: number | null;
}): { completed: boolean; correlation: string | null } {
  const byNonce = db
    .prepare(
      `UPDATE usdc_cctp_transfers
          SET dest_tx = ?, dest_chain = ?, mint_ts = ?, status = 'completed',
              correlation = 'iris_nonce', fee_usdc = COALESCE(?, fee_usdc)
        WHERE source_domain = ? AND nonce = ? AND status != 'completed'`
    )
    .run(m.destTx, m.destChain, m.mintTs, m.feeUsdc ?? null, m.sourceDomain, m.nonce.toLowerCase());
  if (Number(byNonce.changes) > 0) return { completed: true, correlation: "iris_nonce" };

  const candidate = db
    .prepare(
      `SELECT id FROM usdc_cctp_transfers
        WHERE match_key = ? AND source_domain = ? AND status = 'burned'
          AND burn_ts >= ? AND burn_ts <= ?
        ORDER BY burn_ts ASC LIMIT 1`
    )
    .get(m.matchKey, m.sourceDomain, m.mintTs - HEURISTIC_WINDOW, m.mintTs + 60_000) as
    | { id: number }
    | undefined;
  if (!candidate) return { completed: false, correlation: null };

  db.prepare(
    `UPDATE usdc_cctp_transfers
        SET dest_tx = ?, dest_chain = ?, mint_ts = ?, status = 'completed',
            correlation = 'heuristic', fee_usdc = COALESCE(?, fee_usdc)
      WHERE id = ? AND status = 'burned'`
  ).run(m.destTx, m.destChain, m.mintTs, m.feeUsdc ?? null, candidate.id);
  return { completed: true, correlation: "heuristic" };
}

function row(id: number) {
  return db.prepare("SELECT * FROM usdc_cctp_transfers WHERE id = ?").get(id) as Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/* The happy path                                                      */
/* ------------------------------------------------------------------ */

test("a burn and its mint become ONE completed transfer", () => {
  const NONCE = "0x" + "ab".repeat(32);
  const id = insertBurn({
    sourceChain: "ethereum",
    sourceDomain: 0,
    destDomain: 6,
    nonce: NONCE,
    amount: 10_000_000,
    recipient: "0xrecip",
  });

  assert.equal(row(id).status, "burned", "a burn starts in flight");

  const r = completeMint({
    nonce: NONCE,
    sourceDomain: 0,
    destChain: "base",
    destTx: "0xmint",
    mintTs: T0 + 30_000,
    matchKey: "irrelevant",
  });

  assert.equal(r.completed, true);
  assert.equal(r.correlation, "iris_nonce", "a nonce match is proof, not inference");

  const after = row(id);
  assert.equal(after.status, "completed");
  assert.equal(after.dest_chain, "base");
  assert.equal(after.dest_tx, "0xmint");

  // The point of the whole exercise: ONE row, $10M, not two rows totalling $20M.
  const agg = db
    .prepare(
      `SELECT COUNT(*) AS n, SUM(amount) AS usd FROM usdc_cctp_transfers WHERE status='completed'`
    )
    .get() as { n: number; usd: number };
  assert.equal(agg.n, 1);
  assert.equal(agg.usd, 10_000_000);
});

test("the collected fee is recorded from the destination side", () => {
  // The burn only knows the maximum fee it authorised; the mint knows what was
  // actually charged. Recording maxFee as the fee would overstate CCTP's cut.
  const NONCE = "0x" + "cd".repeat(32);
  const id = insertBurn({
    sourceChain: "base",
    sourceDomain: 6,
    destDomain: 0,
    nonce: NONCE,
    amount: 14.579226,
    recipient: "0xr",
  });
  completeMint({
    nonce: NONCE,
    sourceDomain: 6,
    destChain: "ethereum",
    destTx: "0xm",
    mintTs: T0 + 5_000,
    matchKey: "x",
    feeUsdc: 0.001457,
  });
  assert.equal(row(id).fee_usdc, 0.001457);
});

/* ------------------------------------------------------------------ */
/* In-flight and unmatched                                             */
/* ------------------------------------------------------------------ */

test("an in-flight burn is NOT counted in completed volume", () => {
  // Counting a burn whose mint has not landed would make the total depend on exactly
  // when the reporting window closed.
  insertBurn({
    sourceChain: "ethereum",
    sourceDomain: 0,
    destDomain: 6,
    nonce: "0x" + "11".repeat(32),
    amount: 5_000_000,
    recipient: "0xr",
  });

  const agg = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN status='completed' THEN amount ELSE 0 END),0) AS done,
         COALESCE(SUM(CASE WHEN status='burned' THEN amount ELSE 0 END),0) AS inflight
       FROM usdc_cctp_transfers`
    )
    .get() as { done: number; inflight: number };

  assert.equal(agg.done, 0, "nothing completed");
  assert.equal(agg.inflight, 5_000_000, "but it is reported separately, not hidden");
});

test("a mint with no matching burn does not create a half-transfer", () => {
  // A row with no source chain, no sender and no burn time pollutes every aggregate
  // it touches. Better to miss the arrival than to invent its origin.
  const r = completeMint({
    nonce: "0x" + "99".repeat(32),
    sourceDomain: 0,
    destChain: "base",
    destTx: "0xorphan",
    mintTs: T0,
    matchKey: "nothing-matches-this",
  });
  assert.equal(r.completed, false);

  const n = db.prepare("SELECT COUNT(*) AS n FROM usdc_cctp_transfers").get() as { n: number };
  assert.equal(n.n, 0, "no row may be created from a mint alone");
});

test("a burn that cannot be joined stays in flight rather than being guessed", () => {
  const id = insertBurn({
    sourceChain: "ethereum",
    sourceDomain: 0,
    destDomain: 6,
    nonce: "pending:0xabc:3",
    amount: 1_000_000,
    recipient: "0xr",
    matchKey: cctpMatchKey(0, 6, 1_000_000, "0xr"),
  });

  // A mint for a DIFFERENT amount must not be paired with it.
  const r = completeMint({
    nonce: "0x" + "22".repeat(32),
    sourceDomain: 0,
    destChain: "base",
    destTx: "0xwrong",
    mintTs: T0 + 1_000,
    matchKey: cctpMatchKey(0, 6, 7_777_777, "0xr"),
  });
  assert.equal(r.completed, false);
  assert.equal(row(id).status, "burned", "an unjoined burn under-reports; a wrong join lies");
});

/* ------------------------------------------------------------------ */
/* The heuristic fallback                                              */
/* ------------------------------------------------------------------ */

test("the heuristic key joins a burn when Circle's nonce is unavailable", () => {
  // CCTP V2 emits no nonce on the source chain, so a burn observed while Iris is
  // unreachable has only a deterministic key both sides can compute independently.
  const key = cctpMatchKey(0, 6, 2_500_000, "0xdeadbeef");
  const id = insertBurn({
    sourceChain: "ethereum",
    sourceDomain: 0,
    destDomain: 6,
    nonce: "pending:0xsrc:0",
    amount: 2_500_000,
    recipient: "0xdeadbeef",
    matchKey: key,
  });

  const r = completeMint({
    nonce: "0x" + "33".repeat(32),
    sourceDomain: 0,
    destChain: "base",
    destTx: "0xm",
    mintTs: T0 + 120_000,
    matchKey: key,
  });

  assert.equal(r.completed, true);
  assert.equal(
    row(id).correlation,
    "heuristic",
    "and it must record that the pairing was inferred, not proven"
  );
});

test("a heuristic match outside the window is refused", () => {
  const key = cctpMatchKey(0, 6, 1_000_000, "0xr");
  const id = insertBurn({
    sourceChain: "ethereum",
    sourceDomain: 0,
    destDomain: 6,
    nonce: "pending:0xold:0",
    amount: 1_000_000,
    recipient: "0xr",
    matchKey: key,
    burnTs: T0,
  });

  // Six hours later. Two transfers of the same size to the same recipient that far
  // apart are two movements, and merging them would under-report.
  const r = completeMint({
    nonce: "0x" + "44".repeat(32),
    sourceDomain: 0,
    destChain: "base",
    destTx: "0xm",
    mintTs: T0 + 6 * 60 * 60 * 1000,
    matchKey: key,
  });
  assert.equal(r.completed, false);
  assert.equal(row(id).status, "burned");
});

test("repeated identical transfers are consumed oldest-first", () => {
  // Two identical burns share a match key. The older must be completed first, or the
  // newest would swallow the older one's mint and leave a burn stranded forever.
  const key = cctpMatchKey(0, 6, 500_000, "0xr");
  const older = insertBurn({
    sourceChain: "ethereum", sourceDomain: 0, destDomain: 6,
    nonce: "pending:0xA:0", amount: 500_000, recipient: "0xr", matchKey: key, burnTs: T0,
  });
  const newer = insertBurn({
    sourceChain: "ethereum", sourceDomain: 0, destDomain: 6,
    nonce: "pending:0xB:0", amount: 500_000, recipient: "0xr", matchKey: key, burnTs: T0 + 60_000,
  });

  completeMint({
    nonce: "0x" + "55".repeat(32), sourceDomain: 0, destChain: "base",
    destTx: "0xm1", mintTs: T0 + 90_000, matchKey: key,
  });

  assert.equal(row(older).status, "completed", "the older burn is matched first");
  assert.equal(row(newer).status, "burned", "the newer one waits for its own mint");
});

/* ------------------------------------------------------------------ */
/* Idempotence                                                         */
/* ------------------------------------------------------------------ */

test("re-ingesting the same burn does not duplicate it", () => {
  const NONCE = "0x" + "66".repeat(32);
  const a = insertBurn({
    sourceChain: "ethereum", sourceDomain: 0, destDomain: 6,
    nonce: NONCE, amount: 1_000_000, recipient: "0xr",
  });
  insertBurn({
    sourceChain: "ethereum", sourceDomain: 0, destDomain: 6,
    nonce: NONCE, amount: 1_000_000, recipient: "0xr",
  });

  const n = db.prepare("SELECT COUNT(*) AS n FROM usdc_cctp_transfers").get() as { n: number };
  assert.equal(n.n, 1, "UNIQUE(source_domain, nonce) makes a rescan a no-op");
  assert.ok(a > 0);
});

test("the same nonce on two source domains is two transfers", () => {
  // Nonces are per-domain. Keying on nonce alone would drop a real transfer.
  const NONCE = "0x" + "77".repeat(32);
  insertBurn({ sourceChain: "ethereum", sourceDomain: 0, destDomain: 6, nonce: NONCE, amount: 1, recipient: "0xr" });
  insertBurn({ sourceChain: "base", sourceDomain: 6, destDomain: 0, nonce: NONCE, amount: 2, recipient: "0xr" });

  const n = db.prepare("SELECT COUNT(*) AS n FROM usdc_cctp_transfers").get() as { n: number };
  assert.equal(n.n, 2);
});

test("completing an already-completed transfer is a no-op", () => {
  // A duplicate tick must not re-stamp a different destination tx onto a finished
  // transfer.
  const NONCE = "0x" + "88".repeat(32);
  const id = insertBurn({
    sourceChain: "ethereum", sourceDomain: 0, destDomain: 6,
    nonce: NONCE, amount: 1_000_000, recipient: "0xr",
  });
  completeMint({ nonce: NONCE, sourceDomain: 0, destChain: "base", destTx: "0xfirst", mintTs: T0 + 1, matchKey: "x" });
  const second = completeMint({ nonce: NONCE, sourceDomain: 0, destChain: "base", destTx: "0xsecond", mintTs: T0 + 2, matchKey: "x" });

  assert.equal(second.completed, false, "already complete");
  assert.equal(row(id).dest_tx, "0xfirst", "the first destination stands");
});

/* ------------------------------------------------------------------ */
/* Domain resolution                                                   */
/* ------------------------------------------------------------------ */

test("an unconfigured CCTP domain resolves to no chain, never to the wrong one", () => {
  // Domain 22 is Plume — real, and not scanned by this tracker. It must resolve to
  // null rather than to some default, because a burn attributed to the wrong
  // destination chain is a plausible-looking lie.
  assert.equal(getChainByCctpDomain(22), null);
  assert.equal(cctpDomainName(22), "Plume", "but it is still NAMED correctly");

  // A domain that does not exist at all reads as unknown, not as a name.
  assert.equal(getChainByCctpDomain(9_999), null);
  assert.equal(cctpDomainName(9_999), "domain:9999");
});

test("a burn to an unconfigured domain stores a null destination chain", () => {
  const id = insertBurn({
    sourceChain: "ethereum",
    sourceDomain: 0,
    destDomain: 22, // Plume — not in our registry
    nonce: "0x" + "aa".repeat(32),
    amount: 1_000_000,
    recipient: "0xr",
  });
  const r = row(id);
  assert.equal(r.dest_chain, null, "unknown must be null, not a guess");
  assert.equal(r.dest_domain, 22, "the domain is still recorded so it can be named");
});

test("domains reserved for chains we do not track are not claimable", () => {
  // Domain 4 is Noble, 8 is Sui, 9 is Aptos. The original bug put Celo at 8 and Linea
  // at 9, which would have attributed real cross-chain transfers to the wrong chain.
  for (const [domain, name] of [[4, "Noble"], [8, "Sui"], [9, "Aptos"]] as const) {
    assert.equal(CCTP_DOMAINS[domain]!.name, name);
    assert.equal(getChainByCctpDomain(domain), null, `domain ${domain} must not map to a tracked chain`);
  }
});

test("a chain with no CCTP deployment has no contracts to scan", () => {
  // Celo and ZKsync Era have native USDC but are on no CCTP domain list. Returning
  // the canonical addresses for them would have the scanner read logs at an address
  // holding nothing and report clean empty scans forever.
  assert.equal(cctpContractsFor("celo"), null);
  assert.equal(cctpContractsFor("zksync"), null);
  assert.ok(cctpContractsFor("base"), "a real CCTP chain still resolves");
});
