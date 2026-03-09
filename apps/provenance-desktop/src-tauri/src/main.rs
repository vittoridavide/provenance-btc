// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use provenance_core::api::types::{
    Bip329ExportResult, Bip329ImportApplyRequest, Bip329ImportApplyResult,
    Bip329ImportConflictPolicy, Bip329ImportPreviewRequest, Bip329ImportPreviewResponse,
    Classification, GraphBuildOptions, ProvenanceGraph, RefType, ReportExportRequest,
    ReportManifest, ReportPreviewRequest, ReportPreviewResponse, ReportWarning, TransactionDetail,
    TxInput, TxOutput,
};
use provenance_core::api::{
    apply_bip329_import as core_apply_bip329_import, export_bip329 as core_export_bip329,
    export_report as core_export_report, preview_bip329_import as core_preview_bip329_import,
    preview_report as core_preview_report,
};

use provenance_core::model::tx_view::TxView;
use provenance_core::reporting::{build_graph_export_context, GraphExportContextRequest};
use provenance_core::rpc::client::{CoreRpc, RpcAuth, RpcConfig};
use provenance_core::rpc::types::CoreStatus;
use provenance_core::store::classifications;
use provenance_core::store::db::Database;
use provenance_core::store::labels;
use std::env;
use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};
use tauri::Manager;

const RPC_PREFILL_SCHEMA_VERSION: u32 = 1;
const RPC_PREFILL_FILE_NAME: &str = "rpc_config_prefill.json";

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetRpcConfigArgs {
    url: String,
    auth_mode: Option<RpcAuthMode>,
    username: Option<String>,
    password: Option<String>,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "lowercase")]
