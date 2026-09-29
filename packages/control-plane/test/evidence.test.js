"use strict";
// ---------------------------------------------------------------------------
// Independent evidence: tamper detection, deletion detection, anchoring.
//
// THE THREE QUESTIONS AN INVESTIGATOR ACTUALLY ASKS, each with its own test:
//
//   "was this record CHANGED?"   -> leaf hash recomputation
//   "was a record DELETED?"      -> back-link chain + sequence contiguity
//   "could the operator have rewritten the WHOLE chain?" -> Merkle root anchoring
//
// A hash alone answers only the first. These tests assert all three, because an
// evidence layer that can only detect modification is defeated by removing the
// inconvenient row.
// ---------------------------------------------------------------------------
const test = require("node:test");
const assert = require("node:assert");
const {
  evidenceLeafHash,
  verifyLeaf,
  verifyEvidenceChain,
  evidenceComplete,
  merkleRoot,
  merkleProof,
  verifyMerkleProof,
  authorityScopeHash,
  sha256Hex,
  timingSafeEqualHex,
  canonicalize,
  EVIDENCE_DOMAIN,
} = require("../dist/index.js");

function bundle(overrides = {}) {
  return {
    paymentId: "pay_98721643",
    organizationId: "org_1",
    sequence: 1,
    previousLeafHash: null,
    decidedAt: "2026-09-28T12:00:00Z",
    amountAtomic: "28500000",
    asset: "USDC",
    intent: {
      mandateId: "mand_1",
      mandatePayloadHash: "a".repeat(64),
      credentialFormat: "internal-ed25519",
      credentialKeyId: "key_1",
      expiresAt: "2026-09-29T00:00:00Z",
      authorityScopeHash: "b".repeat(64),
    },
    delegation: {
      principalId: "prin_1",
      delegationId: "del_1",
      operatorId: "op_1",
      agentId: "agent_1",
      sessionId: "sess_1",
      attestation: "tee",
      chain: ["prin_1", "del_1", "op_1", "agent_1", "sess_1"],
    },
    revocation: { live: true, checkedSubjects: 8, snapshotAgeMs: 120, maxStalenessMs: 5000 },
    policy: {
      verdict: "ALLOW",
      checks: [{ id: "revocation", outcome: "pass", detail: "live" }],
      evaluatedPolicies: [{ policyId: "pol_1", version: 3 }],
      driftScore: 0,
      driftSignals: [],
      requiresApproval: false,
    },
    recipient: {
      recipientId: "rcpt_1",
      networkId: "arbitrum_one",
      asset: "USDC",
      canonicalDestination: "0x388c818ca8b9251b393131c08a73683246a16633",
      attestationMethod: "domain_signature",
      attestedAt: "2026-09-01T00:00:00Z",
      firstUse: false,
    },
    approval: { required: false },
    route: {
      railId: "x402_usdc_arbitrum",
      railQuoteId: "q_1",
      score: 820,
      feeAtomic: "50000",
      finality: "irreversible",
      rejected: [],
    },
    signing: {
      executionTokenId: "tok_1",
      payloadHash: "c".repeat(64),
      backend: "turnkey",
      keyId: "furlpay-settlement",
      keyVersion: "v1",
      hardwareBacked: true,
      signedAt: "2026-09-28T12:00:07Z",
    },
    settlement: {
      state: "SETTLED",
      railRef: "ref_1",
      settlementRef: "0x9c42b781a7428f",
      settledAt: "2026-09-28T12:00:08Z",
      feeAtomic: "50000",
    },
    ledger: {
      ledgerTxId: "txn_abc",
      postings: [
        { accountCode: "2100:user_1", side: "debit", amountMinor: 2850 },
        { accountCode: "1100", side: "credit", amountMinor: 2845 },
        { accountCode: "4000", side: "credit", amountMinor: 5 },
      ],
      balanced: true,
    },
    trace: { requestId: "req_1", idempotencyKey: "idem_1" },
    ...overrides,
  };
}

// ── "Was this record changed?" ────────────────────────────────────────────

