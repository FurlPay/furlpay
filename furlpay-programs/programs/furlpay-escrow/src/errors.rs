use anchor_lang::prelude::*;

#[error_code]
pub enum EscrowError {
    #[msg("The escrow has already been released.")]
    EscrowAlreadyReleased,
    #[msg("The dispute window has closed.")]
    DisputeWindowClosed,
    #[msg("You are not authorized to perform this action.")]
    Unauthorized,
    #[msg("Insufficient funds.")]
    InsufficientFunds,
    #[msg("Invalid amount specified.")]
    InvalidAmount,
}
