use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::state::Escrow;
use crate::errors::EscrowError;

#[derive(Accounts)]
pub struct AutoRelease<'info> {
    #[account(
        mut,
        seeds = [b"escrow", escrow.payment_id.as_bytes()],
        bump = escrow.bump,
        constraint = !escrow.released @ EscrowError::EscrowAlreadyReleased,
        constraint = !escrow.disputed @ EscrowError::Unauthorized
    )]
    pub escrow: Account<'info, Escrow>,

    #[account(mut)]
    pub token_vault: Account<'info, TokenAccount>,

    #[account(mut)]
    pub merchant_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<AutoRelease>) -> Result<()> {
    let escrow = &mut ctx.accounts.escrow;
    let current_time = Clock::get()?.unix_timestamp;

    if current_time <= escrow.auto_release_at {
        return err!(EscrowError::Unauthorized); // Should be a custom error for time not reached
    }

    escrow.released = true;

    let seeds = &[
        b"escrow",
        escrow.payment_id.as_bytes(),
        &[escrow.bump],
    ];
    let signer = &[&seeds[..]];

    let cpi_accounts = Transfer {
        from: ctx.accounts.token_vault.to_account_info(),
        to: ctx.accounts.merchant_token_account.to_account_info(),
        authority: escrow.to_account_info(),
    };
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);

    token::transfer(cpi_ctx, escrow.amount)?;

    Ok(())
}