test("a leaf hash verifies against its own bundle", () => {
  const b = bundle();
  const leaf = evidenceLeafHash(b);
  assert.match(leaf, /^[0-9a-f]{64}$/);
  assert.strictEqual(verifyLeaf(b, leaf), true);
});

test("TAMPER: changing the amount breaks the leaf hash", () => {
  const b = bundle();
  const leaf = evidenceLeafHash(b);
  const tampered = { ...b, amountAtomic: "999000000" };
  assert.strictEqual(verifyLeaf(tampered, leaf), false);
});

test("TAMPER: changing the policy verdict from HOLD to ALLOW breaks the hash", () => {
  // The most valuable forgery: making a held payment look authorized.
  const held = bundle({ policy: { ...bundle().policy, verdict: "HOLD" } });
  const leaf = evidenceLeafHash(held);
  const forged = { ...held, policy: { ...held.policy, verdict: "ALLOW" } };
  assert.strictEqual(verifyLeaf(forged, leaf), false);
});

test("TAMPER: swapping the recipient destination breaks the hash", () => {
  const b = bundle();
  const leaf = evidenceLeafHash(b);
  const forged = { ...b, recipient: { ...b.recipient, canonicalDestination: "0x" + "1".repeat(40) } };
  assert.strictEqual(verifyLeaf(forged, leaf), false);
});

test("TAMPER: rewriting which policy version was applied breaks the hash", () => {
  // A later policy edit must not be able to make a past decision look like it
  // followed rules that did not exist yet.
  const b = bundle();
  const leaf = evidenceLeafHash(b);
  const forged = { ...b, policy: { ...b.policy, evaluatedPolicies: [{ policyId: "pol_1", version: 9 }] } };
  assert.strictEqual(verifyLeaf(forged, leaf), false);
});

test("TAMPER: removing the approval record from an approval-requiring payment breaks the hash", () => {
  const b = bundle({
    approval: { required: true, approverRole: "finance_admin", approvedBy: "cfo@example.com", approvedAt: "2026-09-28T12:00:05Z" },
  });
  const leaf = evidenceLeafHash(b);
  const forged = { ...b, approval: { required: false } };
  assert.strictEqual(verifyLeaf(forged, leaf), false);
});

test("key ORDER does not change the hash — canonicalization is order-independent", () => {
  const a = { x: 1, y: { p: 2, q: 3 } };
  const b = { y: { q: 3, p: 2 }, x: 1 };
  assert.strictEqual(canonicalize(a), canonicalize(b));
  assert.strictEqual(sha256Hex(canonicalize(a)), sha256Hex(canonicalize(b)));
});

test("the leaf hash is domain-separated from a bare canonical-JSON hash", () => {
  const b = bundle();
  const bare = sha256Hex(canonicalize(b));
  assert.notStrictEqual(evidenceLeafHash(b), bare);
  assert.strictEqual(evidenceLeafHash(b), sha256Hex(`${EVIDENCE_DOMAIN}\n${canonicalize(b)}`));
});

test("authorityScopeHash is domain-separated too", () => {
  const scope = { maxAmountPerTxAtomic: "50000000" };
  assert.notStrictEqual(authorityScopeHash(scope), sha256Hex(canonicalize(scope)));
  assert.match(authorityScopeHash(scope), /^[0-9a-f]{64}$/);
});

test("timingSafeEqualHex compares correctly and rejects length mismatch", () => {
  assert.strictEqual(timingSafeEqualHex("abc", "abc"), true);
  assert.strictEqual(timingSafeEqualHex("abc", "abd"), false);
  assert.strictEqual(timingSafeEqualHex("abc", "abcd"), false);
});

// ── "Was a record deleted?" ───────────────────────────────────────────────

function linkChain(n) {
  const links = [];
  let prev = null;
  for (let i = 1; i <= n; i++) {
    const leaf = evidenceLeafHash(bundle({ sequence: i, previousLeafHash: prev, paymentId: `pay_${i}` }));
    links.push({ sequence: i, leafHash: leaf, previousLeafHash: prev });
    prev = leaf;
  }
  return links;
}

