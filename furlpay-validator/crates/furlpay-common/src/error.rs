use thiserror::Error;

#[derive(Error, Debug)]
pub enum FurlPayError {
    #[error("Invalid transaction")]
    InvalidTransaction,
    #[error("Parse error")]
    ParseError,
    #[error("Database error")]
    DatabaseError,
}
