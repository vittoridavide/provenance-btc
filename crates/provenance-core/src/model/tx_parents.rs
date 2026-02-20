use bitcoin::consensus::encode::deserialize;
use bitcoin::{Transaction, Txid};

use std::collections::HashSet;

use crate::error::{CoreError, Result};

/// Parse raw transaction hex into a [`Transaction`].
pub fn tx_from_hex(tx_hex: &str) -> Result<Transaction> {
    let tx_hex = tx_hex.trim();

    let raw = hex::decode(tx_hex).map_err(|e| CoreError::Other(format!("Invalid tx hex: {e}")))?;

    deserialize(&raw).map_err(|e| CoreError::Other(format!("Failed to parse tx: {e}")))
}

/// Extract unique parent txids from a transaction's inputs.
///
/// Coinbase inputs (null prevout) are ignored.
pub fn parent_txids(tx: &Transaction) -> Vec<Txid> {
    let mut visited = HashSet::<Txid>::new();
    let mut out = Vec::<Txid>::new();

    for inp in &tx.input {
        // coinbase / null prevout
        if inp.previous_output.is_null() {
            continue;
        }

        let txid = inp.previous_output.txid;
        if visited.insert(txid) {
            out.push(txid);
        }
    }

    out
}

/// Convenience: parse tx hex and return its unique parent txids.
pub fn parent_txids_from_hex(tx_hex: &str) -> Result<Vec<Txid>> {
    let tx = tx_from_hex(tx_hex)?;
    Ok(parent_txids(&tx))
}