test("an intact chain verifies", () => {
  const out = verifyEvidenceChain(linkChain(5));
  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.length, 5);
});

test("an empty range verifies as a chain of length zero", () => {
  assert.deepStrictEqual(verifyEvidenceChain([]), { ok: true, length: 0 });
});

test("DELETION: removing a middle record is detected as a sequence gap", () => {
  // The property a plain hash cannot provide: removing a row leaves no trace in
  // the rows that remain.
  const links = linkChain(5);
  const withHole = [...links.slice(0, 2), ...links.slice(3)];
  const out = verifyEvidenceChain(withHole);
  assert.strictEqual(out.ok, false);
  assert.strictEqual(out.reason, "sequence_gap");
  assert.strictEqual(out.atSequence, 3);
});

test("RE-LINKING: repairing the sequence around a deletion is caught by the back-link", () => {
  // The smarter attack: delete record 3 and renumber, so the sequence is
  // contiguous again. The back-link hashes no longer match.
  const links = linkChain(5);
  const resequenced = [links[0], links[1], { ...links[3], sequence: 3 }, { ...links[4], sequence: 4 }];
  const out = verifyEvidenceChain(resequenced);
  assert.strictEqual(out.ok, false);
  assert.strictEqual(out.reason, "broken_link");
  assert.strictEqual(out.atSequence, 3);
});

test("REPLACEMENT: substituting a record's content is caught by the next record's back-link", () => {
  const links = linkChain(4);
  const replaced = [...links];
  replaced[1] = { ...replaced[1], leafHash: "f".repeat(64) };
  const out = verifyEvidenceChain(replaced);
  assert.strictEqual(out.ok, false);
  assert.strictEqual(out.reason, "broken_link");
});

test("a duplicated sequence number is detected", () => {
  const links = linkChain(3);
  const dup = [links[0], links[1], { ...links[1], leafHash: "e".repeat(64) }];
  const out = verifyEvidenceChain(dup);
  assert.strictEqual(out.ok, false);
  assert.strictEqual(out.reason, "duplicate_sequence");
});

test("a range whose first record points at an absent predecessor is rejected", () => {
  const links = linkChain(3);
  const out = verifyEvidenceChain(links.slice(1));
  assert.strictEqual(out.ok, false);
  assert.strictEqual(out.reason, "bad_genesis");
});

test("chain verification is order-insensitive on input but strict on content", () => {
  const links = linkChain(4);
  const shuffled = [links[3], links[0], links[2], links[1]];
  assert.strictEqual(verifyEvidenceChain(shuffled).ok, true);
});

// ── "Could the whole chain have been rewritten?" ─────────────────────────

test("a Merkle root over a batch is stable and order-dependent", () => {
  const leaves = linkChain(4).map((l) => l.leafHash);
  const root = merkleRoot(leaves);
  assert.match(root, /^[0-9a-f]{64}$/);
  assert.strictEqual(merkleRoot(leaves), root, "stable");
  assert.notStrictEqual(merkleRoot([...leaves].reverse()), root, "order is part of the commitment");
  assert.strictEqual(merkleRoot([]), null);
});

test("an inclusion proof verifies for every leaf, including an odd-sized tree", () => {
  for (const size of [1, 2, 3, 4, 5, 7, 8]) {
    const leaves = linkChain(size).map((l) => l.leafHash);
    const root = merkleRoot(leaves);
    for (let i = 0; i < size; i++) {
      const proof = merkleProof(leaves, i);
      assert.ok(proof, `proof exists for ${i}/${size}`);
      assert.strictEqual(verifyMerkleProof(leaves[i], proof, root), true, `leaf ${i} of ${size} proves`);
    }
  }
});

test("a proof does not verify for a leaf that is not in the tree", () => {
  const leaves = linkChain(4).map((l) => l.leafHash);
  const root = merkleRoot(leaves);
  const proof = merkleProof(leaves, 0);
  assert.strictEqual(verifyMerkleProof("d".repeat(64), proof, root), false);
});

