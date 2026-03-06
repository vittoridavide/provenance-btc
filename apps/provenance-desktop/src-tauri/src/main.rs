// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use provenance_core::api::types::{
    Classification, ClassificationState, GraphBuildOptions, GraphEdge, GraphNode, GraphSummary,
    ImportSummary, ProvenanceGraph, RefType, TransactionDetail, TxInput, TxOutput, TxStatus,
};
use provenance_core::bip329::{export_bip329_jsonl, import_bip329_jsonl};

use provenance_core::model::tx_view::TxView;
use provenance_core::rpc::client::{CoreRpc, RpcAuth, RpcConfig};
use provenance_core::rpc::types::CoreStatus;
use provenance_core::store::classifications;
use provenance_core::store::db::Database;
use provenance_core::store::labels;

use rusqlite::{params_from_iter, Connection};
use std::collections::{HashMap, HashSet, VecDeque};
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
        build_graph_payload(&rpc, db.conn(), &root_txid, depth).map_err(|e| e.to_string())
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

fn build_graph_payload(
    rpc: &CoreRpc,
    conn: &Connection,
    root_txid: &str,
    depth: u32,
) -> provenance_core::Result<ProvenanceGraph> {
    if root_txid.trim().is_empty() {
        return Err(provenance_core::CoreError::Other(
            "root_txid must not be empty".to_string(),
        ));
    }

    let mut nodes: HashMap<String, GraphNode> = HashMap::new();
    let mut edges: Vec<GraphEdge> = Vec::new();
    let mut q = VecDeque::<(String, u32)>::new();
    let mut queued = HashSet::<String>::new();
    let mut visited = HashSet::<String>::new();

    q.push_back((root_txid.to_string(), 0));
    queued.insert(root_txid.to_string());
    nodes.insert(root_txid.to_string(), missing_node(root_txid, true));

    while let Some((txid, current_depth)) = q.pop_front() {
        queued.remove(&txid);
        if !visited.insert(txid.clone()) {
            continue;
        }

        let tx_view = match rpc.fetch_tx_view(&txid) {
            Ok(view) => view,
            Err(err) => {
                if txid == root_txid {
                    return Err(provenance_core::CoreError::Other(format!(
                        "failed to fetch root tx '{root_txid}': {err}"
                    )));
                }
                let node = nodes
                    .entry(txid.clone())
                    .or_insert_with(|| missing_node(&txid, false));
                node.status = TxStatus::Missing;
                continue;
            }
        };

        let node = nodes
            .entry(txid.clone())
            .or_insert_with(|| missing_node(&txid, txid == root_txid));
        node.status = if tx_view.confirmations.unwrap_or(0) > 0 {
            TxStatus::Confirmed
        } else {
            TxStatus::Mempool
        };
        node.confirmations = tx_view.confirmations;
        node.height = tx_view.block_height;
        node.time = tx_view.block_time;
        node.vsize = Some(tx_view.vsize);
        node.fee_sat = tx_view.fee_sat;
        node.is_root = txid == root_txid;

        if current_depth >= depth {
            continue;
        }

        for input in tx_view.inputs.iter().filter(|input| !input.is_coinbase) {
            let parent_txid = input.prev_txid.clone();

            edges.push(GraphEdge {
                from_txid: txid.clone(),
                to_txid: parent_txid.clone(),
                vin_index: input.vin,
            });

            nodes
                .entry(parent_txid.clone())
                .or_insert_with(|| missing_node(&parent_txid, false));

            if !visited.contains(&parent_txid) && queued.insert(parent_txid.clone()) {
                q.push_back((parent_txid, current_depth + 1));
            }
        }
    }

    let txids = nodes.keys().cloned().collect::<Vec<_>>();
    let labels_map = fetch_tx_labels_for_ids(conn, &txids)?;
    let classifications_map = fetch_tx_classifications_for_ids(conn, &txids)?;

    for (txid, node) in &mut nodes {
        node.label = labels_map.get(txid).cloned();

        if let Some(classification) = classifications_map.get(txid) {
            node.classification_category = Some(classification.category.clone());
            node.classification_state = ClassificationState::TxOnly;
        } else {
            node.classification_category = None;
            node.classification_state = ClassificationState::None;
        }
    }

    let mut missing_parent_counts = HashMap::<String, u32>::new();
    for edge in &edges {
        if matches!(
            nodes.get(&edge.to_txid).map(|node| node.status),
            Some(TxStatus::Missing)
        ) {
            *missing_parent_counts
                .entry(edge.from_txid.clone())
                .or_insert(0) += 1;
        }
    }
    for (txid, node) in &mut nodes {
        node.missing_parents_count = *missing_parent_counts.get(txid).unwrap_or(&0);
    }

    let mut nodes_vec = nodes.into_values().collect::<Vec<_>>();
    nodes_vec.sort_by(|a, b| a.txid.cmp(&b.txid));

    edges.sort_by(|a, b| {
        a.from_txid
            .cmp(&b.from_txid)
            .then_with(|| a.to_txid.cmp(&b.to_txid))
            .then_with(|| a.vin_index.cmp(&b.vin_index))
    });

    let summary = GraphSummary {
        total_nodes: nodes_vec.len() as u32,
        unclassified_nodes: nodes_vec
            .iter()
            .filter(|n| matches!(n.classification_state, ClassificationState::None))
            .count() as u32,
        missing_parent_edges: edges
            .iter()
            .filter(|e| {
                matches!(
                    nodes_vec
                        .iter()
                        .find(|n| n.txid == e.to_txid)
                        .map(|n| n.status),
                    Some(TxStatus::Missing)
                )
            })
            .count() as u32,
        confirmed_nodes: nodes_vec
            .iter()
            .filter(|n| matches!(n.status, TxStatus::Confirmed))
            .count() as u32,
        mempool_nodes: nodes_vec
            .iter()
            .filter(|n| matches!(n.status, TxStatus::Mempool))
            .count() as u32,
    };

    Ok(ProvenanceGraph {
        nodes: nodes_vec,
        edges,
        summary,
    })
}

