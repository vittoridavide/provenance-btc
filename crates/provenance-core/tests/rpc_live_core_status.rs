use dotenv::dotenv;
use provenance_core::rpc::client::{CoreRpc, RpcConfig};

#[test]
fn live_core_status_smoke() {
    dotenv().ok();

    let cfg = match RpcConfig::from_env() {
        Ok(Some(cfg)) => cfg,
        Ok(None) => {
            eprintln!("Skipping: set PROVENANCE_RPC_URL to run live RPC tests");
            return;
        }
        Err(e) => {
            eprintln!("Skipping: invalid RPC env config: {e}");
            return;
        }
    };

    let rpc = CoreRpc::new(&cfg).expect("rpc client should init");
    let status = rpc.status().expect("status should work");

    assert!(!status.chain.is_empty());
}
