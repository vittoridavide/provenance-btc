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
    pub is_coinbase: bool,
    pub fee_sat: Option<u64>,
    pub feerate_sat_vb: Option<f64>,

    pub confirmations: Option<u32>,
    pub blockhash: Option<String>,
    pub block_height: Option<u32>,
    pub block_time: Option<u64>,
}

/// Calculate fee in satoshis:
/// `sum(input values) - sum(output values)`.
///
/// Returns `None` when:
/// - transaction is coinbase (fee is not defined at tx level),
/// - any input value is unknown (e.g. missing parent tx),
/// - output sum exceeds input sum.
pub fn calculate_fee_sat(
    is_coinbase: bool,
    inputs: &[TxInpView],
    outputs: &[TxOutView],
) -> Option<u64> {
    if is_coinbase || inputs.iter().any(|i| i.is_coinbase) {
        return None;
    }

    let input_sum = inputs
        .iter()
        .try_fold(0u128, |acc, inp| inp.value_sat.map(|v| acc + (v as u128)))?;
    let output_sum = outputs
        .iter()
        .fold(0u128, |acc, out| acc + (out.value_sat as u128));

    if input_sum < output_sum {
        return None;
    }

    u64::try_from(input_sum - output_sum).ok()
}

/// Calculate feerate in sat/vB.
pub fn calculate_feerate_sat_vb(fee_sat: Option<u64>, vsize: u64) -> Option<f64> {
    let fee_sat = fee_sat?;
    if vsize == 0 {
        return None;
    }
    Some(fee_sat as f64 / vsize as f64)
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
    pub value_sat: Option<u64>,
    pub script_pubkey_hex: String,
    pub script_type: Option<String>, // "p2wpkh", "p2tr", ...
    pub script_sig_hex: String,
    pub witness_items_count: usize,
    pub witness_hex: Vec<String>,
    pub is_coinbase: bool,
}
