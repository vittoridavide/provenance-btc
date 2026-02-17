// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use provenance_core::rpc::client::{CoreRpc, RpcAuth, RpcConfig};
use provenance_core::rpc::types::CoreStatus;
use std::sync::{Arc, RwLock};

#[derive(Clone)]
struct AppState {
    rpc_config: Arc<RwLock<Option<RpcConfig>>>,
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

    // Validate immediately
    CoreRpc::new(&cfg).map_err(|e| e.to_string())?;

    *state.rpc_config.write().unwrap() = Some(cfg);
    Ok(())
}

#[tauri::command]
async fn cmd_core_status(state: tauri::State<'_, AppState>) -> Result<CoreStatus, String> {
    let cfg = state
        .rpc_config
        .read()
        .unwrap()
        .clone()
        .ok_or("RPC not configured")?;

    tauri::async_runtime::spawn_blocking(move || {
        let rpc = CoreRpc::new(&cfg).map_err(|e| e.to_string())?;
        rpc.status().map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

fn main() {
    let state = AppState {
        rpc_config: Arc::new(RwLock::new(None)),
    };

    tauri::Builder::default()
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            cmd_set_rpc_config,
            cmd_core_status
        ])
        .run(tauri::generate_context!())
        .expect("error running Tauri");
}
