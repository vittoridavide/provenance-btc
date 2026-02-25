use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TxStatus {
    Confirmed,
    Mempool,
    Missing,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum ClassificationState {
    None,
    TxOnly,
    Complete,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum RefType {
    Tx,
    Output,
}

impl RefType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Tx => "tx",
            Self::Output => "output",
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct GraphBuildOptions {}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Classification {
    pub category: String,
    pub context: String,
    pub metadata: Value,
    pub tax_relevant: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GraphNode {
    pub txid: String,
    pub status: TxStatus,
    pub confirmations: Option<u32>,
    pub height: Option<u32>,
    pub time: Option<u64>,
    pub is_root: bool,
    pub label: Option<String>,
    pub classification_category: Option<String>,
    pub classification_state: ClassificationState,
    pub missing_parents_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GraphEdge {
    pub from_txid: String,
    pub to_txid: String,
    pub vin_index: u32,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct GraphSummary {
    pub total_nodes: u32,
    pub unclassified_nodes: u32,
    pub missing_parent_edges: u32,
    pub confirmed_nodes: u32,
    pub mempool_nodes: u32,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProvenanceGraph {
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
    pub summary: GraphSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TxInput {
    pub vin: u32,
    pub prev_txid: String,
    pub prev_vout: u32,
    pub value_sat: Option<u64>,
    pub script_pubkey_hex: String,
    pub script_type: Option<String>,
    pub script_sig_hex: String,
    pub witness_items_count: usize,
    pub witness_hex: Vec<String>,
    pub is_coinbase: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TxOutput {
    pub vout: u32,
    pub value_sat: u64,
    pub script_pubkey_hex: String,
    pub script_type: Option<String>,
    pub address: Option<String>,
    pub label: Option<String>,
    pub classification: Option<Classification>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TransactionDetail {
    pub txid: String,
    pub hex: String,
    pub version: i32,
    pub lock_time: u32,
    pub weight: u64,
    pub vsize: u64,
    pub fee_sat: Option<u64>,
    pub feerate_sat_vb: Option<f64>,
    pub confirmations: Option<u32>,
    pub blockhash: Option<String>,
    pub block_height: Option<u32>,
    pub block_time: Option<u64>,
    pub inputs: Vec<TxInput>,
    pub outputs: Vec<TxOutput>,
    pub label: Option<String>,
    pub classification: Option<Classification>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct ImportSummary {
    pub imported: u32,
    pub skipped: u32,
    pub errors: Vec<String>,
}
