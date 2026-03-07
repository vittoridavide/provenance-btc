use std::str::FromStr;

use bitcoin::address::{Address, NetworkUnchecked};
use bitcoin::bip32::Xpub;
use bitcoin::{PublicKey, XOnlyPublicKey};
use thiserror::Error;

use super::StandardRecordType;

#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum ValidationError {
    #[error("unsupported record type: {0}")]
    UnsupportedType(String),
    #[error("invalid txid ref: {0}")]
    InvalidTxid(String),
    #[error("invalid output ref format: {0}")]
    InvalidOutputRef(String),
    #[error("invalid output vout: {0}")]
    InvalidVout(String),
    #[error("invalid input ref format: {0}")]
    InvalidInputRef(String),
    #[error("invalid input index: {0}")]
    InvalidInputIndex(String),
    #[error("invalid address ref: {0}")]
    InvalidAddress(String),
    #[error("invalid public key ref: {0}")]
    InvalidPubkey(String),
    #[error("invalid xpub ref: {0}")]
    InvalidXpub(String),
    #[error("spendable is only valid for output records")]
    InvalidSpendableUsage,
}

pub fn is_supported_type(t: &str) -> bool {
    StandardRecordType::parse(t).is_some()
}

pub fn validate_ref(t: &str, r: &str) -> std::result::Result<(), ValidationError> {
    match StandardRecordType::parse(t) {
        Some(StandardRecordType::Tx) => validate_tx_ref(r),
        Some(StandardRecordType::Addr) => validate_address_ref(r),
        Some(StandardRecordType::Pubkey) => validate_pubkey_ref(r),
        Some(StandardRecordType::Input) => validate_input_ref(r),
        Some(StandardRecordType::Output) => validate_output_ref(r),
        Some(StandardRecordType::Xpub) => validate_xpub_ref(r),
        None => Err(ValidationError::UnsupportedType(t.to_owned())),
    }
}

fn validate_tx_ref(txid: &str) -> std::result::Result<(), ValidationError> {
    if txid.len() != 64 || !txid.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(ValidationError::InvalidTxid(txid.to_owned()));
    }
    Ok(())
}

fn validate_output_ref(output_ref: &str) -> std::result::Result<(), ValidationError> {
    let (txid, vout) = split_indexed_ref(output_ref, true)?;
    validate_tx_ref(txid)?;
    parse_index(vout, true)?;
    Ok(())
}

fn validate_input_ref(input_ref: &str) -> std::result::Result<(), ValidationError> {
    let (txid, vin) = split_indexed_ref(input_ref, false)?;
    validate_tx_ref(txid)?;
    parse_index(vin, false)?;
    Ok(())
}

fn split_indexed_ref(
    value: &str,
    is_output: bool,
) -> std::result::Result<(&str, &str), ValidationError> {
    let (txid, index) = value.split_once(':').ok_or_else(|| {
        if is_output {
            ValidationError::InvalidOutputRef(value.to_owned())
        } else {
            ValidationError::InvalidInputRef(value.to_owned())
        }
    })?;

    if txid.is_empty() || index.is_empty() || index.contains(':') {
        return Err(if is_output {
            ValidationError::InvalidOutputRef(value.to_owned())
        } else {
            ValidationError::InvalidInputRef(value.to_owned())
        });
    }

    Ok((txid, index))
}

fn parse_index(index: &str, is_output: bool) -> std::result::Result<(), ValidationError> {
    if index.parse::<u32>().is_err() {
        return Err(if is_output {
            ValidationError::InvalidVout(index.to_owned())
        } else {
            ValidationError::InvalidInputIndex(index.to_owned())
        });
    }

    Ok(())
}

fn validate_address_ref(address: &str) -> std::result::Result<(), ValidationError> {
    Address::<NetworkUnchecked>::from_str(address)
        .map(|_| ())
        .map_err(|_| ValidationError::InvalidAddress(address.to_owned()))
}

fn validate_pubkey_ref(pubkey: &str) -> std::result::Result<(), ValidationError> {
    if PublicKey::from_str(pubkey).is_ok() || XOnlyPublicKey::from_str(pubkey).is_ok() {
        return Ok(());
    }

    Err(ValidationError::InvalidPubkey(pubkey.to_owned()))
}

fn validate_xpub_ref(xpub: &str) -> std::result::Result<(), ValidationError> {
    Xpub::from_str(xpub)
        .map(|_| ())
        .map_err(|_| ValidationError::InvalidXpub(xpub.to_owned()))
}

#[cfg(test)]
mod tests {
    use super::{is_supported_type, validate_ref, ValidationError};

    const VALID_TXID: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const VALID_XPUB: &str = "xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8";
    const VALID_ADDR: &str = "1BoatSLRHtKNngkdXEeobR76b53LETtpyT";
    const VALID_PUBKEY: &str = "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";

    #[test]
    fn valid_known_refs_are_accepted() {
        assert_eq!(validate_ref("tx", VALID_TXID), Ok(()));
        assert_eq!(validate_ref("output", &format!("{VALID_TXID}:2")), Ok(()));
        assert_eq!(validate_ref("input", &format!("{VALID_TXID}:0")), Ok(()));
        assert_eq!(validate_ref("addr", VALID_ADDR), Ok(()));
        assert_eq!(validate_ref("pubkey", VALID_PUBKEY), Ok(()));
        assert_eq!(validate_ref("xpub", VALID_XPUB), Ok(()));
    }

    #[test]
    fn invalid_refs_are_rejected() {
        let err = validate_ref("tx", "abcd").expect_err("should reject short txid");
        assert!(matches!(err, ValidationError::InvalidTxid(_)));

        let invalid_vout =
            validate_ref("output", &format!("{VALID_TXID}:abc")).expect_err("invalid vout");
        assert!(matches!(invalid_vout, ValidationError::InvalidVout(_)));

        let invalid_addr = validate_ref("addr", "not-an-address").expect_err("invalid address");
        assert!(matches!(invalid_addr, ValidationError::InvalidAddress(_)));
    }

    #[test]
    fn unsupported_types_are_not_supported() {
        assert!(!is_supported_type("address"));

        let err = validate_ref("address", "something").expect_err("unsupported type");
        assert!(matches!(err, ValidationError::UnsupportedType(_)));
    }
}
