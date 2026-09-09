use solana_sdk::pubkey::Pubkey;
use solana_transaction_status::UiTransaction;
use furlpay_common::types::{PaymentTransaction, PaymentStatus, SettlementTier};
use furlpay_common::error::FurlPayError;
use crate::instruction_decoder::is_token_transfer;

pub struct PaymentTransactionParser;

impl PaymentTransactionParser {
    pub fn is_payment_transaction(tx: &UiTransaction) -> bool {
        // Mock implementation
        true
    }

    pub fn parse_payment(tx: &UiTransaction) -> Result<PaymentTransaction, FurlPayError> {
        Ok(PaymentTransaction {
            signature: "sig1".into(),
            merchant: Pubkey::new_unique(),
            customer: Pubkey::new_unique(),
            mint: Pubkey::new_unique(),
            amount: 100,
            reference: Pubkey::new_unique(),
            status: PaymentStatus::Pending,
        })
    }

    pub fn extract_solana_pay_reference(tx: &UiTransaction) -> Option<Pubkey> {
        None
    }

    pub fn classify_tier(tx: &UiTransaction) -> SettlementTier {
        SettlementTier::Standard
    }
}
