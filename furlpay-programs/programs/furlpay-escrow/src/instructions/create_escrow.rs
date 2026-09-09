use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};
use crate::state::Escrow;

#[derive(Accounts)]
#[instruction(amount: u64, auto_release_timestamp: i64, payment_id: String)]
pub struct CreateEscrow<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    
    /// CHECK: Merchant address, doesn't need to sign here
    pub merchant: AccountInfo<'info>,

    #[account(
        init,
        payer = buyer,
        space = 8 + Escrow::INIT_SPACE,
        seeds = [b"escrow", payment_id.as_bytes()],
        bump
    )]
    pub escrow_account: Account<'info, Escrow>,

    #[account(
        init,
        payer = buyer,
        token::mint = mint,
        token::authority = escrow_account,
    )]
    pub token_vault: Account<'info, TokenAccount>,

    #[account(mut)]
    pub buyer_token_account: Account<'info, TokenAccount>,

    pub mint: Account<'info, Mint>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

pub fn handler(
    ctx: Context<CreateEscrow>,
    amount: u64,
    auto_release_timestamp: i64,
    payment_id: String,
) -> Result<()> {
    let escrow = &mut ctx.accounts.escrow_account;
    
    escrow.buyer = ctx.accounts.buyer.key();
    escrow.merchant = ctx.accounts.merchant.key();
    escrow.mint = ctx.accounts.mint.key();
    escrow.amount = amount;
    escrow.payment_id = payment_id;
    escrow.created_at = Clock::get()?.unix_timestamp;
    escrow.auto_release_at = auto_release_timestamp;
    escrow.disputed = false;
    escrow.released = false;
    escrow.authority = ctx.accounts.buyer.key(); // simplified authority
    escrow.bump = ctx.bumps.escrow_account;

    let cpi_accounts = Transfer {
        from: ctx.accounts.buyer_token_account.to_account_info(),
        to: ctx.accounts.token_vault.to_account_info(),
        authority: ctx.accounts.buyer.to_account_info(),
    };
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
    
    token::transfer(cpi_ctx, amount)?;

    Ok(())
}
