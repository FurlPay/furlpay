use furlpay_common::types::PaymentTransaction;

pub struct PaymentPrioritizer;

impl PaymentPrioritizer {
    pub fn score_transaction(tx: &PaymentTransaction) -> u64 {
        tx.amount
    }

    pub fn reorder_transactions(txs: &mut [PaymentTransaction]) {
        txs.sort_by(|a, b| Self::score_transaction(b).cmp(&Self::score_transaction(a)));
    }
}
