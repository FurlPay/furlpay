// ---------------------------------------------------------------------------
// @furlpay/control-plane — the deterministic core of FurlPay's programmable
// money control plane.
//
// WHAT IS IN THIS PACKAGE AND WHAT IS DELIBERATELY NOT.
//
// IN: the decisions. Chain resolution, revocation, mandate semantics, the policy
// engine, sequence-level drift, recipient verification, route selection, the
// decision lifecycle, evidence hashing. Every one of them is a PURE function of
// values handed to it — no database, no Redis, no clock of its own, no network,
// and (apart from SHA-256 in evidence.ts) no crypto.
//
// NOT IN: persistence, transport, provider calls, key material. Those live in
// apps/web/src/lib/controlPlane/*, which is where the async, the retries and the
// environment belong.
//
// WHY THE SPLIT IS WORTH THE EXTRA FILE. The authorization decision for a money
// movement has to be reproducible: given the same mandate, the same history and
// the same clock reading, it must reach the same answer, forever, and that answer
// has to be explainable after the fact to a customer and to a regulator. A
// decision function that reads its own inputs cannot offer that — its result
// depends on what Redis happened to return. Hoisting every read to the caller is
// what makes the ~200 denial paths below exhaustively testable without
// infrastructure, and it is what lets a payer-side gate run the identical
// functions and be unable to disagree with the server.
//
// RELATIONSHIP TO WHAT ALREADY EXISTED. This package does not replace
// @furlpay/x402-guard (its `evaluateMandate` remains the x402 settlement-time
// authority), @furlpay/agent-trust (identity keys, RFC 9421, approval evidence),
// @furlpay/ap2 (AP2 mandate credentials) or @furlpay/ledger (the book). It is the
// layer that composes them into one lifecycle, and it reuses their primitives
// rather than reimplementing them.
// ---------------------------------------------------------------------------

export * from "./units";
export * from "./identity";
export * from "./revocation";
export * from "./mandate";
export * from "./lifecycle";
export * from "./drift";
export * from "./recipient";
export * from "./rails";
export * from "./capability";
export * from "./policy";
export * from "./evidence";
export * from "./approval";

/**
 * The policy semantics version.
 *
 * Bumped whenever a change would make an existing mandate evaluate DIFFERENTLY.
 * Mandates carry the version they were signed under and `evaluatePolicy` refuses
 * a mismatch, so an old mandate is never silently judged by new rules — a
 * principal agreed to one rule set and must not be held to another.
 */
export const CONTROL_PLANE_POLICY_VERSION = "cp-2026-09-28";
