// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use provenance_core::api::types::{
    Classification, GraphBuildOptions, ImportSummary, ProvenanceGraph, RefType, TransactionDetail,
    TxInput, TxOutput,
};
use provenance_core::bip329::{export_bip329_jsonl, import_bip329_jsonl};

use provenance_core::model::tx_view::TxView;
use provenance_core::reporting::{build_graph_export_context, GraphExportContextRequest};
use provenance_core::rpc::client::{CoreRpc, RpcAuth, RpcConfig};
use provenance_core::rpc::types::CoreStatus;
use provenance_core::store::classifications;
use provenance_core::store::db::Database;
use provenance_core::store::labels;
use std::env;
use std::sync::{Arc, RwLock};

#[derive(Clone)]
struct AppState {
    rpc_config: Arc<RwLock<Option<RpcConfig>>>,
    db_path: Arc<String>,
}

#[derive(serde::Deserialize)]
struct SetRpcConfigArgs {
    url: String,
    username: Option<String>,
    password: Option<String>,
}

#[tauri::command]
fn cmd_set_rpc_config(
    state: tauri::State<'_, AppState>,
    args: SetRpcConfigArgs,
) -> Result<(), String> {
    let auth = match (args.username, args.password) {
        (Some(u), Some(p)) => RpcAuth::UserPass {
            username: u,
            password: p,
        },
        _ => return Err("Username and password required".into()),
    };

    let cfg = RpcConfig {
        url: args.url,
        auth,
    };
    // Validate RPC immediately.
    // Validate immediately
    CoreRpc::new(&cfg).map_err(|e| e.to_string())?;

    *state.rpc_config.write().unwrap() = Some(cfg);
    Ok(())
}
fn get_rpc_config(state: &tauri::State<'_, AppState>) -> Result<RpcConfig, String> {
    state
        .rpc_config
        .read()
        .unwrap()
        .clone()
        .ok_or_else(|| "RPC not configured. Call cmd_set_rpc_config first.".to_string())
}

fn open_db(path: &str) -> Result<Database, String> {
    Database::open(path).map_err(|e| format!("Failed to open DB at '{path}': {e}"))
}

