use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{CoreError, Result};

/// One permissive BIP-329 JSONL record.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Bip329Record {
    #[serde(rename = "type")]
    pub r#type: String,
    #[serde(rename = "ref")]
    pub r#ref: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub spendable: Option<bool>,
    #[serde(default, flatten)]
    pub extra: BTreeMap<String, Value>,
}

impl Bip329Record {
    pub fn standard_type(&self) -> Option<StandardRecordType> {
        StandardRecordType::parse(&self.r#type)
    }

    pub fn supports_local_labels(&self) -> bool {
        matches!(
            self.standard_type(),
            Some(StandardRecordType::Tx | StandardRecordType::Output)
        )
    }

    pub fn origin_key(&self) -> &str {
        self.origin.as_deref().unwrap_or("")
    }

    pub fn has_independent_payload(&self) -> bool {
        self.origin.is_some() || self.spendable.is_some() || !self.extra.is_empty()
    }

    pub fn to_json_line(&self) -> Result<String> {
        serde_json::to_string(self)
            .map_err(|err| CoreError::Other(format!("failed to serialize BIP-329 record: {err}")))
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "lowercase")]
pub enum StandardRecordType {
    Tx,
    Addr,
    Pubkey,
    Input,
    Output,
    Xpub,
}

impl StandardRecordType {
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "tx" => Some(Self::Tx),
            "addr" => Some(Self::Addr),
            "pubkey" => Some(Self::Pubkey),
            "input" => Some(Self::Input),
            "output" => Some(Self::Output),
            "xpub" => Some(Self::Xpub),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Tx => "tx",
            Self::Addr => "addr",
            Self::Pubkey => "pubkey",
            Self::Input => "input",
            Self::Output => "output",
            Self::Xpub => "xpub",
        }
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use std::collections::BTreeMap;

    use super::{Bip329Record, StandardRecordType};

    #[test]
    fn parses_single_line_json_object_with_optional_and_extra_fields() {
        let txid = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
        let line =
            format!(r#"{{"type":"tx","ref":"{txid}","label":"salary","origin":"wallet","foo":1}}"#);

        let parsed: Bip329Record = serde_json::from_str(&line).expect("record should parse");

        assert_eq!(parsed.r#type, "tx");
        assert_eq!(parsed.r#ref, txid);
        assert_eq!(parsed.label.as_deref(), Some("salary"));
        assert_eq!(parsed.origin.as_deref(), Some("wallet"));
        assert_eq!(parsed.extra.get("foo"), Some(&json!(1)));
        assert!(parsed.supports_local_labels());
        assert_eq!(parsed.standard_type(), Some(StandardRecordType::Tx));
    }

    #[test]
    fn serializes_without_absent_optional_fields() {
        let record = Bip329Record {
            r#type: "output".to_owned(),
            r#ref: "abcd:0".to_owned(),
            label: Some("coin".to_owned()),
            origin: None,
            spendable: None,
            extra: BTreeMap::new(),
        };

        let json = serde_json::to_value(&record).expect("record serializes");

        assert_eq!(json["type"], "output");
        assert_eq!(json["ref"], "abcd:0");
        assert_eq!(json["label"], "coin");
        assert!(json.get("origin").is_none());
        assert!(json.get("spendable").is_none());
    }
}
