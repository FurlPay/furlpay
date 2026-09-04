use furlpay_common::types::PaymentTransaction;
use sha2::{Sha256, Digest};

pub struct SettlementProofGenerator;

impl SettlementProofGenerator {
    pub fn generate_proof(tx: &PaymentTransaction) -> Vec<u8> {
        let mut hasher = Sha256::new();
        hasher.update(tx.signature.as_bytes());
        hasher.finalize().to_vec()
    }

    pub fn verify_proof(proof: &[u8], tx: &PaymentTransaction) -> bool {
        let expected = Self::generate_proof(tx);
        proof == expected
    }
}
