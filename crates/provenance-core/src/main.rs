use dotenv::dotenv;
use std::env;
mod error;
pub mod rpc;

fn main() {
    dotenv().ok();
    let rpc_url = env::var("PROVENANCE_RPC_URL").expect("PROVENANCE_RPC_URL not set");

    println!("URL: {}", rpc_url);

    println!("Hello, world!");
}
