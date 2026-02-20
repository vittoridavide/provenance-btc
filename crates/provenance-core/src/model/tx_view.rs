use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TxView {
    pub txid: String,
    pub version: i32,
    pub lock_time: u32,
    pub inputs_count: usize,
    pub outputs: Vec<TxOutView>,
    pub inputs: Vec<TxInpView>,
    pub weight: u64,
    pub vsize: u64,

    pub confirmations: Option<u32>,
    pub blockhash: Option<String>,
    pub block_height: Option<u32>,
    pub block_time: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TxOutView {
    pub vout: u32,
    pub value_sat: u64,
    pub script_pubkey_hex: String,
    pub script_type: Option<String>, // "p2wpkh", "p2tr", ...

    pub address: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TxInpView {
    pub vin: u32,
    pub prev_txid: String,
    pub prev_vout: u32,
    pub value_sat: u64,
    pub script_pubkey_hex: String,
    pub script_type: Option<String>, // "p2wpkh", "p2tr", ...
    pub script_sig_hex: String,
    pub witness_items_count: usize,
    pub witness_hex: Vec<String>,
}
