use bitcoin::consensus::encode::deserialize;
use bitcoin::{Network, Transaction, Txid};

use crate::error::{CoreError, Result};
use crate::model::helpers::{address_from_spk, classify_script_type, network_from_chain};
use crate::model::tx_view::{
    calculate_fee_sat, calculate_feerate_sat_vb, TxInpView, TxOutView, TxView,
};
use crate::rpc::indexinfo::parse_indexinfo;
use crate::rpc::types::CoreStatus;

use reqwest::blocking::Client as HttpClient;
use reqwest::StatusCode;
use serde::{de::DeserializeOwned, Deserialize};
use std::{collections::HashMap, fs, sync::Arc, time::Duration};

#[derive(Debug, Deserialize)]
struct NetworkInfoPartial {
    pub subversion: String,
    pub version: u64,
    #[serde(default)]
    pub warnings: Option<WarningsField>,
}

#[derive(Debug, Deserialize)]
struct BlockchainInfoPartial {
    pub chain: String,
    pub blocks: u64,
    pub headers: u64,
    #[serde(rename = "verificationprogress")]
    pub verification_progress: f64,
    pub pruned: bool,
    #[serde(default)]
    pub warnings: Option<WarningsField>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum WarningsField {
    Str(String),
    List(Vec<String>),
}

impl WarningsField {
    fn into_string(self) -> String {
        match self {
            WarningsField::Str(s) => s,
            WarningsField::List(list) => list.join("; "),
        }
    }
}

#[derive(Debug, Clone)]
pub struct RpcConfig {
    pub url: String,
    pub auth: RpcAuth,
}

#[derive(Debug, Clone)]
pub enum RpcAuth {
    None,
    UserPass { username: String, password: String },
    CookieFile { path: String },
}

impl RpcConfig {
    /// Build a config from environment variables.
    ///
    /// Expected variables:
    /// - `PROVENANCE_RPC_URL`
    /// - Optional auth via (`PROVENANCE_RPC_USER` + `PROVENANCE_RPC_PASS`) or `PROVENANCE_RPC_COOKIE`
    ///
    /// Returns `Ok(None)` if `PROVENANCE_RPC_URL` is not set.
    pub fn from_env() -> Result<Option<Self>> {
        fn env(name: &str) -> Option<String> {
            std::env::var(name).ok().filter(|s| !s.trim().is_empty())
        }

        let url = match env("PROVENANCE_RPC_URL") {
            Some(v) => v,
            None => return Ok(None),
        };

        let auth = if let (Some(username), Some(password)) =
            (env("PROVENANCE_RPC_USER"), env("PROVENANCE_RPC_PASS"))
        {
            RpcAuth::UserPass { username, password }
        } else if let Some(path) = env("PROVENANCE_RPC_COOKIE") {
            RpcAuth::CookieFile { path }
        } else {
            RpcAuth::None
        };

        Ok(Some(Self { url, auth }))
    }

    pub fn basic_auth_credentials(&self) -> Result<Option<(String, String)>> {
        match &self.auth {
            RpcAuth::None => Ok(None),
            RpcAuth::UserPass { username, password } => {
                Ok(Some((username.to_string(), password.to_string())))
            }
            RpcAuth::CookieFile { path } => {
                let cookie = fs::read_to_string(path).map_err(|e| {
                    CoreError::Other(format!("Failed to read RPC cookie file '{path}': {e}"))
                })?;
                let cookie = cookie.trim();
                let mut split = cookie.splitn(2, ':');
                let username = split.next().unwrap_or_default().trim();
                let password = split.next().unwrap_or_default().trim();

                if username.is_empty() || password.is_empty() {
                    return Err(CoreError::Other(format!(
                        "RPC cookie file '{path}' must contain 'username:password'"
                    )));
                }

                Ok(Some((username.to_string(), password.to_string())))
            }
        }
    }
}

#[derive(Debug, Deserialize)]
struct JsonRpcResponse<T> {
    result: Option<T>,
    error: Option<JsonRpcError>,
}

#[derive(Debug, Deserialize)]
struct JsonRpcError {
    code: i64,
    message: String,
    #[serde(default)]
    data: Option<serde_json::Value>,
}

impl JsonRpcError {
    fn into_message(self) -> String {
        match self.data {
            Some(data) => format!("JSON-RPC error {}: {} ({data})", self.code, self.message),
            None => format!("JSON-RPC error {}: {}", self.code, self.message),
        }
    }
}

pub struct CoreRpc {
    client: HttpClient,
    url: String,
    auth_mode: &'static str,
    basic_auth: Option<(String, String)>,
}

impl CoreRpc {
    fn truncate_for_log(message: &str) -> String {
        const MAX_CHARS: usize = 512;
        let mut truncated = message.chars().take(MAX_CHARS).collect::<String>();
        if message.chars().count() > MAX_CHARS {
            truncated.push('…');
        }
        truncated
    }