#[tauri::command]
async fn cmd_core_status(state: tauri::State<'_, AppState>) -> Result<CoreStatus, String> {
    let cfg = get_rpc_config(&state)?;

    tauri::async_runtime::spawn_blocking(move || {
        let rpc = CoreRpc::new(&cfg).map_err(|e| e.to_string())?;
        rpc.status().map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn cmd_delete_classification(
    state: tauri::State<'_, AppState>,
    ref_type: RefType,
    ref_id: String,
) -> Result<bool, String> {
    let db_path = (*state.db_path).clone();
    tauri::async_runtime::spawn_blocking(move || {
        let db = open_db(&db_path)?;
        classifications::delete_classification(db.conn(), ref_type.as_str(), &ref_id)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn cmd_fetch_tx(state: tauri::State<'_, AppState>, txid: String) -> Result<TxView, String> {
    let cfg = get_rpc_config(&state)?;

    tauri::async_runtime::spawn_blocking(move || {
        let rpc = CoreRpc::new(&cfg).map_err(|e| format!("Failed to connect: {e}"))?;
        rpc.fetch_tx_view(&txid)
            .map_err(|e| format!("Failed to fetch tx: {e}"))
    })
    .await
    .map_err(|e| format!("Join error: {e}"))?
}
#[tauri::command]
async fn cmd_build_graph(
    state: tauri::State<'_, AppState>,
    root_txid: String,
    depth: u32,
    _options: GraphBuildOptions,
) -> Result<ProvenanceGraph, String> {
    let cfg = get_rpc_config(&state)?;
    let db_path = (*state.db_path).clone();

    tauri::async_runtime::spawn_blocking(move || {
        let rpc = CoreRpc::new(&cfg).map_err(|e| e.to_string())?;
        let db = open_db(&db_path)?;
        let request = GraphExportContextRequest::new(root_txid, depth);
        let context =
            build_graph_export_context(&rpc, db.conn(), &request).map_err(|e| e.to_string())?;
        Ok(context.to_provenance_graph())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn cmd_get_tx_detail(
    state: tauri::State<'_, AppState>,
    txid: String,
) -> Result<TransactionDetail, String> {
    let cfg = get_rpc_config(&state)?;
    let db_path = (*state.db_path).clone();

    tauri::async_runtime::spawn_blocking(move || {
        let rpc = CoreRpc::new(&cfg).map_err(|e| e.to_string())?;
        let db = open_db(&db_path)?;
        let conn = db.conn();

        let tx_view = rpc.fetch_tx_view(&txid).map_err(|e| e.to_string())?;
        let tx_hex = rpc
            .get_raw_transaction_hex_str(&txid)
            .map_err(|e| e.to_string())?;

        let tx_label = labels::get_label(conn, RefType::Tx.as_str(), &txid)
            .map_err(|e| e.to_string())?
            .map(|l| l.label);
        let tx_classification =
            classifications::get_classification(conn, RefType::Tx.as_str(), &txid)
                .map_err(|e| e.to_string())?
                .map(|c| stored_to_api_classification(&c));

        let inputs = tx_view
            .inputs
            .into_iter()
            .map(|input| TxInput {
                vin: input.vin,
                prev_txid: input.prev_txid,
                prev_vout: input.prev_vout,
                value_sat: input.value_sat,
                script_pubkey_hex: input.script_pubkey_hex,
                script_type: input.script_type,
                script_sig_hex: input.script_sig_hex,
                witness_items_count: input.witness_items_count,
                witness_hex: input.witness_hex,
                is_coinbase: input.is_coinbase,
            })
            .collect::<Vec<_>>();

        let outputs = tx_view
            .outputs
            .into_iter()
            .map(|output| {
                let ref_id = format!("{txid}:{}", output.vout);
                let label = labels::get_label(conn, RefType::Output.as_str(), &ref_id)
                    .map_err(|e| e.to_string())?
                    .map(|l| l.label);
                let classification =
                    classifications::get_classification(conn, RefType::Output.as_str(), &ref_id)
                        .map_err(|e| e.to_string())?
                        .map(|c| stored_to_api_classification(&c));

                Ok::<TxOutput, String>(TxOutput {
                    vout: output.vout,
                    value_sat: output.value_sat,
                    script_pubkey_hex: output.script_pubkey_hex,
                    script_type: output.script_type,
                    address: output.address,
                    label,
                    classification,
                })
            })
            .collect::<Result<Vec<_>, _>>()?;

        Ok(TransactionDetail {
            txid: tx_view.txid,
            hex: tx_hex,
            version: tx_view.version,
            lock_time: tx_view.lock_time,
            weight: tx_view.weight,
            vsize: tx_view.vsize,
            fee_sat: tx_view.fee_sat,
            feerate_sat_vb: tx_view.feerate_sat_vb,
            confirmations: tx_view.confirmations,
            blockhash: tx_view.blockhash,
            block_height: tx_view.block_height,
            block_time: tx_view.block_time,
            inputs,
            outputs,
            label: tx_label,
            classification: tx_classification,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn cmd_set_label(
    state: tauri::State<'_, AppState>,
    ref_type: RefType,
    ref_id: String,
    label: String,
) -> Result<(), String> {
    let db_path = (*state.db_path).clone();
    tauri::async_runtime::spawn_blocking(move || {
        let db = open_db(&db_path)?;
        labels::set_label(db.conn(), ref_type.as_str(), &ref_id, &label).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn cmd_delete_label(
    state: tauri::State<'_, AppState>,
    ref_type: RefType,
    ref_id: String,
) -> Result<bool, String> {
    let db_path = (*state.db_path).clone();
    tauri::async_runtime::spawn_blocking(move || {
        let db = open_db(&db_path)?;
        labels::delete_label(db.conn(), ref_type.as_str(), &ref_id).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn cmd_set_classification(
    state: tauri::State<'_, AppState>,
    ref_type: RefType,
    ref_id: String,
    classification: Classification,
) -> Result<(), String> {
    let db_path = (*state.db_path).clone();
    tauri::async_runtime::spawn_blocking(move || {
        let db = open_db(&db_path)?;
        let context = if classification.context.trim().is_empty() {
            None
        } else {
            Some(classification.context.as_str())
        };

        classifications::set_classification(
            db.conn(),
            ref_type.as_str(),
            &ref_id,
            &classification.category,
            context,
            &classification.metadata,
            classification.tax_relevant,
        )
        .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn cmd_export_labels(state: tauri::State<'_, AppState>) -> Result<String, String> {
    let db_path = (*state.db_path).clone();
    tauri::async_runtime::spawn_blocking(move || {
        let db = open_db(&db_path)?;
        export_bip329_jsonl(db.conn()).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn cmd_import_labels(
    state: tauri::State<'_, AppState>,
    jsonl: String,
) -> Result<ImportSummary, String> {
    let db_path = (*state.db_path).clone();
    tauri::async_runtime::spawn_blocking(move || {
        let db = open_db(&db_path)?;
        let report = import_bip329_jsonl(db.conn(), &jsonl).map_err(|e| e.to_string())?;

        let errors = report
            .errors
            .into_iter()
            .map(|e| format!("line {}: {}", e.line_number, e.message))
            .collect::<Vec<_>>();

        Ok(ImportSummary {
            imported: report.imported as u32,
            skipped: (report.skipped_invalid + report.skipped_unsupported_type) as u32,
            errors,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn cmd_export_graph_json(graph: ProvenanceGraph) -> Result<String, String> {
    serde_json::to_string_pretty(&graph).map_err(|e| e.to_string())
}

fn stored_to_api_classification(stored: &classifications::StoredClassification) -> Classification {
    Classification {
        category: stored.category.clone(),
        context: stored.context.clone().unwrap_or_default(),
        metadata: stored.metadata.clone(),
        tax_relevant: stored.tax_relevant,
    }
}

fn main() {
    let db_path =
        env::var("PROVENANCE_DB_PATH").unwrap_or_else(|_| "provenance.sqlite3".to_string());
    let _ = Database::open(&db_path);
    let state = AppState {
        rpc_config: Arc::new(RwLock::new(None)),
        db_path: Arc::new(db_path),
    };

    tauri::Builder::default()
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            cmd_set_rpc_config,
            cmd_core_status,
            cmd_fetch_tx,
            cmd_build_graph,
            cmd_get_tx_detail,
            cmd_set_label,
            cmd_delete_label,
            cmd_set_classification,
            cmd_delete_classification,
            cmd_export_labels,
            cmd_import_labels,
            cmd_export_graph_json
        ])
        .run(tauri::generate_context!())
        .expect("error running Tauri");
}
