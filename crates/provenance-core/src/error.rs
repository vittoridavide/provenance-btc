use thiserror::Error;

#[derive(Debug, Error)]
pub enum CoreError {
    #[error("RPC error: {0}")]
    Rpc(#[from] bitcoincore_rpc::Error),

    #[error("SQLite error: {0}")]
    Sqlite(#[from] rusqlite::Error),

    #[error("Invalid RPC URL: {0}")]
    InvalidUrl(String),

    #[error("Missing RPC auth (set user/pass or cookie path)")]
    MissingAuth,

    #[error("Other error: {0}")]
    Other(String),
}

pub type Result<T> = std::result::Result<T, CoreError>;
