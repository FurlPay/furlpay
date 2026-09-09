use anchor_lang::prelude::*;

pub mod errors;
pub mod instructions;
pub mod state;

use instructions::*;

declare_id!("FurlPay1111111111111111111111111111111111111");

#[program]
pub mod furlpay_escrow {
    use super::*;

    pub fn create_escrow(
        ctx: Context<CreateEscrow>,
        amount: u64,
        auto_release_timestamp: i64,
        payment_id: String,
    ) -> Result<()> {
        instructions::create_escrow::handler(ctx, amount, auto_release_timestamp, payment_id)
    }

    pub fn release_escrow(ctx: Context<ReleaseEscrow>) -> Result<()> {
        instructions::release_escrow::handler(ctx)
    }

    pub fn dispute_escrow(ctx: Context<DisputeEscrow>) -> Result<()> {
        instructions::dispute_escrow::handler(ctx)
    }

    pub fn resolve_dispute(
        ctx: Context<ResolveDispute>,
        buyer_amount: u64,
        merchant_amount: u64,
    ) -> Result<()> {
        instructions::resolve_dispute::handler(ctx, buyer_amount, merchant_amount)
    }

    pub fn auto_release(ctx: Context<AutoRelease>) -> Result<()> {
        instructions::auto_release::handler(ctx)
    }
}
