use bitcoin::{Address, Network, ScriptBuf};

pub fn classify_script_type(spk: &bitcoin::ScriptBuf) -> Option<String> {
    if spk.is_p2pkh() {
        Some("p2pkh".into())
    } else if spk.is_p2sh() {
        Some("p2sh".into())
    } else if spk.is_p2wpkh() {
        Some("p2wpkh".into())
    } else if spk.is_p2wsh() {
        Some("p2wsh".into())
    } else if spk.is_p2tr() {
        Some("p2tr".into())
    } else {
        None
    }
}

pub fn network_from_chain(chain: &str) -> Option<Network> {
    match chain {
        "main" => Some(Network::Bitcoin),
        "test" => Some(Network::Testnet),
        "signet" => Some(Network::Signet),
        "regtest" => Some(Network::Regtest),
        _ => None,
    }
}

pub fn address_from_spk(spk: &ScriptBuf, network: Network) -> Option<String> {
    Address::from_script(spk.as_script(), network)
        .ok()
        .map(|a| a.to_string())
}
