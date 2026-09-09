use anchor_lang::prelude::*;
use crate::state::Escrow;
use crate::errors::EscrowError;

#[derive(Accounts)]
pub struct DisputeEscrow<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,

    #[account(
        mut,
        seeds = [b"escrow", escrow.payment_id.as_bytes()],
        bump = escrow.bump,
        has_one = buyer,
        constraint = !escrow.released @ EscrowError::EscrowAlreadyReleased,
        constraint = !escrow.disputed @ EscrowError::EscrowAlreadyReleased
    )]
    pub escrow: Account<'info, Escrow>,
}

pub fn handler(ctx: Context<DisputeEscrow>) -> Result<()> {
    let escrow = &mut ctx.accounts.escrow;
    let current_time = Clock::get()?.unix_timestamp;
    
    // Dispute window is 14 days (14 * 24 * 60 * 60)
    let fourteen_days = 1209600;
    if current_time > escrow.created_at + fourteen_days {
        return err!(EscrowError::DisputeWindowClosed);
    }

    escrow.disputed = true;
    Ok(())
}
