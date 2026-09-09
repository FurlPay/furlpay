use solana_sdk::pubkey::Pubkey;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PaymentTransaction {
    pub signature: String,
    pub merchant: Pubkey,
    pub customer: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
    pub reference: Pubkey,
    pub status: PaymentStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum PaymentStatus {
    Pending,
    Confirmed,
    Failed,
    Settled,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum SettlementTier {
    Standard,
    Express,
    Instant,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FurlPayConfig {
    pub max_amount: u64,
}