enum RpcAuthMode {
    None,
    UserPass,
}
impl RpcAuthMode {
    fn as_storage_str(self) -> &'static str {
        match self {
            RpcAuthMode::None => "none",
            RpcAuthMode::UserPass => "userpass",
        }
    }

    fn from_storage_str(value: Option<&str>) -> Self {
        match value.map(|v| v.trim().to_ascii_lowercase()) {
            Some(mode) if mode == "userpass" => RpcAuthMode::UserPass,
            _ => RpcAuthMode::None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct RpcConfigPrefill {
    schema_version: u32,
    url: String,
    auth_mode: RpcAuthMode,
    username: Option<String>,
}

impl Default for RpcConfigPrefill {
    fn default() -> Self {
        Self {
            schema_version: RPC_PREFILL_SCHEMA_VERSION,
            url: String::new(),
            auth_mode: RpcAuthMode::None,
            username: None,
        }
    }
}

impl RpcConfigPrefill {
    fn from_rpc_config(cfg: &RpcConfig) -> Self {
        match &cfg.auth {
            RpcAuth::None | RpcAuth::CookieFile { .. } => Self {
                schema_version: RPC_PREFILL_SCHEMA_VERSION,
                url: cfg.url.clone(),
                auth_mode: RpcAuthMode::None,
                username: None,
            },
            RpcAuth::UserPass { username, .. } => Self {
                schema_version: RPC_PREFILL_SCHEMA_VERSION,
                url: cfg.url.clone(),
                auth_mode: RpcAuthMode::UserPass,
                username: Some(username.clone()),
            },
        }
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredRpcConfigPrefill {
    #[serde(default = "default_rpc_prefill_schema_version")]
    schema_version: u32,
    #[serde(default)]
    url: String,
    #[serde(default)]
    auth_mode: Option<String>,
    #[serde(default)]
    username: Option<String>,
}

fn default_rpc_prefill_schema_version() -> u32 {
    RPC_PREFILL_SCHEMA_VERSION
}

impl From<&RpcConfigPrefill> for StoredRpcConfigPrefill {
    fn from(value: &RpcConfigPrefill) -> Self {
        Self {
            schema_version: value.schema_version,
            url: value.url.clone(),
            auth_mode: Some(value.auth_mode.as_storage_str().to_string()),
            username: normalize_optional_non_empty(value.username.clone()),
        }
    }
}

impl StoredRpcConfigPrefill {
    fn into_runtime_prefill(self) -> RpcConfigPrefill {
        RpcConfigPrefill {
            schema_version: self.schema_version,
            url: self.url,
            auth_mode: RpcAuthMode::from_storage_str(self.auth_mode.as_deref()),
            username: normalize_optional_non_empty(self.username),
        }
    }
}

fn normalize_optional_non_empty(value: Option<String>) -> Option<String> {
    value.and_then(|v| if v.trim().is_empty() { None } else { Some(v) })
}

fn parse_rpc_auth(
    auth_mode: Option<RpcAuthMode>,
    username: Option<String>,
    password: Option<String>,
) -> Result<RpcAuth, String> {
    let username = normalize_optional_non_empty(username);
    let password = normalize_optional_non_empty(password);

    let mode = auth_mode.or_else(|| {
        if username.is_some() || password.is_some() {
            Some(RpcAuthMode::UserPass)
        } else {
            None
        }
    });

    match mode {
        Some(RpcAuthMode::None) => {
            if username.is_some() || password.is_some() {
                return Err(
                    "RPC auth mode 'none' does not accept username/password. Remove credentials or use authMode 'userpass'."
                        .into(),
                );
            }
            Ok(RpcAuth::None)
        }
        Some(RpcAuthMode::UserPass) => match (username, password) {
            (Some(username), Some(password)) => Ok(RpcAuth::UserPass { username, password }),
            (None, None) => {
                Err("RPC auth mode 'userpass' requires both username and password.".into())
            }
            (None, Some(_)) => Err("RPC auth mode 'userpass' is missing username.".into()),
            (Some(_), None) => Err("RPC auth mode 'userpass' is missing password.".into()),
        },
        None => Err(
            "RPC auth mode is required. Set authMode to 'none' for unauthenticated RPC, or 'userpass' with username/password."
                .into(),
        ),
    }
}

#[derive(Clone)]
struct AppState {
    rpc_config: Arc<RwLock<Option<RpcConfig>>>,
    db_path: Arc<String>,
    rpc_prefill_path: Arc<PathBuf>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExportLabelsArgs {
    output_path: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportLabelsArgs {
    input_path: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApplyLabelsImportArgs {
    input_path: String,
    policy: Bip329ImportConflictPolicy,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExportReportArgs {
    request: ReportExportRequest,
    output_path: String,
}

#[derive(Debug, serde::Serialize)]
struct ReportFileExportResult {
    output_path: String,
    manifest: ReportManifest,
    warnings: Vec<ReportWarning>,
}

#[tauri::command]
fn cmd_set_rpc_config(
    state: tauri::State<'_, AppState>,
    args: SetRpcConfigArgs,
) -> Result<(), String> {
    let auth = parse_rpc_auth(args.auth_mode, args.username, args.password)?;

    let cfg = RpcConfig {
        url: args.url,
        auth,
    };
    // Validate RPC immediately.
    CoreRpc::new(&cfg).map_err(|e| e.to_string())?;
    let prefill = RpcConfigPrefill::from_rpc_config(&cfg);
    save_rpc_config_prefill(state.rpc_prefill_path.as_ref().as_path(), &prefill)?;

    *state.rpc_config.write().unwrap() = Some(cfg);
    Ok(())
}

#[tauri::command]
fn cmd_get_rpc_config_prefill(
    state: tauri::State<'_, AppState>,
) -> Result<RpcConfigPrefill, String> {
    load_rpc_config_prefill(state.rpc_prefill_path.as_ref().as_path())
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

fn read_text_file(path: &str, purpose: &str) -> Result<String, String> {
    fs::read_to_string(path).map_err(|e| format!("Failed to read {purpose} file '{path}': {e}"))
}

fn write_text_file(path: &str, contents: &str, purpose: &str) -> Result<(), String> {
    fs::write(path, contents).map_err(|e| format!("Failed to write {purpose} to '{path}': {e}"))
}

fn save_rpc_config_prefill(path: &Path, prefill: &RpcConfigPrefill) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| {
            format!(
                "Failed to create RPC prefill directory '{}': {e}",
                parent.display()
            )
        })?;
    }

    let stored_prefill = StoredRpcConfigPrefill::from(prefill);
    let serialized = serde_json::to_string_pretty(&stored_prefill).map_err(|e| {
        format!(
            "Failed to serialize RPC prefill data for '{}': {e}",
            path.display()
        )
    })?;

    fs::write(path, serialized)
        .map_err(|e| format!("Failed to write RPC prefill file '{}': {e}", path.display()))
}

fn load_rpc_config_prefill(path: &Path) -> Result<RpcConfigPrefill, String> {
    match fs::read_to_string(path) {
        Ok(contents) => {
            let stored_prefill: StoredRpcConfigPrefill =
                serde_json::from_str(&contents).map_err(|e| {
                    format!("Failed to parse RPC prefill file '{}': {e}", path.display())
                })?;
            Ok(stored_prefill.into_runtime_prefill())
        }
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(RpcConfigPrefill::default()),
        Err(e) => Err(format!(
            "Failed to read RPC prefill file '{}': {e}",
            path.display()
        )),
    }
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
async fn cmd_preview_labels_export(
    state: tauri::State<'_, AppState>,
) -> Result<Bip329ExportResult, String> {
    let db_path = (*state.db_path).clone();
    tauri::async_runtime::spawn_blocking(move || {
        let db = open_db(&db_path)?;
        core_export_bip329(db.conn()).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn cmd_export_labels(
    state: tauri::State<'_, AppState>,
    args: ExportLabelsArgs,
) -> Result<String, String> {
    let db_path = (*state.db_path).clone();
    let output_path = args.output_path;
    tauri::async_runtime::spawn_blocking(move || {
        let db = open_db(&db_path)?;
        let export = core_export_bip329(db.conn()).map_err(|e| e.to_string())?;
        write_text_file(&output_path, &export.jsonl_contents, "labels export")?;
        Ok(output_path)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn cmd_preview_labels_import(
    state: tauri::State<'_, AppState>,
    args: ImportLabelsArgs,
) -> Result<Bip329ImportPreviewResponse, String> {
    let db_path = (*state.db_path).clone();
    let input_path = args.input_path;
    tauri::async_runtime::spawn_blocking(move || {
        let db = open_db(&db_path)?;
        let jsonl = read_text_file(&input_path, "labels import")?;
        let request = Bip329ImportPreviewRequest {
            jsonl_contents: jsonl,
        };
        core_preview_bip329_import(db.conn(), &request).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn cmd_apply_labels_import(
    state: tauri::State<'_, AppState>,
    args: ApplyLabelsImportArgs,
) -> Result<Bip329ImportApplyResult, String> {
    let db_path = (*state.db_path).clone();
    let input_path = args.input_path;
    let policy = args.policy;
    tauri::async_runtime::spawn_blocking(move || {
        let db = open_db(&db_path)?;
        let jsonl = read_text_file(&input_path, "labels import")?;
        let request = Bip329ImportApplyRequest {
            jsonl_contents: jsonl,
            policy,
        };
        core_apply_bip329_import(db.conn(), &request).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn cmd_preview_report(
    state: tauri::State<'_, AppState>,
    args: ReportPreviewRequest,
) -> Result<ReportPreviewResponse, String> {
    let cfg = get_rpc_config(&state)?;
    let db_path = (*state.db_path).clone();

    tauri::async_runtime::spawn_blocking(move || {
        let rpc = CoreRpc::new(&cfg).map_err(|e| e.to_string())?;
        let db = open_db(&db_path)?;
        core_preview_report(&rpc, db.conn(), &args).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn cmd_export_report(
    state: tauri::State<'_, AppState>,
    args: ExportReportArgs,
) -> Result<ReportFileExportResult, String> {
    let cfg = get_rpc_config(&state)?;
    let db_path = (*state.db_path).clone();
    let request = args.request;
    let output_path = args.output_path;

    tauri::async_runtime::spawn_blocking(move || {
        let rpc = CoreRpc::new(&cfg).map_err(|e| e.to_string())?;
        let db = open_db(&db_path)?;
        let generated = core_export_report(&rpc, db.conn(), &request).map_err(|e| e.to_string())?;
        write_text_file(&output_path, &generated.csv_contents, "report export")?;

        Ok(ReportFileExportResult {
            output_path,
            manifest: generated.manifest,
            warnings: generated.warnings,
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
    let rpc_config = Arc::new(RwLock::new(None));
    let db_path = Arc::new(db_path);

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup({
            let rpc_config = Arc::clone(&rpc_config);
            let db_path = Arc::clone(&db_path);
            move |app| {
                let app_config_dir = app.path().app_config_dir().map_err(|e| {
                    std::io::Error::other(format!(
                        "Failed to resolve app config directory for RPC prefill: {e}"
                    ))
                })?;
                let state = AppState {
                    rpc_config: Arc::clone(&rpc_config),
                    db_path: Arc::clone(&db_path),
                    rpc_prefill_path: Arc::new(app_config_dir.join(RPC_PREFILL_FILE_NAME)),
                };
                app.manage(state);
                Ok(())
            }
        })
        .invoke_handler(tauri::generate_handler![
            cmd_set_rpc_config,
            cmd_get_rpc_config_prefill,
            cmd_core_status,
            cmd_fetch_tx,
            cmd_build_graph,
            cmd_get_tx_detail,
            cmd_set_label,
            cmd_delete_label,
            cmd_set_classification,
            cmd_delete_classification,
            cmd_preview_labels_export,
            cmd_export_labels,
            cmd_preview_labels_import,
            cmd_apply_labels_import,
            cmd_preview_report,
            cmd_export_report,
            cmd_export_graph_json
        ])
        .run(tauri::generate_context!())
        .expect("error running Tauri");
}

#[cfg(test)]
mod tests {
    use super::{
        load_rpc_config_prefill, parse_rpc_auth, read_text_file, save_rpc_config_prefill,
        write_text_file, RpcAuthMode, RpcConfigPrefill,
    };
    use provenance_core::rpc::client::RpcAuth;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_temp_path(file_name: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time before epoch")
            .as_nanos();
        let mut path = std::env::temp_dir();
        path.push(format!("provenance-desktop-tests-{nanos}"));
        path.push(file_name);
        path
    }

    #[test]
    fn read_text_file_reports_path_and_purpose_on_failure() {
        let missing_path = unique_temp_path("missing.jsonl");
        let missing_path_string = missing_path.to_string_lossy().to_string();

        let error = read_text_file(&missing_path_string, "labels import").expect_err("read fails");

        assert!(error.contains("Failed to read labels import file"));
        assert!(error.contains(&missing_path_string));
    }

    #[test]
    fn write_text_file_round_trips_contents() {
        let output_path = unique_temp_path("round-trip.csv");
        let output_dir = output_path
            .parent()
            .expect("temp output path has parent")
            .to_path_buf();
        fs::create_dir_all(&output_dir).expect("create temp test dir");
        let output_path_string = output_path.to_string_lossy().to_string();

        write_text_file(&output_path_string, "txid\nabc\n", "report export")
            .expect("write succeeds");
        let contents =
            fs::read_to_string(&output_path).expect("written file should be readable afterwards");

        assert_eq!(contents, "txid\nabc\n");

        fs::remove_file(&output_path).expect("cleanup file");
        fs::remove_dir_all(&output_dir).expect("cleanup directory");
    }

    #[test]
    fn parse_rpc_auth_accepts_none_mode_without_credentials() {
        let auth = parse_rpc_auth(Some(RpcAuthMode::None), None, None)
            .expect("none mode should not require credentials");
        assert!(matches!(auth, RpcAuth::None));
    }

    #[test]
    fn parse_rpc_auth_rejects_credentials_in_none_mode() {
        let err = parse_rpc_auth(
            Some(RpcAuthMode::None),
            Some("alice".to_string()),
            Some("secret".to_string()),
        )
        .expect_err("none mode should reject credentials");

        assert!(err.contains("mode 'none'"));
        assert!(err.contains("does not accept username/password"));
    }

    #[test]
    fn parse_rpc_auth_requires_mode_specific_userpass_fields() {
        let err = parse_rpc_auth(Some(RpcAuthMode::UserPass), Some("alice".to_string()), None)
            .expect_err("userpass mode should require password");

        assert!(err.contains("mode 'userpass'"));
        assert!(err.contains("missing password"));
    }

    #[test]
    fn parse_rpc_auth_keeps_existing_userpass_flow_when_mode_is_omitted() {
        let auth = parse_rpc_auth(None, Some("alice".to_string()), Some("secret".to_string()))
            .expect("credentials without mode should still resolve to userpass");

        match auth {
            RpcAuth::UserPass { username, password } => {
                assert_eq!(username, "alice");
                assert_eq!(password, "secret");
            }
            _ => panic!("expected userpass auth"),
        }
    }

    #[test]
    fn rpc_prefill_save_and_load_round_trip_excludes_password_field() {
        let prefill_path = unique_temp_path("rpc-prefill.json");
        let prefill_dir = prefill_path
            .parent()
            .expect("prefill path has parent")
            .to_path_buf();
        fs::create_dir_all(&prefill_dir).expect("create temp prefill dir");
        let prefill = RpcConfigPrefill {
            schema_version: 1,
            url: "http://127.0.0.1:8332".to_string(),
            auth_mode: RpcAuthMode::UserPass,
            username: Some("alice".to_string()),
        };

        save_rpc_config_prefill(&prefill_path, &prefill).expect("save prefill should succeed");
        let loaded = load_rpc_config_prefill(&prefill_path).expect("load prefill should succeed");

        assert_eq!(loaded, prefill);
        let raw_file = fs::read_to_string(&prefill_path).expect("prefill file should be readable");
        assert!(!raw_file.contains("password"));

        fs::remove_file(&prefill_path).expect("cleanup prefill file");
        fs::remove_dir_all(&prefill_dir).expect("cleanup prefill directory");
    }

    #[test]
    fn rpc_prefill_load_returns_default_when_file_is_missing() {
        let missing_prefill_path = unique_temp_path("missing-prefill.json");

        let loaded = load_rpc_config_prefill(&missing_prefill_path)
            .expect("missing prefill should return default payload");

        assert_eq!(loaded, RpcConfigPrefill::default());
    }
}