    fn log_request(&self, method: &str, params: &serde_json::Value) {
        eprintln!(
            "[provenance-rpc] request method={method} url={} auth_mode={} params={}",
            self.url, self.auth_mode, params
        );
    }

    fn log_response_ok(&self, method: &str, http_status: StatusCode) {
        eprintln!(
            "[provenance-rpc] response method={method} url={} status=ok http_status={}",
            self.url, http_status
        );
    }

    fn log_response_err(&self, method: &str, http_status: Option<StatusCode>, err: &str) {
        match http_status {
            Some(status) => eprintln!(
                "[provenance-rpc] response method={method} url={} status=error http_status={} error={}",
                self.url, status, err
            ),
            None => eprintln!(
                "[provenance-rpc] response method={method} url={} status=error error={}",
                self.url, err
            ),
        }
    }

    fn call<T: DeserializeOwned>(&self, method: &str, params: serde_json::Value) -> Result<T> {
        self.log_request(method, &params);

        let body = serde_json::json!({
            "jsonrpc": "1.0",
            "id": "provenance",
            "method": method,
            "params": params,
        });

        let mut request = self.client.post(&self.url).json(&body);
        if let Some((username, password)) = &self.basic_auth {
            request = request.basic_auth(username, Some(password));
        }

        let response = request.send().map_err(|err| {
            let message = format!("transport error: {err}");
            self.log_response_err(method, None, &message);
            CoreError::Rpc(message)
        })?;

        let http_status = response.status();
        let text = response.text().map_err(|err| {
            let message = format!("failed to read response body: {err}");
            self.log_response_err(method, Some(http_status), &message);
            CoreError::Rpc(message)
        })?;

        let parsed = match serde_json::from_str::<JsonRpcResponse<T>>(&text) {
            Ok(parsed) => parsed,
            Err(parse_err) => {
                let body_preview = Self::truncate_for_log(&text);
                let message = if http_status.is_success() {
                    format!("invalid JSON-RPC response: {parse_err}; body={body_preview}")
                } else {
                    format!(
                        "transport error: unexpected HTTP code: {}; body={body_preview}",
                        http_status.as_u16()
                    )
                };
                self.log_response_err(method, Some(http_status), &message);
                return Err(CoreError::Rpc(message));
            }
        };

        if let Some(error) = parsed.error {
            let message = error.into_message();
            self.log_response_err(method, Some(http_status), &message);
            return Err(CoreError::Rpc(message));
        }

        if !http_status.is_success() {
            let message = format!(
                "transport error: unexpected HTTP code: {}",
                http_status.as_u16()
            );
            self.log_response_err(method, Some(http_status), &message);
            return Err(CoreError::Rpc(message));
        }

        let Some(result) = parsed.result else {
            let message = "RPC response missing result".to_string();
            self.log_response_err(method, Some(http_status), &message);
            return Err(CoreError::Rpc(message));
        };

        self.log_response_ok(method, http_status);
        Ok(result)
    }

    /// Fetch raw transaction hex (`getrawtransaction <txid> false`).
    pub fn get_raw_transaction_hex(&self, txid: &Txid) -> Result<String> {
        let params = serde_json::json!([txid, false]);
        self.call("getrawtransaction", params)
    }

