use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::state::Escrow;
use crate::errors::EscrowError;

#[derive(Accounts)]
pub struct ResolveDispute<'info> {
    #[account(mut)]
    pub authority: Signer<'info>, // Only authority can resolve

    #[account(
        mut,
        seeds = [b"escrow", escrow.payment_id.as_bytes()],
        bump = escrow.bump,
        has_one = authority,
        constraint = escrow.disputed @ EscrowError::Unauthorized, // Generic error for not disputed
        constraint = !escrow.released @ EscrowError::EscrowAlreadyReleased,
    )]
    pub escrow: Account<'info, Escrow>,

    #[account(mut)]
    pub token_vault: Account<'info, TokenAccount>,

    #[account(mut)]
    pub buyer_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub merchant_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(
    ctx: Context<ResolveDispute>,
    buyer_amount: u64,
    merchant_amount: u64,
) -> Result<()> {
    let escrow = &mut ctx.accounts.escrow;
    
    if buyer_amount + merchant_amount > escrow.amount {
        return err!(EscrowError::InvalidAmount);
    }

    escrow.released = true;

    let seeds = &[
        b"escrow",
        escrow.payment_id.as_bytes(),
        &[escrow.bump],
    ];
    let signer = &[&seeds[..]];

    if buyer_amount > 0 {
        let cpi_accounts = Transfer {
            from: ctx.accounts.token_vault.to_account_info(),
            to: ctx.accounts.buyer_token_account.to_account_info(),
            authority: escrow.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
        token::transfer(cpi_ctx, buyer_amount)?;
    }

    if merchant_amount > 0 {
        let cpi_accounts = Transfer {
            from: ctx.accounts.token_vault.to_account_info(),
            to: ctx.accounts.merchant_token_account.to_account_info(),
            authority: escrow.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
        token::transfer(cpi_ctx, merchant_amount)?;
    }

    Ok(())
}
