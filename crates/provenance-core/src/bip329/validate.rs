use thiserror::Error;

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
}

pub fn is_supported_type(t: &str) -> bool {
    matches!(t, "tx" | "output")
}

pub fn validate_ref(t: &str, r: &str) -> std::result::Result<(), ValidationError> {
    match t {
        "tx" => validate_tx_ref(r),
        "output" => validate_output_ref(r),
        _ => Err(ValidationError::UnsupportedType(t.to_owned())),
    }
}

fn validate_tx_ref(txid: &str) -> std::result::Result<(), ValidationError> {
    if txid.len() != 64 || !txid.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(ValidationError::InvalidTxid(txid.to_owned()));
    }
    Ok(())
}

fn validate_output_ref(output_ref: &str) -> std::result::Result<(), ValidationError> {
    let (txid, vout) = output_ref
        .split_once(':')
        .ok_or_else(|| ValidationError::InvalidOutputRef(output_ref.to_owned()))?;

    if txid.is_empty() || vout.is_empty() || vout.contains(':') {
        return Err(ValidationError::InvalidOutputRef(output_ref.to_owned()));
    }

    validate_tx_ref(txid)?;

    if vout.parse::<u32>().is_err() {
        return Err(ValidationError::InvalidVout(vout.to_owned()));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{is_supported_type, validate_ref, ValidationError};

    const VALID_TXID: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    #[test]
    fn valid_tx_ref() {
        assert_eq!(validate_ref("tx", VALID_TXID), Ok(()));
    }

    #[test]
    fn valid_output_ref() {
        assert_eq!(validate_ref("output", &format!("{VALID_TXID}:2")), Ok(()));
    }

    #[test]
    fn invalid_txid_length() {
        let err = validate_ref("tx", "abcd").expect_err("should reject short txid");
        assert!(matches!(err, ValidationError::InvalidTxid(_)));
    }

    #[test]
    fn invalid_vout_and_missing_colon() {
        let missing_colon = validate_ref("output", VALID_TXID).expect_err("missing colon");
        assert!(matches!(
            missing_colon,
            ValidationError::InvalidOutputRef(_)
        ));

        let invalid_vout =
            validate_ref("output", &format!("{VALID_TXID}:abc")).expect_err("invalid vout");
        assert!(matches!(invalid_vout, ValidationError::InvalidVout(_)));
    }

    #[test]
    fn unsupported_types_are_not_supported() {
        assert!(!is_supported_type("address"));

        let err = validate_ref("address", "something").expect_err("unsupported type");
        assert!(matches!(err, ValidationError::UnsupportedType(_)));
    }
}