    /// Same as [`CoreRpc::get_raw_transaction_hex`], but accepts a string txid.
    pub fn get_raw_transaction_hex_str(&self, txid: &str) -> Result<String> {
        let txid: Txid = txid
            .parse()
            .map_err(|e| CoreError::Other(format!("Invalid txid: {e}")))?;
        self.get_raw_transaction_hex(&txid)
    }

    fn fetch_tx_verbose(&self, txid: &Txid) -> Result<serde_json::Value> {
        let params = serde_json::json!([txid, true]);
        self.call("getrawtransaction", params)
    }

    fn tx_from_verbose_value(&self, v: &serde_json::Value) -> Result<Transaction> {
        let hex_str = v
            .get("hex")
            .and_then(|x| x.as_str())
            .ok_or_else(|| CoreError::Other("RPC response missing 'hex'".into()))?;

        let raw =
            hex::decode(hex_str).map_err(|e| CoreError::Other(format!("Invalid tx hex: {e}")))?;

        deserialize(&raw).map_err(|e| CoreError::Other(format!("Failed to parse tx: {e}")))
    }

    fn fetch_tx(&self, txid: &Txid) -> Result<Transaction> {
        let v = self.fetch_tx_verbose(txid)?;
        self.tx_from_verbose_value(&v)
    }

    fn current_network(&self) -> Result<Option<Network>> {
        let chain_v: serde_json::Value = self.call("getblockchaininfo", serde_json::json!([]))?;
        let chain = chain_v
            .get("chain")
            .and_then(|x| x.as_str())
            .unwrap_or("main");
        Ok(network_from_chain(chain))
    }

    fn block_header_meta(&self, blockhash: &str) -> Result<(Option<u32>, Option<u64>)> {
        let params = serde_json::json!([blockhash, true]);
        let hdr_v: serde_json::Value = self.call("getblockheader", params)?;

        let height = hdr_v
            .get("height")
            .and_then(|x| x.as_u64())
            .map(|n| n as u32);
        let time = hdr_v.get("time").and_then(|x| x.as_u64());
        Ok((height, time))
    }