test("a proof for the wrong index does not verify", () => {
  const leaves = linkChain(4).map((l) => l.leafHash);
  const root = merkleRoot(leaves);
  assert.strictEqual(verifyMerkleProof(leaves[0], merkleProof(leaves, 1), root), false);
});

test("out-of-range proof requests return null rather than a bogus proof", () => {
  const leaves = linkChain(2).map((l) => l.leafHash);
  assert.strictEqual(merkleProof(leaves, -1), null);
  assert.strictEqual(merkleProof(leaves, 2), null);
});

test("leaf and internal nodes use different prefixes, so a leaf cannot pose as a node", () => {
  // Without distinct prefixes an attacker can present an internal node as a
  // leaf — the classic second-preimage attack on unprefixed Merkle trees.
  const leaf = "a".repeat(64);
  const single = merkleRoot([leaf]);
  const pair = merkleRoot([leaf, leaf]);
  assert.notStrictEqual(single, pair);
});

// ── Completeness: a SETTLED payment with missing evidence is a control failure ──

test("a complete bundle reports complete", () => {
  const out = evidenceComplete(bundle());
  assert.strictEqual(out.ok, true, `missing: ${out.missing}`);
  assert.deepStrictEqual(out.missing, []);
});

test("every missing section is named, not summarised", () => {
  const stripped = bundle({ route: undefined, signing: undefined, settlement: undefined, ledger: undefined });
  const out = evidenceComplete(stripped);
  assert.strictEqual(out.ok, false);
  for (const field of ["route", "signing", "settlement.settlementRef", "ledger.ledgerTxId"]) {
    assert.ok(out.missing.includes(field), `${field} must be reported missing`);
  }
});

test("an approval-requiring payment with no approver is incomplete", () => {
  const out = evidenceComplete(bundle({ approval: { required: true } }));
  assert.strictEqual(out.ok, false);
  assert.ok(out.missing.includes("approval.approvedBy"));
});

test("an unbalanced ledger section is reported", () => {
  const out = evidenceComplete(bundle({ ledger: { ledgerTxId: "t", postings: [], balanced: false } }));
  assert.ok(out.missing.includes("ledger.balanced"));
});

test("a truncated delegation chain is reported — evidence must re-walk the chain", () => {
  const out = evidenceComplete(bundle({ delegation: { ...bundle().delegation, chain: ["prin_1"] } }));
  assert.ok(out.missing.includes("delegation.chain"));
});

test("a bundle with no evaluated policies is incomplete — 'why was it allowed' is unanswerable", () => {
  const out = evidenceComplete(bundle({ policy: { ...bundle().policy, evaluatedPolicies: [] } }));
  assert.ok(out.missing.includes("policy.evaluatedPolicies"));
});

// ── The bundle answers "why", not merely "whether" ───────────────────────

test("the bundle records the INPUTS to the decision, not only its outcome", () => {
  // A receipt that records the outcome but not the inputs cannot answer "was
  // this decision correct given what was known at the time".
  const b = bundle();
  assert.ok(b.revocation.snapshotAgeMs !== undefined, "how fresh the revocation state was");
  assert.ok(b.revocation.maxStalenessMs !== undefined, "what freshness was demanded");
  assert.ok(b.policy.checks.length > 0, "which checks ran");
  assert.ok(b.policy.evaluatedPolicies.length > 0, "which policy versions applied");
  assert.ok(b.recipient.attestationMethod, "why the destination was trusted");
  assert.ok(b.route.rejected !== undefined, "which rails were considered and excluded");
  assert.ok(b.signing.hardwareBacked !== undefined, "whether the key was hardware-held");
  assert.ok(b.intent.mandatePayloadHash, "a commitment to the exact authority relied on");
});

test("the signing section records no key material, only references", () => {
  const b = bundle();
  const serialized = JSON.stringify(b.signing);
  assert.ok(!/privateKey|secret|seed|mnemonic/i.test(serialized), "no key material in evidence");
  assert.match(b.signing.payloadHash, /^[0-9a-f]{64}$/);
});
