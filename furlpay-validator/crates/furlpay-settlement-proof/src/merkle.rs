//! Merkle aggregation for settlement proofs.
//!
//! # Status: NOT IMPLEMENTED, AND DELIBERATELY FAILS CLOSED
//!
//! These functions previously returned plausible-looking values:
//!
//! ```ignore
//! pub fn verify_proof(root: &[u8], proof: &[Vec<u8>], hash: &[u8]) -> bool {
//!     true                       // <- accepted every proof, including forged ones
//! }
//! pub fn build_merkle_tree(hashes: &[Vec<u8>]) -> Vec<u8> {
//!     vec![]                     // <- an empty root that nothing could verify against
//! }
//! ```
//!
//! A verifier that returns `true` unconditionally is worse than one that does
//! not exist. A missing function is a compile error somebody fixes; a function
//! that always says "valid" is a silent authorisation bypass that looks correct
//! in every code review and every passing test. Had this been wired into a
//! settlement path, every forged proof would have validated.
//!
//! So the stubs now panic. That is the correct behaviour for an unimplemented
//! security primitive: the caller finds out immediately, in development, rather
//! than in production with money attached.
//!
//! # Why it is not implemented instead
//!
//! FurlPay's product direction is the agent-payment layer — a self-hostable
//! HTTP 402 paywall with per-agent spend policy. A validator-side merkle
//! aggregator serves none of that. Implementing one here would be building
//! infrastructure the product does not use, which is how this repository
//! accumulated thirty packages and no users.
//!
//! If settlement-proof aggregation is ever needed, `proof.rs` already contains
//! a real, working single-transaction proof (SHA-256 over the signature), and
//! that is the thing to extend.

/// Build a merkle root over `hashes`.
///
/// # Panics
///
/// Always. See the module documentation — an unimplemented aggregator must not
/// return an empty root that a verifier might then accept.
pub fn build_merkle_tree(_hashes: &[Vec<u8>]) -> Vec<u8> {
    unimplemented!(
        "merkle aggregation is not implemented; use SettlementProofGenerator in proof.rs \
         for single-transaction proofs"
    )
}

/// Produce an inclusion proof for the leaf at `index`.
///
/// # Panics
///
/// Always. See the module documentation.
pub fn get_proof(_index: usize, _hashes: &[Vec<u8>]) -> Vec<Vec<u8>> {
    unimplemented!(
        "merkle inclusion proofs are not implemented; use SettlementProofGenerator in proof.rs"
    )
}

/// Verify that `hash` is included under `root` via `proof`.
///
/// # Panics
///
/// Always — and that is the point. This previously returned `true` for every
/// input. Failing loudly is the only safe behaviour for an unimplemented
/// cryptographic verifier.
pub fn verify_proof(_root: &[u8], _proof: &[Vec<u8>], _hash: &[u8]) -> bool {
    unimplemented!(
        "merkle proof verification is not implemented; it must never return a verdict it \
         cannot compute"
    )
}
