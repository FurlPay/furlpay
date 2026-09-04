//! Regression tests for the settlement proof primitives.
//!
//! The `merkle` tests exist because `verify_proof` once returned `true` for
//! every input — a cryptographic verifier that accepted forged proofs. It now
//! panics. These tests pin that: the failure mode this crate must never return
//! to is "returns a verdict it did not compute".

#[cfg(test)]
mod merkle {
    use crate::merkle;

    #[test]
    #[should_panic(expected = "not implemented")]
    fn verify_proof_refuses_rather_than_accepting() {
        // The regression. Before, this returned `true` — meaning a forged proof
        // against an unrelated root validated. It must now be impossible to get
        // an affirmative answer out of it.
        let _ = merkle::verify_proof(b"any-root", &[b"forged".to_vec()], b"unrelated-leaf");
    }

    #[test]
    #[should_panic(expected = "not implemented")]
    fn verify_proof_refuses_empty_input_too() {
        // The empty case is the one most likely to be hit by a caller wiring
        // this up against `build_merkle_tree`'s old `vec![]` return, so it gets
        // its own test rather than being assumed.
        let _ = merkle::verify_proof(&[], &[], &[]);
    }

    #[test]
    #[should_panic(expected = "not implemented")]
    fn build_merkle_tree_refuses_rather_than_returning_an_empty_root() {
        let _ = merkle::build_merkle_tree(&[b"leaf".to_vec()]);
    }

    #[test]
    #[should_panic(expected = "not implemented")]
    fn get_proof_refuses_rather_than_returning_an_empty_proof() {
        let _ = merkle::get_proof(0, &[b"leaf".to_vec()]);
    }
}

#[cfg(test)]
mod proof {
    use crate::proof::SettlementProofGenerator;
    use furlpay_common::types::{PaymentStatus, PaymentTransaction};
    use solana_sdk::pubkey::Pubkey;

    fn tx(signature: &str) -> PaymentTransaction {
        PaymentTransaction {
            signature: signature.into(),
            merchant: Pubkey::new_unique(),
            customer: Pubkey::new_unique(),
            mint: Pubkey::new_unique(),
            amount: 1_000_000,
            reference: Pubkey::new_unique(),
            status: PaymentStatus::Pending,
        }
    }

    #[test]
    fn a_generated_proof_verifies_against_its_own_transaction() {
        let t = tx("5xk2...real");
        let p = SettlementProofGenerator::generate_proof(&t);
        assert!(SettlementProofGenerator::verify_proof(&p, &t));
    }

    #[test]
    fn a_proof_does_not_verify_against_a_different_transaction() {
        // The property that makes the proof worth anything. This one IS
        // implemented — SHA-256 over the signature — so unlike the merkle
        // module it can be tested for correctness rather than for refusal.
        let a = tx("signature-a");
        let b = tx("signature-b");
        let proof_a = SettlementProofGenerator::generate_proof(&a);
        assert!(!SettlementProofGenerator::verify_proof(&proof_a, &b));
    }

    #[test]
    fn a_forged_proof_is_rejected() {
        let t = tx("5xk2...real");
        assert!(!SettlementProofGenerator::verify_proof(b"forged", &t));
        assert!(!SettlementProofGenerator::verify_proof(&[], &t));
    }

    #[test]
    fn proofs_are_deterministic() {
        // Two calls must agree, or verification is a coin flip.
        let t = tx("5xk2...real");
        assert_eq!(
            SettlementProofGenerator::generate_proof(&t),
            SettlementProofGenerator::generate_proof(&t)
        );
    }

    #[test]
    fn a_proof_is_a_full_sha256_digest() {
        // A truncated digest would weaken collision resistance without any
        // visible symptom.
        let t = tx("5xk2...real");
        assert_eq!(SettlementProofGenerator::generate_proof(&t).len(), 32);
    }
}