    pub fn fetch_tx_view(&self, txid_str: &str) -> Result<TxView> {
        let mut tx_cache: HashMap<Txid, Arc<Transaction>> = HashMap::new();

        let txid: Txid = txid_str
            .parse()
            .map_err(|e| CoreError::Other(format!("Invalid txid: {e}")))?;

        let main_v = self.fetch_tx_verbose(&txid)?;
        let tx = Arc::new(self.tx_from_verbose_value(&main_v)?);
        tx_cache.insert(txid, Arc::clone(&tx));

        let mut get_tx = |txid: Txid| -> Result<Arc<Transaction>> {
            if let Some(tx) = tx_cache.get(&txid) {
                return Ok(Arc::clone(tx));
            }
            let prev = Arc::new(self.fetch_tx(&txid)?);
            tx_cache.insert(txid, Arc::clone(&prev));
            Ok(prev)
        };

        let network = self.current_network()?;

        let confirmations = main_v
            .get("confirmations")
            .and_then(|x| x.as_u64())
            .map(|n| n as u32);
        let blockhash = main_v
            .get("blockhash")
            .and_then(|x| x.as_str())
            .map(|s| s.to_string());

        let (block_height, block_time) = if let Some(ref bh) = blockhash {
            self.block_header_meta(bh)?
        } else {
            (None, None)
        };

        let weight: u64 = tx.weight().to_wu();
        let vsize: u64 = weight.div_ceil(4);

        let outputs = tx
            .output
            .iter()
            .enumerate()
            .map(|(i, o)| {
                let script_type = classify_script_type(&o.script_pubkey);
                let address = network.and_then(|net| address_from_spk(&o.script_pubkey, net));

                TxOutView {
                    vout: i as u32,
                    value_sat: o.value.to_sat(),
                    script_pubkey_hex: o.script_pubkey.to_hex_string(),
                    script_type,
                    address,
                }
            })
            .collect::<Vec<_>>();

        let mut inputs = Vec::<TxInpView>::with_capacity(tx.input.len());
        for (i, inp) in tx.input.iter().enumerate() {
            if inp.previous_output.is_null() {
                inputs.push(TxInpView {
                    vin: i as u32,
                    prev_txid: inp.previous_output.txid.to_string(),
                    prev_vout: inp.previous_output.vout,
                    value_sat: None,
                    script_pubkey_hex: String::new(),
                    script_type: None,
                    script_sig_hex: inp.script_sig.to_hex_string(),
                    witness_items_count: inp.witness.len(),
                    witness_hex: inp.witness.iter().map(hex::encode).collect(),
                    is_coinbase: true,
                });
                continue;
            }

            let prev_txid = inp.previous_output.txid;
            let vout = inp.previous_output.vout as usize;

            let (value_sat, script_pubkey_hex, script_type) = match get_tx(prev_txid) {
                Ok(prev_tx) => match prev_tx.output.get(vout) {
                    Some(prev_out) => (
                        Some(prev_out.value.to_sat()),
                        prev_out.script_pubkey.to_hex_string(),
                        classify_script_type(&prev_out.script_pubkey),
                    ),
                    None => (None, String::new(), None),
                },
                Err(_) => (None, String::new(), None),
            };

            inputs.push(TxInpView {
                vin: i as u32,
                prev_txid: prev_txid.to_string(),
                prev_vout: inp.previous_output.vout,
                value_sat,
                script_pubkey_hex,
                script_type,
                script_sig_hex: inp.script_sig.to_hex_string(),
                witness_items_count: inp.witness.len(),
                witness_hex: inp.witness.iter().map(hex::encode).collect(),
                is_coinbase: false,
            });
        }

        let is_coinbase = tx.is_coinbase();
        let fee_sat = calculate_fee_sat(is_coinbase, &inputs, &outputs);
        let feerate_sat_vb = calculate_feerate_sat_vb(fee_sat, vsize);

        Ok(TxView {
            txid: txid.to_string(),
            version: tx.version.0,
            lock_time: tx.lock_time.to_consensus_u32(),
            inputs_count: tx.input.len(),
            outputs,
            inputs,
            weight,
            vsize,
            is_coinbase,
            fee_sat,
            feerate_sat_vb,
            confirmations,
            blockhash,
            block_height,
            block_time,
        })
    }

    pub fn new(cfg: &RpcConfig) -> Result<Self> {
        if cfg.url.trim().is_empty() {
            return Err(CoreError::InvalidUrl("empty url".into()));
        }

        let client = HttpClient::builder()
            .timeout(Duration::from_secs(15))
            .build()
            .map_err(|e| CoreError::Other(format!("Failed to build RPC HTTP client: {e}")))?;
        let basic_auth = cfg.basic_auth_credentials()?;
        let auth_mode = match &cfg.auth {
            RpcAuth::None => "none",
            RpcAuth::UserPass { .. } => "userpass",
            RpcAuth::CookieFile { .. } => "cookie",
        };

        Ok(Self {
            client,
            url: cfg.url.clone(),
            auth_mode,
            basic_auth,
        })
    }

    pub fn status(&self) -> Result<CoreStatus> {
        let network: NetworkInfoPartial = self.call("getnetworkinfo", serde_json::json!([]))?;
        let chain: BlockchainInfoPartial = self.call("getblockchaininfo", serde_json::json!([]))?;

        let (txindex, coinstatsindex, blockfilterindex) =
            match self.call::<serde_json::Value>("getindexinfo", serde_json::json!([])) {
                Ok(v) => parse_indexinfo(&v),
                Err(_) => (None, None, None),
            };

        let warnings = network
            .warnings
            .or(chain.warnings)
            .map(|w| w.into_string())
            .unwrap_or_default();

        Ok(CoreStatus {
            subversion: network.subversion,
            version: network.version as i64,
            chain: chain.chain,
            blocks: chain.blocks,
            headers: chain.headers,
            verification_progress: chain.verification_progress,
            pruned: chain.pruned,
            txindex,
            coinstatsindex,
            blockfilterindex,
            warnings,
        })
    }
}
