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
