use bitcoin::consensus::encode::deserialize;
use bitcoin::{Network, Transaction, Txid};

use crate::model::helpers::{address_from_spk, classify_script_type, network_from_chain};
use crate::model::tx_view::{TxInpView, TxOutView, TxView};

use std::{collections::HashMap, sync::Arc};

use crate::error::{CoreError, Result};
use crate::rpc::indexinfo::parse_indexinfo;
use crate::rpc::types::CoreStatus;
use bitcoincore_rpc::{Auth, Client, RpcApi};
use serde::Deserialize;

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
    pub url: String, // e.g. "http://127.0.0.1:8332"
    pub auth: RpcAuth,
}

#[derive(Debug, Clone)]
pub enum RpcAuth {
    UserPass { username: String, password: String },
    CookieFile { path: String },
}

impl RpcConfig {
    /// Build a config from environment variables.
    ///
    /// Expected variables:
    /// - `PROVENANCE_RPC_URL`
    /// - Either (`PROVENANCE_RPC_USER` + `PROVENANCE_RPC_PASS`) or `PROVENANCE_RPC_COOKIE`
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
            return Err(CoreError::MissingAuth);
        };

        Ok(Some(Self { url, auth }))
    }

    pub fn to_auth(&self) -> Result<Auth> {
        match &self.auth {
            RpcAuth::UserPass { username, password } => {
                Ok(Auth::UserPass(username.to_string(), password.to_string()))
            }
            RpcAuth::CookieFile { path } => Ok(Auth::CookieFile(path.into())),
        }
    }
}

pub struct CoreRpc {
    client: Client,
}

impl CoreRpc {
    /// Fetch raw transaction hex (`getrawtransaction <txid> false`).
    pub fn get_raw_transaction_hex(&self, txid: &Txid) -> Result<String> {
        let params = serde_json::json!([txid, false]);
        self.client
            .call("getrawtransaction", params.as_array().unwrap())
            .map_err(crate::error::CoreError::Rpc)
    }

    /// Same as [`CoreRpc::get_raw_transaction_hex`], but accepts a string txid.
    pub fn get_raw_transaction_hex_str(&self, txid: &str) -> Result<String> {
        let txid: Txid = txid
            .parse()
            .map_err(|e| crate::error::CoreError::Other(format!("Invalid txid: {e}")))?;
        self.get_raw_transaction_hex(&txid)
    }

    fn fetch_tx_verbose(&self, txid: &Txid) -> Result<serde_json::Value> {
        let params = serde_json::json!([txid, true]);
        self.client
            .call("getrawtransaction", params.as_array().unwrap())
            .map_err(crate::error::CoreError::Rpc)
    }

    fn tx_from_verbose_value(&self, v: &serde_json::Value) -> Result<Transaction> {
        let hex_str = v
            .get("hex")
            .and_then(|x| x.as_str())
            .ok_or_else(|| crate::error::CoreError::Other("RPC response missing 'hex'".into()))?;

        let raw = hex::decode(hex_str)
            .map_err(|e| crate::error::CoreError::Other(format!("Invalid tx hex: {e}")))?;

        deserialize(&raw)
            .map_err(|e| crate::error::CoreError::Other(format!("Failed to parse tx: {e}")))
    }

    fn fetch_tx(&self, txid: &Txid) -> Result<Transaction> {
        let v = self.fetch_tx_verbose(txid)?;
        self.tx_from_verbose_value(&v)
    }

    fn current_network(&self) -> Result<Option<Network>> {
        let chain_v: serde_json::Value = self.client.call("getblockchaininfo", &[])?;
        let chain = chain_v
            .get("chain")
            .and_then(|x| x.as_str())
            .unwrap_or("main");
        Ok(network_from_chain(chain))
    }

    fn block_header_meta(&self, blockhash: &str) -> Result<(Option<u32>, Option<u64>)> {
        // getblockheader <hash> true
        let params = serde_json::json!([blockhash, true]);
        let hdr_v: serde_json::Value = self
            .client
            .call("getblockheader", params.as_array().unwrap())
            .map_err(crate::error::CoreError::Rpc)?;

        let height = hdr_v
            .get("height")
            .and_then(|x| x.as_u64())
            .map(|n| n as u32);
        let time = hdr_v.get("time").and_then(|x| x.as_u64());
        Ok((height, time))
    }

    pub fn fetch_tx_view(&self, txid_str: &str) -> crate::error::Result<TxView> {
        let mut tx_cache: HashMap<Txid, Arc<Transaction>> = HashMap::new();

        // Validate txid format early (better error messages)
        let txid: Txid = txid_str
            .parse()
            .map_err(|e| crate::error::CoreError::Other(format!("Invalid txid: {e}")))?;

        // Fetch verbose once for the *main* tx so we can also read confirmation/block metadata.
        let main_v = self.fetch_tx_verbose(&txid)?;
        let tx = Arc::new(self.tx_from_verbose_value(&main_v)?);
        tx_cache.insert(txid, Arc::clone(&tx));

        // Helper for fetching *previous* transactions (cached). Defined after inserting the main tx
        // so we don't fight the borrow checker.
        let mut get_tx = |txid: Txid| -> Result<Arc<Transaction>> {
            if let Some(tx) = tx_cache.get(&txid) {
                return Ok(Arc::clone(tx));
            }
            let prev = Arc::new(self.fetch_tx(&txid)?);
            tx_cache.insert(txid, Arc::clone(&prev));
            Ok(prev)
        };

        let network = self.current_network()?;

        // Confirmation metadata
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

        // weight/vsize
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

        let inputs = tx
            .input
            .iter()
            .enumerate()
            .map(|(i, inp)| {
                let prev_txid = inp.previous_output.txid;
                let vout = inp.previous_output.vout as usize;

                // fetch prev tx (cached)
                let prev_tx = get_tx(prev_txid)?;

                let prev_out = prev_tx.output.get(vout).ok_or_else(|| {
                    crate::error::CoreError::Other(format!(
                        "Prevout vout={} not found in tx {}",
                        vout, prev_txid
                    ))
                })?;

                Ok(TxInpView {
                    vin: i as u32,
                    prev_txid: prev_txid.to_string(),
                    prev_vout: inp.previous_output.vout,
                    value_sat: prev_out.value.to_sat(), // bitcoin crate Amount => sats
                    script_pubkey_hex: prev_out.script_pubkey.to_hex_string(),
                    script_type: classify_script_type(&prev_out.script_pubkey),
                    script_sig_hex: inp.script_sig.to_hex_string(),
                    witness_items_count: inp.witness.len(),
                    witness_hex: inp.witness.iter().map(hex::encode).collect(),
                })
            })
            .collect::<Result<Vec<_>>>()?;

        Ok(TxView {
            txid: txid.to_string(),
            version: tx.version.0,
            lock_time: tx.lock_time.to_consensus_u32(),
            inputs_count: tx.input.len(),
            outputs,
            inputs,
            weight,
            vsize,
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
        let auth = cfg.to_auth()?;
        let client = Client::new(&cfg.url, auth)?;
        Ok(Self { client })
    }

    pub fn status(&self) -> Result<CoreStatus> {
        let network: NetworkInfoPartial = self.client.call("getnetworkinfo", &[])?;
        let chain: BlockchainInfoPartial = self.client.call("getblockchaininfo", &[])?;

        // Index info optional
        let (txindex, coinstatsindex, blockfilterindex) =
            match self.client.call::<serde_json::Value>("getindexinfo", &[]) {
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
