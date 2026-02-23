use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// One permissive BIP-329 JSONL record.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Bip329Record {
    #[serde(rename = "type")]
    pub r#type: String,
    #[serde(rename = "ref")]
    pub r#ref: String,
    pub label: String,
    #[serde(default, flatten)]
    pub extra: HashMap<String, Value>,
}

#[cfg(test)]
mod tests {
    use super::Bip329Record;

    #[test]
    fn parses_single_line_json_object() {
        let txid = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
        let line = format!(r#"{{"type":"tx","ref":"{txid}","label":"salary","origin":"wallet"}}"#);

        let parsed: Bip329Record = serde_json::from_str(&line).expect("record should parse");

        assert_eq!(parsed.r#type, "tx");
        assert_eq!(parsed.r#ref, txid);
        assert_eq!(parsed.label, "salary");
        assert_eq!(
            parsed.extra.get("origin").and_then(|v| v.as_str()),
            Some("wallet")
        );
    }
}
