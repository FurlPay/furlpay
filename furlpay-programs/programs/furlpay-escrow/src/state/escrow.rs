use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Escrow {
    pub buyer: Pubkey,
    pub merchant: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
    #[max_len(64)]
    pub payment_id: String,
    pub created_at: i64,
    pub auto_release_at: i64,
    pub disputed: bool,
    pub released: bool,
    pub authority: Pubkey,
    pub bump: u8,
}
