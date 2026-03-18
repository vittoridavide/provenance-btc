use serde::{Deserialize, Serialize};
use serde_json::Value;

#[cfg(feature = "store-sqlite")]
pub use crate::bip329::{
    ImportConflictPolicy as Bip329ImportConflictPolicy,
    ImportDisposition as Bip329ImportDisposition, ImportErrorLine as Bip329ImportErrorLine,
    ImportPreview as Bip329ImportPreviewResponse, ImportPreviewLine as Bip329ImportPreviewLine,
    ImportReport as Bip329ImportApplyResult,
};
pub use crate::reporting::{
    GeneratedReport as ReportExportResult, GraphExportContext, GraphExportContextRequest,
    ReportIssueCode, ReportKind, ReportManifest, ReportPreview as ReportPreviewResponse,
    ReportRequest, ReportScope, ReportSeverity, ReportWarning,
};

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
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum GraphInputKind {
    Txid,
    Outpoint,
    Address,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GraphInputRequest {
    pub input: String,
    pub traversal_depth: u32,
    #[serde(default)]
    pub selected_root_txid: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GraphInputCandidateRoot {
    pub txid: String,
    pub vout: Option<u32>,
    pub amount_sat: Option<u64>,
    pub height: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GraphInputResolution {
    pub normalized_input: String,
    pub input_kind: GraphInputKind,
    pub candidate_roots: Vec<GraphInputCandidateRoot>,
    pub selected_root_txid: Option<String>,
    pub requires_selection: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct GraphInputBuildResponse {
    pub resolution: GraphInputResolution,
    pub graph_context: Option<GraphExportContext>,
}

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
    pub vsize: Option<u64>,
    pub fee_sat: Option<u64>,
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ReportPreviewRequest {
    pub graph: GraphExportContextRequest,
    pub report: ReportRequest,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ReportExportRequest {
    pub graph: GraphExportContextRequest,
    pub report: ReportRequest,
}

#[cfg(feature = "store-sqlite")]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Bip329ImportPreviewRequest {
    pub jsonl_contents: String,
}

#[cfg(feature = "store-sqlite")]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Bip329ImportApplyRequest {
    pub jsonl_contents: String,
    pub policy: Bip329ImportConflictPolicy,
}

#[cfg(feature = "store-sqlite")]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Bip329ExportResult {
    pub suggested_filename: String,
    pub record_count: u32,
    pub supported_label_count: u32,
    pub preserved_record_count: u32,
    pub jsonl_contents: String,
}

#[cfg(test)]
mod tests {
    #[cfg(feature = "store-sqlite")]
    use super::{
        Bip329ExportResult, Bip329ImportApplyRequest, Bip329ImportConflictPolicy,
        Bip329ImportDisposition, Bip329ImportErrorLine, Bip329ImportPreviewLine,
        Bip329ImportPreviewRequest, Bip329ImportPreviewResponse,
    };
    use super::{
        GraphExportContextRequest, GraphInputBuildResponse, GraphInputCandidateRoot,
        GraphInputKind, GraphInputRequest, GraphInputResolution, RefType, ReportExportRequest,
        ReportIssueCode, ReportKind, ReportManifest, ReportPreviewRequest, ReportPreviewResponse,
        ReportRequest, ReportScope, ReportSeverity, ReportWarning,
    };

    #[test]
    fn api_report_request_contract_serializes_nested_graph_and_report_fields() {
        let request = ReportPreviewRequest {
            graph: GraphExportContextRequest {
                root_txid: "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
                    .to_string(),
                traversal_depth: 2,
            },
            report: ReportRequest {
                kind: ReportKind::Transactions,
                scope: ReportScope::CurrentGraph,
            },
        };

        let json = serde_json::to_value(&request).expect("request serializes");

        assert_eq!(json["graph"]["root_txid"], request.graph.root_txid);
        assert_eq!(json["graph"]["traversal_depth"], 2);
        assert_eq!(json["report"]["kind"], "transactions");
        assert_eq!(json["report"]["scope"], "current_graph");
    }

    #[test]
    fn api_report_response_contract_keeps_manifest_and_warning_shapes() {
        let response = ReportPreviewResponse {
            manifest: ReportManifest {
                report_kind: ReportKind::Outputs,
                report_scope: ReportScope::CurrentGraph,
                schema_version: 1,
                row_count: 3,
                columns: vec!["txid".to_string(), "vout".to_string()],
                suggested_filename: "provenance-outputs-current-graph-root.csv".to_string(),
            },
            warnings: vec![ReportWarning {
                severity: ReportSeverity::Warning,
                issue_code: ReportIssueCode::UnclassifiedOutput,
                ref_type: RefType::Output,
                ref_id: "outpoint".to_string(),
                message: "output has no classification".to_string(),
            }],
        };
        let export_request = ReportExportRequest {
            graph: GraphExportContextRequest {
                root_txid: "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
                    .to_string(),
                traversal_depth: 1,
            },
            report: ReportRequest {
                kind: ReportKind::Outputs,
                scope: ReportScope::CurrentGraph,
            },
        };

        let response_json = serde_json::to_value(&response).expect("response serializes");
        let request_json = serde_json::to_value(&export_request).expect("request serializes");

        assert_eq!(response_json["manifest"]["report_kind"], "outputs");
        assert_eq!(
            response_json["warnings"][0]["issue_code"],
            "unclassified_output"
        );
        assert_eq!(response_json["warnings"][0]["ref_type"], "output");
        assert_eq!(request_json["report"]["kind"], "outputs");
    }

    #[test]
    fn api_graph_input_contract_serialization_matches_request_and_resolution_shapes() {
        let request = GraphInputRequest {
            input: "1BoatSLRHtKNngkdXEeobR76b53LETtpyT".to_string(),
            traversal_depth: 3,
            selected_root_txid: Some(
                "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".to_string(),
            ),
        };
        let response = GraphInputBuildResponse {
            resolution: GraphInputResolution {
                normalized_input: "1BoatSLRHtKNngkdXEeobR76b53LETtpyT".to_string(),
                input_kind: GraphInputKind::Address,
                candidate_roots: vec![GraphInputCandidateRoot {
                    txid: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
                        .to_string(),
                    vout: Some(0),
                    amount_sat: Some(1_000),
                    height: Some(800_000),
                }],
                selected_root_txid: Some(
                    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".to_string(),
                ),
                requires_selection: false,
            },
            graph_context: None,
        };

        let request_json = serde_json::to_value(&request).expect("request serializes");
        let response_json = serde_json::to_value(&response).expect("response serializes");

        assert_eq!(
            request_json["selected_root_txid"],
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        );
        assert_eq!(response_json["resolution"]["input_kind"], "address");
        assert_eq!(
            response_json["resolution"]["candidate_roots"][0]["amount_sat"],
            1_000
        );
        assert_eq!(response_json["graph_context"], serde_json::Value::Null);
    }

    #[cfg(feature = "store-sqlite")]
    #[test]
    fn api_bip329_contract_serialization_matches_preview_apply_and_export_shapes() {
        let preview_request = Bip329ImportPreviewRequest {
            jsonl_contents: "{\"type\":\"tx\"}\n".to_string(),
        };
        let apply_request = Bip329ImportApplyRequest {
            jsonl_contents: "{\"type\":\"output\"}\n".to_string(),
            policy: Bip329ImportConflictPolicy::PreferImport,
        };
        let preview_response = Bip329ImportPreviewResponse {
            total_lines: 1,
            apply_supported: 0,
            preserve_only: 1,
            ambiguous_supported: 0,
            invalid: 0,
            ignored_unsupported: 0,
            lines: vec![Bip329ImportPreviewLine {
                line_number: 1,
                disposition: Bip329ImportDisposition::PreserveOnly,
                record_type: Some("addr".to_string()),
                record_ref: Some("1BoatSLRHtKNngkdXEeobR76b53LETtpyT".to_string()),
                origin: Some("wallet-a".to_string()),
                message: None,
            }],
        };
        let export_result = Bip329ExportResult {
            suggested_filename: "provenance-bip329-labels.jsonl".to_string(),
            record_count: 2,
            supported_label_count: 1,
            preserved_record_count: 1,
            jsonl_contents: "{\"type\":\"tx\"}\n{\"type\":\"addr\"}".to_string(),
        };
        let apply_result = super::Bip329ImportApplyResult {
            total_lines: 2,
            imported: 1,
            preserved_only: 1,
            ambiguous_supported: 0,
            skipped_unsupported_type: 0,
            skipped_invalid: 0,
            errors: vec![Bip329ImportErrorLine {
                line_number: 2,
                message: "invalid record".to_string(),
            }],
        };

        let preview_request_json =
            serde_json::to_value(&preview_request).expect("preview request serializes");
        let apply_request_json =
            serde_json::to_value(&apply_request).expect("apply request serializes");
        let preview_response_json =
            serde_json::to_value(&preview_response).expect("preview response serializes");
        let apply_result_json =
            serde_json::to_value(&apply_result).expect("apply result serializes");
        let export_result_json =
            serde_json::to_value(&export_result).expect("export result serializes");

        assert_eq!(
            preview_request_json["jsonl_contents"],
            "{\"type\":\"tx\"}\n"
        );
        assert_eq!(
            apply_request_json["jsonl_contents"],
            "{\"type\":\"output\"}\n"
        );
        assert_eq!(apply_request_json["policy"], "prefer_import");
        assert_eq!(
            preview_response_json["lines"][0]["disposition"],
            "preserve_only"
        );
        assert_eq!(apply_result_json["errors"][0]["line_number"], 2);
        assert_eq!(
            export_result_json["suggested_filename"],
            "provenance-bip329-labels.jsonl"
        );
        assert_eq!(export_result_json["supported_label_count"], 1);
        assert_eq!(export_result_json["preserved_record_count"], 1);
    }
}
