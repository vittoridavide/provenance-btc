use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CoreStatus {
    // network / node
    pub subversion: String, // e.g. "/Satoshi:27.0.0/"
    pub version: i64,       // int version (e.g. 270000)
    pub chain: String,      // main/test/regtest/signet
    pub blocks: u64,
    pub headers: u64,
    pub verification_progress: f64,
    pub pruned: bool,

    // indexes
    pub txindex: Option<bool>,
    pub coinstatsindex: Option<bool>,
    pub blockfilterindex: Option<bool>,

    // helpful UX messaging
    pub warnings: String,
}
