use dotenv::dotenv;
use provenance_core::rpc::client::{CoreRpc, RpcAuth, RpcConfig};

fn env(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|s| !s.trim().is_empty())
}

#[test]
fn live_core_status_smoke() {
    dotenv().ok();

    let url = match env("PROVENANCE_RPC_URL") {
        Some(v) => v,
        None => {
            eprintln!("Skipping: set PROVENANCE_RPC_URL to run live RPC tests");
            return;
        }
    };

    let auth = if let (Some(user), Some(pass)) =
        (env("PROVENANCE_RPC_USER"), env("PROVENANCE_RPC_PASS"))
    {
        RpcAuth::UserPass {
            username: user,
            password: pass,
        }
    } else if let Some(cookie) = env("PROVENANCE_RPC_COOKIE") {
        RpcAuth::CookieFile { path: cookie }
    } else {
        eprintln!("Skipping: set PROVENANCE_RPC_USER+PROVENANCE_RPC_PASS or PROVENANCE_RPC_COOKIE");
        return;
    };

    let cfg = RpcConfig { url, auth };
    let rpc = CoreRpc::new(&cfg).expect("rpc client should init");
    let status = rpc.status().expect("status should work");

    assert!(!status.chain.is_empty());
}
