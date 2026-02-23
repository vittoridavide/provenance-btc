use rusqlite::Connection;
use serde::Serialize;

use crate::store::labels;
use crate::{CoreError, Result};

#[derive(Serialize)]
struct ExportRecord<'a> {
    #[serde(rename = "type")]
    record_type: &'a str,
    #[serde(rename = "ref")]
    record_ref: &'a str,
    label: &'a str,
}

pub fn export_bip329_jsonl(conn: &Connection) -> Result<String> {
    let mut all_labels = Vec::new();
    all_labels.extend(labels::get_tx_labels(conn)?);
    all_labels.extend(labels::get_output_labels(conn)?);

    all_labels.sort_by(|a, b| {
        a.ref_type
            .cmp(&b.ref_type)
            .then_with(|| a.ref_id.cmp(&b.ref_id))
    });

    let mut lines = Vec::with_capacity(all_labels.len());
    for label in all_labels {
        let record = ExportRecord {
            record_type: &label.ref_type,
            record_ref: &label.ref_id,
            label: &label.label,
        };
        let line = serde_json::to_string(&record).map_err(|err| {
            CoreError::Other(format!("failed to serialize BIP-329 record: {err}"))
        })?;
        lines.push(line);
    }

    Ok(lines.join("\n"))
}

#[cfg(test)]
mod tests {
    use crate::bip329::import_bip329_jsonl;
    use crate::store::{db::Database, labels};

    use super::export_bip329_jsonl;

    const TXID_A: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const TXID_B: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

    #[test]
    fn export_produces_multiline_jsonl() {
        let db = Database::open(":memory:").expect("db opens");
        labels::set_label(db.conn(), "tx", TXID_A, "salary").expect("insert tx");
        labels::set_label(db.conn(), "output", &format!("{TXID_A}:0"), "salary-output")
            .expect("insert output");

        let jsonl = export_bip329_jsonl(db.conn()).expect("export works");
        let lines: Vec<String> = jsonl.lines().map(str::to_owned).collect();

        assert_eq!(lines.len(), 2);
        for line in &lines {
            let parsed: serde_json::Value = serde_json::from_str(line).expect("line is valid JSON");
            assert!(parsed.get("type").is_some());
            assert!(parsed.get("ref").is_some());
            assert!(parsed.get("label").is_some());
        }
    }

    #[test]
    fn export_is_stably_sorted_by_type_then_ref() {
        let db = Database::open(":memory:").expect("db opens");
        labels::set_label(db.conn(), "tx", TXID_B, "tx-b").expect("insert tx-b");
        labels::set_label(db.conn(), "output", &format!("{TXID_A}:1"), "out-a-1")
            .expect("insert output");
        labels::set_label(db.conn(), "tx", TXID_A, "tx-a").expect("insert tx-a");
        labels::set_label(db.conn(), "output", &format!("{TXID_A}:0"), "out-a-0")
            .expect("insert output");

        let jsonl = export_bip329_jsonl(db.conn()).expect("export works");
        let lines: Vec<String> = jsonl.lines().map(str::to_owned).collect();

        assert_eq!(
            lines,
            vec![
                format!(r#"{{"type":"output","ref":"{TXID_A}:0","label":"out-a-0"}}"#),
                format!(r#"{{"type":"output","ref":"{TXID_A}:1","label":"out-a-1"}}"#),
                format!(r#"{{"type":"tx","ref":"{TXID_A}","label":"tx-a"}}"#),
                format!(r#"{{"type":"tx","ref":"{TXID_B}","label":"tx-b"}}"#),
            ]
        );
    }

    #[test]
    fn export_then_import_is_idempotent_for_labels() {
        let source_db = Database::open(":memory:").expect("source db opens");
        labels::set_label(source_db.conn(), "tx", TXID_A, "tx-a").expect("insert tx");
        labels::set_label(
            source_db.conn(),
            "output",
            &format!("{TXID_A}:0"),
            "out-a-0",
        )
        .expect("insert output");
        labels::set_label(source_db.conn(), "tx", TXID_B, "tx-b").expect("insert tx");

        let exported = export_bip329_jsonl(source_db.conn()).expect("export works");

        let target_db = Database::open(":memory:").expect("target db opens");
        let report = import_bip329_jsonl(target_db.conn(), &exported).expect("import works");
        assert_eq!(report.imported, 3);
        assert_eq!(report.skipped_invalid, 0);
        assert_eq!(report.skipped_unsupported_type, 0);

        let source_tx = labels::get_tx_labels(source_db.conn()).expect("query source tx");
        let source_output =
            labels::get_output_labels(source_db.conn()).expect("query source output");
        let target_tx = labels::get_tx_labels(target_db.conn()).expect("query target tx");
        let target_output =
            labels::get_output_labels(target_db.conn()).expect("query target output");

        assert_eq!(to_pairs(source_tx), to_pairs(target_tx));
        assert_eq!(to_pairs(source_output), to_pairs(target_output));
    }

    fn to_pairs(mut labels: Vec<labels::Label>) -> Vec<(String, String)> {
        let mut pairs: Vec<(String, String)> = labels
            .drain(..)
            .map(|label| (label.ref_id, label.label))
            .collect();
        pairs.sort();
        pairs
    }
}