fn missing_node(txid: &str, is_root: bool) -> GraphNode {
    GraphNode {
        txid: txid.to_string(),
        status: TxStatus::Missing,
        confirmations: None,
        height: None,
        time: None,
        vsize: None,
        fee_sat: None,
        is_root,
        label: None,
        classification_category: None,
        classification_state: ClassificationState::None,
        missing_parents_count: 0,
    }
}

fn fetch_tx_labels_for_ids(
    conn: &Connection,
    txids: &[String],
) -> provenance_core::Result<HashMap<String, String>> {
    if txids.is_empty() {
        return Ok(HashMap::new());
    }

    let placeholders = vec!["?"; txids.len()].join(", ");
    let sql = format!(
        "SELECT ref_id, label
         FROM labels
         WHERE ref_type = 'tx' AND ref_id IN ({placeholders})"
    );
    let mut stmt = conn.prepare(&sql)?;
    let mut rows = stmt.query(params_from_iter(txids.iter()))?;

    let mut out = HashMap::new();
    while let Some(row) = rows.next()? {
        let ref_id: String = row.get(0)?;
        let label: String = row.get(1)?;
        out.insert(ref_id, label);
    }

    Ok(out)
}

fn fetch_tx_classifications_for_ids(
    conn: &Connection,
    txids: &[String],
) -> provenance_core::Result<HashMap<String, Classification>> {
    if txids.is_empty() {
        return Ok(HashMap::new());
    }

    let placeholders = vec!["?"; txids.len()].join(", ");
    let sql = format!(
        "SELECT ref_id, category, context, metadata, tax_relevant
         FROM classifications
         WHERE ref_type = 'tx' AND ref_id IN ({placeholders})"
    );
    let mut stmt = conn.prepare(&sql)?;
    let mut rows = stmt.query(params_from_iter(txids.iter()))?;

    let mut out = HashMap::new();
    while let Some(row) = rows.next()? {
        let ref_id: String = row.get(0)?;
        let category: String = row.get(1)?;
        let context: Option<String> = row.get(2)?;
        let metadata_raw: String = row.get(3)?;
        let tax_relevant: i64 = row.get(4)?;

        let metadata = serde_json::from_str(&metadata_raw).map_err(|e| {
            provenance_core::CoreError::Other(format!(
                "invalid classification metadata for '{ref_id}': {e}"
            ))
        })?;

        out.insert(
            ref_id,
            Classification {
                category,
                context: context.unwrap_or_default(),
                metadata,
                tax_relevant: tax_relevant != 0,
            },
        );
    }

    Ok(out)
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
