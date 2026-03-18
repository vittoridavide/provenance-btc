use std::str::FromStr;

use bitcoin::address::{Address, NetworkUnchecked};

use crate::error::{CoreError, Result};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum InputTarget {
    Txid(String),
    Outpoint { txid: String, vout: u32 },
    Address(String),
}

pub fn parse_input_target(raw: &str) -> Result<InputTarget> {
    let normalized = raw.trim();
    if normalized.is_empty() {
        return Err(invalid_input("input is empty"));
    }

    if let Some((txid_raw, vout_raw)) = normalized.split_once(':') {
        if vout_raw.is_empty() || vout_raw.contains(':') {
            return Err(invalid_input(format!(
                "invalid outpoint format '{normalized}', expected <txid>:<u32>"
            )));
        }

        let txid = normalize_txid(txid_raw)?;
        let vout = vout_raw.parse::<u32>().map_err(|_| {
            invalid_input(format!(
                "invalid outpoint vout '{vout_raw}', expected unsigned 32-bit integer"
            ))
        })?;

        return Ok(InputTarget::Outpoint { txid, vout });
    }

    if is_txid(normalized) {
        return Ok(InputTarget::Txid(normalized.to_ascii_lowercase()));
    }

    if is_valid_address(normalized) {
        return Ok(InputTarget::Address(normalized.to_owned()));
    }

    Err(invalid_input(format!(
        "unsupported input '{normalized}', expected txid, <txid>:<u32>, or bitcoin address"
    )))
}

fn normalize_txid(txid: &str) -> Result<String> {
    if !is_txid(txid) {
        return Err(invalid_input(format!(
            "invalid txid '{txid}', expected 64-char hex"
        )));
    }
    Ok(txid.to_ascii_lowercase())
}

fn is_txid(value: &str) -> bool {
    value.len() == 64 && value.chars().all(|c| c.is_ascii_hexdigit())
}

fn is_valid_address(value: &str) -> bool {
    Address::<NetworkUnchecked>::from_str(value).is_ok()
}

fn invalid_input(message: impl Into<String>) -> CoreError {
    CoreError::Other(format!("invalid input target: {}", message.into()))
}

#[cfg(test)]
mod tests {
    use super::{parse_input_target, InputTarget};

    const TXID_LOWER: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const TXID_UPPER: &str = "0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF";
    const ADDRESS: &str = "1BoatSLRHtKNngkdXEeobR76b53LETtpyT";

    #[test]
    fn parses_txid_and_normalizes_hex_case() {
        let parsed = parse_input_target(TXID_UPPER).expect("txid should parse");
        assert_eq!(parsed, InputTarget::Txid(TXID_LOWER.to_string()));
    }

    #[test]
    fn parses_outpoint_and_normalizes_txid() {
        let parsed = parse_input_target(&format!("{TXID_UPPER}:2")).expect("outpoint should parse");
        assert_eq!(
            parsed,
            InputTarget::Outpoint {
                txid: TXID_LOWER.to_string(),
                vout: 2
            }
        );
    }

    #[test]
    fn parses_address() {
        let parsed = parse_input_target(ADDRESS).expect("address should parse");
        assert_eq!(parsed, InputTarget::Address(ADDRESS.to_string()));
    }

    #[test]
    fn rejects_empty_input() {
        let err = parse_input_target("   ").expect_err("empty input should fail");
        assert!(
            err.to_string().contains("input is empty"),
            "unexpected error: {err}"
        );
    }

    #[test]
    fn rejects_invalid_txid() {
        let err = parse_input_target("abcd").expect_err("short txid should fail");
        assert!(
            err.to_string().contains("unsupported input"),
            "unexpected error: {err}"
        );
    }

    #[test]
    fn rejects_invalid_outpoint_format() {
        let err = parse_input_target(&format!("{TXID_LOWER}:1:2"))
            .expect_err("extra separator should fail");
        assert!(
            err.to_string().contains("invalid outpoint format"),
            "unexpected error: {err}"
        );
    }

    #[test]
    fn rejects_invalid_outpoint_vout() {
        let err = parse_input_target(&format!("{TXID_LOWER}:abc"))
            .expect_err("non-numeric vout should fail");
        assert!(
            err.to_string().contains("invalid outpoint vout"),
            "unexpected error: {err}"
        );
    }

    #[test]
    fn rejects_invalid_address() {
        let err = parse_input_target("not-an-address").expect_err("invalid address should fail");
        assert!(
            err.to_string().contains("unsupported input"),
            "unexpected error: {err}"
        );
    }
}
