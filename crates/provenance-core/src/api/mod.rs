pub mod input_resolver;
pub mod types;

use self::input_resolver::{
    resolve_graph_input, CapabilityProvider, InputResolverProvider,
    ADDRESS_INPUT_UNAVAILABLE_REASON,
};
use rusqlite::Connection;

use crate::reporting::{self, build_graph_export_context, GraphExportContext, TxViewProvider};
use crate::{CoreError, Result};

pub fn build_graph_export_context_from_input<
    P: TxViewProvider + InputResolverProvider + CapabilityProvider,
>(
    rpc: &P,
    conn: &Connection,
    request: &types::GraphInputRequest,
) -> Result<types::GraphInputBuildResponse> {
    let resolution = resolve_graph_input(rpc, request)?;
    let Some(selected_root_txid) = resolution.selected_root_txid.clone() else {
        return Ok(types::GraphInputBuildResponse {
            resolution,
            graph_context: None,
        });
    };

    if resolution.requires_selection {
        return Err(CoreError::Other(
            "input resolution requires candidate selection before graph build".to_string(),
        ));
    }

    let graph_request = types::GraphExportContextRequest {
        root_txid: selected_root_txid,
        traversal_depth: request.traversal_depth,
    };
    let context = build_graph_export_context(rpc, conn, &graph_request)?;

    Ok(types::GraphInputBuildResponse {
        resolution,
        graph_context: Some(context),
    })
}

pub fn get_graph_input_capabilities(
    rpc: &(impl InputResolverProvider + CapabilityProvider),
) -> Result<types::GraphInputCapabilities> {
    let mut supported_input_kinds =
        vec![types::GraphInputKind::Txid, types::GraphInputKind::Outpoint];
    let address_unavailable_reason = if rpc.supports_scantxoutset()? {
        supported_input_kinds.push(types::GraphInputKind::Address);
        None
    } else {
        Some(ADDRESS_INPUT_UNAVAILABLE_REASON.to_string())
    };

    Ok(types::GraphInputCapabilities {
        supported_input_kinds,
        address_unavailable_reason,
    })
}

pub fn preview_report<P: TxViewProvider>(
    rpc: &P,
    conn: &Connection,
    request: &types::ReportPreviewRequest,
) -> Result<types::ReportPreviewResponse> {
    let context = build_graph_export_context(rpc, conn, &request.graph)?;
    preview_report_for_context(&context, &request.report)
}

pub fn preview_report_for_context(
    context: &GraphExportContext,
    request: &types::ReportRequest,
) -> Result<types::ReportPreviewResponse> {
    reporting::preview_report(context, request)
}

pub fn export_report<P: TxViewProvider>(
    rpc: &P,
    conn: &Connection,
    request: &types::ReportExportRequest,
) -> Result<types::ReportExportResult> {
    let context = build_graph_export_context(rpc, conn, &request.graph)?;
    export_report_for_context(&context, &request.report)
}

pub fn export_report_for_context(
    context: &GraphExportContext,
    request: &types::ReportRequest,
) -> Result<types::ReportExportResult> {
    reporting::export_report_csv(context, request)
}

#[cfg(feature = "store-sqlite")]
pub fn preview_bip329_import(
    conn: &Connection,
    request: &types::Bip329ImportPreviewRequest,
) -> Result<types::Bip329ImportPreviewResponse> {
    crate::bip329::preview_bip329_jsonl(conn, &request.jsonl_contents)
}

#[cfg(feature = "store-sqlite")]
pub fn apply_bip329_import(
    conn: &Connection,
    request: &types::Bip329ImportApplyRequest,
) -> Result<types::Bip329ImportApplyResult> {
    crate::bip329::import_bip329_jsonl_with_policy(conn, &request.jsonl_contents, request.policy)
}

