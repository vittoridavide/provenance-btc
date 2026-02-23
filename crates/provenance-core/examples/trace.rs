use bitcoin::Txid;

use provenance_core::provenance::trace::{
    trace_ancestry_cache_first, TraceOptions, TxHexCacheMetrics,
};
use provenance_core::rpc::client::{CoreRpc, RpcConfig};
use provenance_core::store::db::Database;
use provenance_core::store::tx_hex_cache::TxHexCache;

fn usage() -> ! {
    eprintln!(
        "Usage: cargo run -p provenance-core --example trace -- <txid> [--max-depth N] [--max-txs N] [--cache PATH]\n\n\
Env:\n\
  PROVENANCE_RPC_URL\n\
  (PROVENANCE_RPC_USER + PROVENANCE_RPC_PASS) or PROVENANCE_RPC_COOKIE\n\n\
Notes:\n\
  - If --cache is omitted, :memory: is used (no persistence between runs)."
    );
    std::process::exit(2)
}

fn parse_arg_value<T: std::str::FromStr>(args: &[String], i: &mut usize, name: &str) -> T {
    *i += 1;
    let v = args.get(*i).unwrap_or_else(|| {
        eprintln!("Missing value for {name}");
        usage();
    });

    v.parse::<T>().unwrap_or_else(|_| {
        eprintln!("Invalid value for {name}: {v}");
        usage();
    })
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 2 {
        usage();
    }

    let mut txid: Option<Txid> = None;
    let mut max_depth: usize = 10;
    let mut max_txs: usize = 10_000;
    let mut cache_path: Option<String> = std::env::var("PROVENANCE_CACHE_PATH").ok();

    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "-h" | "--help" => usage(),
            "--max-depth" => {
                max_depth = parse_arg_value(&args, &mut i, "--max-depth");
            }
            "--max-txs" => {
                max_txs = parse_arg_value(&args, &mut i, "--max-txs");
            }
            "--cache" => {
                cache_path = Some(parse_arg_value(&args, &mut i, "--cache"));
            }
            s if s.starts_with("-") => {
                eprintln!("Unknown flag: {s}");
                usage();
            }
            s => {
                if txid.is_some() {
                    eprintln!("Unexpected extra arg: {s}");
                    usage();
                }
                txid = Some(s.parse::<Txid>().unwrap_or_else(|e| {
                    eprintln!("Invalid txid: {e}");
                    usage();
                }));
            }
        }

        i += 1;
    }

    let txid = txid.unwrap_or_else(|| usage());
    let cache_path = cache_path.unwrap_or(":memory:".to_string());

    let cfg = match RpcConfig::from_env() {
        Ok(Some(cfg)) => cfg,
        Ok(None) => {
            eprintln!("Missing PROVENANCE_RPC_URL in env");
            std::process::exit(2)
        }
        Err(e) => {
            eprintln!("Invalid RPC env config: {e}");
            std::process::exit(2)
        }
    };

    let rpc = CoreRpc::new(&cfg).unwrap_or_else(|e| {
        eprintln!("Failed to init RPC client: {e}");
        std::process::exit(1)
    });

    let db = Database::open(&cache_path).unwrap_or_else(|e| {
        eprintln!("Failed to open database at {cache_path}: {e}");
        std::process::exit(1)
    });
    let cache = TxHexCache::new(db.conn());

    let mut metrics = TxHexCacheMetrics::default();
    let graph = trace_ancestry_cache_first(
        txid,
        TraceOptions::new(max_depth, max_txs),
        &cache,
        |t| rpc.get_raw_transaction_hex(t),
        Some(&mut metrics),
    )
    .unwrap_or_else(|e| {
        eprintln!("Trace failed: {e}");
        std::process::exit(1)
    });

    let list = graph
        .to_ancestry_list()
        .into_iter()
        .map(|e| {
            serde_json::json!({
                "depth": e.depth,
                "txid": e.txid.to_string(),
                "parents": e.parents.into_iter().map(|p| p.to_string()).collect::<Vec<_>>(),
            })
        })
        .collect::<Vec<_>>();

    println!(
        "{}",
        serde_json::to_string_pretty(&serde_json::json!({
            "root": graph.root.to_string(),
            "max_depth": max_depth,
            "max_txs": max_txs,
            "cache": cache_path,
            "cache_hits": metrics.hits,
            "cache_misses": metrics.misses,
            "ancestry": list,
        }))
        .expect("json should serialize")
    );
}
