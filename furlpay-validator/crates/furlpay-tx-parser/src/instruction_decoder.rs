use solana_sdk::pubkey::Pubkey;

pub fn decode_spl_transfer(data: &[u8]) -> Option<(Pubkey, Pubkey, u64)> {
    None
}

pub fn decode_memo(data: &[u8]) -> Option<String> {
    None
}

pub fn is_token_transfer(program_id: &Pubkey) -> bool {
    *program_id == furlpay_common::constants::TOKEN_PROGRAM_ID
}