#[cfg(feature = "store-sqlite")]
pub fn export_bip329(conn: &Connection) -> Result<types::Bip329ExportResult> {
    let generated = crate::bip329::export_bip329(conn)?;
    Ok(types::Bip329ExportResult {
        suggested_filename: "provenance-bip329-labels.jsonl".to_string(),
        record_count: generated.record_count,
        supported_label_count: generated.supported_label_count,
        preserved_record_count: generated.preserved_record_count,
        jsonl_contents: generated.jsonl_contents,
    })
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use crate::api::input_resolver::{
        CapabilityProvider, InputResolverProvider, ADDRESS_INPUT_UNAVAILABLE_REASON,
    };
    use crate::api::types::GraphInputRequest;
    use crate::model::tx_view::{TxOutView, TxView};
    use crate::reporting::{build_graph_export_context, GraphExportContextRequest, TxViewProvider};
    use crate::rpc::client::AddressUtxoCandidate;
    use crate::store::db::Database;
    use crate::{CoreError, Result};

    use super::{build_graph_export_context_from_input, get_graph_input_capabilities};

    const TXID_A: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const TXID_B: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const ADDRESS: &str = "1BoatSLRHtKNngkdXEeobR76b53LETtpyT";

    struct FakeProvider {
        tx_views: HashMap<String, TxView>,
        address_candidates: HashMap<String, Vec<AddressUtxoCandidate>>,
        scantxoutset_supported: bool,
    }

    impl TxViewProvider for FakeProvider {
        fn fetch_tx_view(&self, txid: &str) -> Result<TxView> {
            self.tx_views
                .get(txid)
                .cloned()
                .ok_or_else(|| CoreError::Other(format!("tx '{txid}' not found")))
        }
    }

    impl InputResolverProvider for FakeProvider {
        fn scan_address_utxos(&self, address: &str) -> Result<Vec<AddressUtxoCandidate>> {
            Ok(self
                .address_candidates
                .get(address)
                .cloned()
                .unwrap_or_default())
        }
    }

    impl CapabilityProvider for FakeProvider {
        fn supports_scantxoutset(&self) -> Result<bool> {
            Ok(self.scantxoutset_supported)
        }
    }

    #[test]
    fn graph_input_txid_flow_matches_existing_graph_context_builder() {
        let db = Database::open(":memory:").expect("db opens");
        let provider = FakeProvider {
            tx_views: HashMap::from([(TXID_A.to_string(), tx_view(TXID_A))]),
            address_candidates: HashMap::new(),
            scantxoutset_supported: false,
        };

        let request = GraphInputRequest {
            input: TXID_A.to_uppercase(),
            traversal_depth: 0,
            selected_root_txid: None,
        };

        let response = build_graph_export_context_from_input(&provider, db.conn(), &request)
            .expect("input-based graph build succeeds");
        let expected = build_graph_export_context(
            &provider,
            db.conn(),
            &GraphExportContextRequest::new(TXID_A.to_string(), 0),
        )
        .expect("direct graph build succeeds");

        assert_eq!(response.resolution.normalized_input, TXID_A);
        assert_eq!(
            response.resolution.selected_root_txid.as_deref(),
            Some(TXID_A)
        );
        assert_eq!(response.graph_context, Some(expected));
    }

    #[test]
    fn graph_input_address_flow_returns_resolution_only_when_ambiguous() {
        let db = Database::open(":memory:").expect("db opens");
        let provider = FakeProvider {
            tx_views: HashMap::new(),
            address_candidates: HashMap::from([(
                ADDRESS.to_string(),
                vec![
                    AddressUtxoCandidate {
                        txid: TXID_A.to_string(),
                        vout: 0,
                        amount_sat: 1_000,
                        height: Some(100),
                    },
                    AddressUtxoCandidate {
                        txid: TXID_B.to_string(),
                        vout: 1,
                        amount_sat: 2_000,
                        height: Some(90),
                    },
                ],
            )]),
            scantxoutset_supported: true,
        };
        let request = GraphInputRequest {
            input: ADDRESS.to_string(),
            traversal_depth: 1,
            selected_root_txid: None,
        };

        let response = build_graph_export_context_from_input(&provider, db.conn(), &request)
            .expect("ambiguous resolution should return candidates");

        assert!(response.graph_context.is_none());
        assert!(response.resolution.requires_selection);
        assert_eq!(response.resolution.candidate_roots.len(), 2);
        assert!(response.resolution.selected_root_txid.is_none());
    }

    #[test]
    fn graph_input_address_flow_builds_when_selected_root_is_provided() {
        let db = Database::open(":memory:").expect("db opens");
        let provider = FakeProvider {
            tx_views: HashMap::from([(TXID_B.to_string(), tx_view(TXID_B))]),
            address_candidates: HashMap::from([(
                ADDRESS.to_string(),
                vec![
                    AddressUtxoCandidate {
                        txid: TXID_A.to_string(),
                        vout: 0,
                        amount_sat: 1_000,
                        height: Some(100),
                    },
                    AddressUtxoCandidate {
                        txid: TXID_B.to_string(),
                        vout: 1,
                        amount_sat: 2_000,
                        height: Some(90),
                    },
                ],
            )]),
            scantxoutset_supported: true,
        };
        let request = GraphInputRequest {
            input: ADDRESS.to_string(),
            traversal_depth: 0,
            selected_root_txid: Some(TXID_B.to_string()),
        };

        let response = build_graph_export_context_from_input(&provider, db.conn(), &request)
            .expect("selected root should allow graph build");

        assert!(!response.resolution.requires_selection);
        assert_eq!(
            response.resolution.selected_root_txid.as_deref(),
            Some(TXID_B)
        );
        assert_eq!(
            response
                .graph_context
                .as_ref()
                .map(|context| context.root_txid.as_str()),
            Some(TXID_B)
        );
    }

    #[test]
    fn graph_input_capabilities_include_address_when_supported() {
        let provider = FakeProvider {
            tx_views: HashMap::new(),
            address_candidates: HashMap::new(),
            scantxoutset_supported: true,
        };

        let capabilities =
            get_graph_input_capabilities(&provider).expect("capabilities should load");

        assert_eq!(
            capabilities.supported_input_kinds,
            vec![
                crate::api::types::GraphInputKind::Txid,
                crate::api::types::GraphInputKind::Outpoint,
                crate::api::types::GraphInputKind::Address,
            ]
        );
        assert!(capabilities.address_unavailable_reason.is_none());
    }

    #[test]
    fn graph_input_capabilities_exclude_address_when_unsupported() {
        let provider = FakeProvider {
            tx_views: HashMap::new(),
            address_candidates: HashMap::new(),
            scantxoutset_supported: false,
        };

        let capabilities =
            get_graph_input_capabilities(&provider).expect("capabilities should load");

        assert_eq!(
            capabilities.supported_input_kinds,
            vec![
                crate::api::types::GraphInputKind::Txid,
                crate::api::types::GraphInputKind::Outpoint,
            ]
        );
        assert_eq!(
            capabilities.address_unavailable_reason.as_deref(),
            Some(ADDRESS_INPUT_UNAVAILABLE_REASON)
        );
    }

    fn tx_view(txid: &str) -> TxView {
        TxView {
            txid: txid.to_string(),
            version: 2,
            lock_time: 0,
            inputs_count: 0,
            outputs: vec![TxOutView {
                vout: 0,
                value_sat: 50_000,
                script_pubkey_hex: "0014deadbeef".to_string(),
                script_type: Some("p2wpkh".to_string()),
                address: Some(ADDRESS.to_string()),
            }],
            inputs: Vec::new(),
            weight: 400,
            vsize: 100,
            is_coinbase: false,
            fee_sat: None,
            feerate_sat_vb: None,
            confirmations: Some(1),
            blockhash: Some(
                "1111111111111111111111111111111111111111111111111111111111111111".to_string(),
            ),
            block_height: Some(1),
            block_time: Some(1_700_000_000),
        }
    }
}
