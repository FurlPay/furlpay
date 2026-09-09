use jsonrpc_core::Result;
use jsonrpc_core::Error;
use furlpay_common::types::PaymentStatus;
use solana_sdk::pubkey::Pubkey;

pub struct FurlPayRpc;

impl FurlPayRpc {
    pub fn furlpay_getPaymentStatus(&self, signature: String) -> Result<PaymentStatus> {
        Ok(PaymentStatus::Pending)
    }

    pub fn furlpay_getPaymentsByMerchant(&self, merchant: Pubkey) -> Result<Vec<String>> {
        Ok(vec![])
    }

    pub fn furlpay_getPaymentsByReference(&self, reference: Pubkey) -> Result<Vec<String>> {
        Ok(vec![])
    }

    pub fn furlpay_getSettlementProof(&self, signature: String) -> Result<Vec<u8>> {
        Ok(vec![])
    }

    pub fn furlpay_getPaymentMetrics(&self) -> Result<String> {
        Ok("{}".to_string())
    }

    pub fn furlpay_getNetworkHealth(&self) -> Result<String> {
        Ok("OK".to_string())
    }

    pub fn furlpay_simulatePayment(&self, tx: String) -> Result<bool> {
        Ok(true)
    }
}
