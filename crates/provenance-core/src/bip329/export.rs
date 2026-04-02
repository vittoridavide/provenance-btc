use std::collections::{BTreeMap, BTreeSet, HashSet};

use rusqlite::Connection;

use crate::store::{bip329_records, labels};
use crate::Result;

use super::Bip329Record;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GeneratedBip329Export {
    pub jsonl_contents: String,
    pub record_count: u32,
    pub supported_label_count: u32,
    pub preserved_record_count: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
struct ExportSortKey {
    record_type: String,
    record_ref: String,
    origin_key: String,
    source_rank: u8,
}

#[derive(Debug, Clone)]
struct ExportLine {
    sort_key: ExportSortKey,
    source: ExportLineSource,
    jsonl: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ExportLineSource {
    SupportedLabel,
    PreservedRecord,
}

pub fn export_bip329(
    conn: &Connection,
    filter_txids: Option<&HashSet<String>>,
) -> Result<GeneratedBip329Export> {
    let tx_labels = match filter_txids {
        Some(txids) => labels::get_tx_labels_for_txids(conn, txids)?,
        None => labels::get_tx_labels(conn)?,
    };
    let output_labels = match filter_txids {
        Some(txids) => labels::get_output_labels_for_txids(conn, txids)?,
        None => labels::get_output_labels(conn)?,
    };

    let mut local_labels = BTreeMap::new();
    for label in tx_labels.into_iter().chain(output_labels) {
        local_labels.insert((label.ref_type, label.ref_id), label.label);
    }

    let mut covered_local_refs = BTreeSet::new();
    let mut export_lines = Vec::new();

    let stored_records = match filter_txids {
        Some(txids) => bip329_records::list_records_for_txids(conn, txids)?,
        None => bip329_records::list_records(conn)?,
    };
    for stored in stored_records {
        let mut record = stored.payload()?;
        if stored.tracks_local_label && record.supports_local_labels() {
            if let Some(label) = local_labels
                .get(&(record.r#type.clone(), record.r#ref.clone()))
                .cloned()
            {
                record.label = Some(label);
                covered_local_refs.insert((record.r#type.clone(), record.r#ref.clone()));
            } else {
                record.label = None;
            }
        }

        if stored.tracks_local_label && !should_emit_bound_record(&record) {
            continue;
        }

        export_lines.push(ExportLine {
            sort_key: ExportSortKey {
                record_type: stored.record_type,
                record_ref: stored.record_ref,
                origin_key: stored.origin_key,
                source_rank: 0,
            },
            source: if stored.tracks_local_label && record.label.is_some() {
                ExportLineSource::SupportedLabel
            } else {
                ExportLineSource::PreservedRecord
            },
            jsonl: record.to_json_line()?,
        });
    }

    for ((record_type, record_ref), label) in local_labels {
        if covered_local_refs.contains(&(record_type.clone(), record_ref.clone())) {
            continue;
        }

        let record = Bip329Record {
            r#type: record_type.clone(),
            r#ref: record_ref.clone(),
            label: Some(label),
            origin: None,
            spendable: None,
            extra: BTreeMap::new(),
        };

        export_lines.push(ExportLine {
            sort_key: ExportSortKey {
                record_type,
                record_ref,
                origin_key: String::new(),
                source_rank: 1,
            },
            source: ExportLineSource::SupportedLabel,
            jsonl: record.to_json_line()?,
        });
    }

    export_lines.sort_by(|a, b| a.sort_key.cmp(&b.sort_key));
    let record_count = export_lines.len() as u32;
    let supported_label_count = export_lines
        .iter()
        .filter(|line| line.source == ExportLineSource::SupportedLabel)
        .count() as u32;
    let preserved_record_count = export_lines
        .iter()
        .filter(|line| line.source == ExportLineSource::PreservedRecord)
        .count() as u32;
    let jsonl_contents = export_lines
        .into_iter()
        .map(|line| line.jsonl)
        .collect::<Vec<_>>()
        .join("\n");

    Ok(GeneratedBip329Export {
        jsonl_contents,
        record_count,
        supported_label_count,
        preserved_record_count,
    })
}

pub fn export_bip329_jsonl(
    conn: &Connection,
    filter_txids: Option<&HashSet<String>>,
) -> Result<String> {
    Ok(export_bip329(conn, filter_txids)?.jsonl_contents)
}

fn should_emit_bound_record(record: &Bip329Record) -> bool {
    record.label.is_some() || record.has_independent_payload()
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use serde_json::json;

    use crate::bip329::{import_bip329_jsonl, Bip329Record};
    use crate::store::{bip329_records, db::Database, labels};

    use super::{export_bip329, export_bip329_jsonl};

    const TXID_C: &str = "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";

    const TXID_A: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const TXID_B: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const VALID_ADDR: &str = "1BoatSLRHtKNngkdXEeobR76b53LETtpyT";

    #[test]
    fn export_produces_multiline_jsonl() {
        let db = Database::open(":memory:").expect("db opens");
        labels::set_label(db.conn(), "tx", TXID_A, "salary").expect("insert tx");
        labels::set_label(db.conn(), "output", &format!("{TXID_A}:0"), "salary-output")
            .expect("insert output");

        let jsonl = export_bip329_jsonl(db.conn(), None).expect("export works");
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
    fn export_is_stably_sorted_by_type_ref_and_origin() {
        let db = Database::open(":memory:").expect("db opens");
        labels::set_label(db.conn(), "tx", TXID_B, "tx-b").expect("insert tx-b");
        labels::set_label(db.conn(), "output", &format!("{TXID_A}:1"), "out-a-1")
            .expect("insert output");
        labels::set_label(db.conn(), "tx", TXID_A, "tx-a").expect("insert tx-a");
        bip329_records::upsert_record(
            db.conn(),
            &Bip329Record {
                r#type: "tx".to_owned(),
                r#ref: TXID_A.to_owned(),
                label: None,
                origin: Some("wallet-a".to_owned()),
                spendable: None,
                extra: BTreeMap::from([(String::from("foo"), json!(1))]),
            },
            r#"{"type":"tx"}"#,
            true,
        )
        .expect("insert preserved");

        let jsonl = export_bip329_jsonl(db.conn(), None).expect("export works");
        let lines: Vec<String> = jsonl.lines().map(str::to_owned).collect();

        assert_eq!(
            lines,
            vec![
                format!(r#"{{"type":"output","ref":"{TXID_A}:1","label":"out-a-1"}}"#),
                format!(
                    r#"{{"type":"tx","ref":"{TXID_A}","label":"tx-a","origin":"wallet-a","foo":1}}"#
                ),
                format!(r#"{{"type":"tx","ref":"{TXID_B}","label":"tx-b"}}"#),
            ]
        );
    }

    #[test]
    fn export_round_trips_preserved_standard_and_unknown_records() {
        let source_db = Database::open(":memory:").expect("source db opens");
        let input = format!(
            r#"{{"type":"addr","ref":"{VALID_ADDR}","label":"vendor","origin":"wallet-a"}}
{{"type":"future_type","ref":"foo","label":"bar","custom":1}}
{{"type":"tx","ref":"{TXID_A}","label":"salary","origin":"wallet-a","custom":true}}"#
        );
        let report = import_bip329_jsonl(source_db.conn(), &input).expect("import works");
        assert_eq!(report.imported, 1);
        assert_eq!(report.preserved_only, 1);
        assert_eq!(report.skipped_unsupported_type, 1);

        let exported = export_bip329_jsonl(source_db.conn(), None).expect("export works");

        let target_db = Database::open(":memory:").expect("target db opens");
        let target_report =
            import_bip329_jsonl(target_db.conn(), &exported).expect("reimport works");
        assert_eq!(target_report.imported, 1);
        assert_eq!(target_report.preserved_only, 1);
        assert_eq!(target_report.skipped_unsupported_type, 1);

        let source_records = bip329_records::list_records(source_db.conn()).expect("list source");
        let target_records = bip329_records::list_records(target_db.conn()).expect("list target");

        assert_eq!(
            source_records
                .iter()
                .map(|record| (
                    &record.record_type,
                    &record.record_ref,
                    &record.origin_key,
                    &record.payload_json
                ))
                .collect::<Vec<_>>(),
            target_records
                .iter()
                .map(|record| (
                    &record.record_type,
                    &record.record_ref,
                    &record.origin_key,
                    &record.payload_json
                ))
                .collect::<Vec<_>>()
        );
    }

    #[test]
    fn deleting_local_label_does_not_resurrect_label_only_preserved_record() {
        let db = Database::open(":memory:").expect("db opens");
        import_bip329_jsonl(
            db.conn(),
            &format!(r#"{{"type":"tx","ref":"{TXID_A}","label":"salary"}}"#),
        )
        .expect("import works");
        labels::delete_label(db.conn(), "tx", TXID_A).expect("delete works");

        let jsonl = export_bip329_jsonl(db.conn(), None).expect("export works");
        assert!(jsonl.is_empty());
    }

    #[test]
    fn deleting_local_label_keeps_independent_preserved_fields() {
        let db = Database::open(":memory:").expect("db opens");
        import_bip329_jsonl(
            db.conn(),
            &format!(
                r#"{{"type":"tx","ref":"{TXID_A}","label":"salary","origin":"wallet-a","custom":true}}"#
            ),
        )
        .expect("import works");
        labels::delete_label(db.conn(), "tx", TXID_A).expect("delete works");

        let jsonl = export_bip329_jsonl(db.conn(), None).expect("export works");
        assert_eq!(
            jsonl,
            format!(r#"{{"type":"tx","ref":"{TXID_A}","origin":"wallet-a","custom":true}}"#)
        );
    }

    #[test]
    fn filtered_export_restricts_to_matching_txids() {
        let db = Database::open(":memory:").expect("db opens");
        // TXID_A: tx label + output label
        labels::set_label(db.conn(), "tx", TXID_A, "salary-a").expect("insert tx-a");
        labels::set_label(db.conn(), "output", &format!("{TXID_A}:0"), "out-a-0")
            .expect("insert out-a-0");
        // TXID_B: tx label only
        labels::set_label(db.conn(), "tx", TXID_B, "salary-b").expect("insert tx-b");
        // TXID_C: tx label only (should be excluded by filter)
        labels::set_label(db.conn(), "tx", TXID_C, "salary-c").expect("insert tx-c");

        let filter: std::collections::HashSet<String> = [TXID_A.to_string(), TXID_B.to_string()]
            .into_iter()
            .collect();
        let jsonl = export_bip329_jsonl(db.conn(), Some(&filter)).expect("filtered export works");
        let lines: Vec<&str> = jsonl.lines().collect();

        // 3 records for TXID_A and TXID_B, none for TXID_C
        assert_eq!(lines.len(), 3, "expected 3 lines, got: {jsonl}");
        assert!(
            lines.iter().all(|l| !l.contains(TXID_C)),
            "TXID_C should be absent"
        );
        assert!(
            lines
                .iter()
                .any(|l| l.contains(TXID_A) && l.contains("\"type\":\"tx\"")),
            "tx label for TXID_A expected"
        );
        assert!(
            lines.iter().any(|l| l.contains(&format!("{TXID_A}:0"))),
            "output label for TXID_A expected"
        );
        assert!(
            lines
                .iter()
                .any(|l| l.contains(TXID_B) && l.contains("\"type\":\"tx\"")),
            "tx label for TXID_B expected"
        );
    }

    #[test]
    fn filtered_export_excludes_non_tx_output_preserved_records() {
        let db = Database::open(":memory:").expect("db opens");
        labels::set_label(db.conn(), "tx", TXID_A, "salary").expect("insert tx");
        // Import an addr-type preserved record (not linked to a txid)
        import_bip329_jsonl(
            db.conn(),
            &format!(
                r#"{{"type":"addr","ref":"{VALID_ADDR}","label":"vendor","origin":"wallet-a"}}"#
            ),
        )
        .expect("import works");

        let filter: std::collections::HashSet<String> = [TXID_A.to_string()].into_iter().collect();
        let jsonl = export_bip329_jsonl(db.conn(), Some(&filter)).expect("filtered export works");
        let lines: Vec<&str> = jsonl.lines().collect();

        // Only the tx label for TXID_A; addr record is excluded by filter
        assert_eq!(lines.len(), 1, "expected 1 line, got: {jsonl}");
        assert!(lines[0].contains(TXID_A));
        assert!(!jsonl.contains(VALID_ADDR));
    }

    #[test]
    fn filtered_export_with_empty_set_returns_empty() {
        let db = Database::open(":memory:").expect("db opens");
        labels::set_label(db.conn(), "tx", TXID_A, "salary").expect("insert");

        let filter: std::collections::HashSet<String> = std::collections::HashSet::new();
        let jsonl =
            export_bip329_jsonl(db.conn(), Some(&filter)).expect("empty filter export works");
        assert!(jsonl.is_empty());
    }

    #[test]
    fn unfiltered_export_returns_all_records() {
        let db = Database::open(":memory:").expect("db opens");
        labels::set_label(db.conn(), "tx", TXID_A, "salary-a").expect("insert a");
        labels::set_label(db.conn(), "tx", TXID_B, "salary-b").expect("insert b");
        labels::set_label(db.conn(), "tx", TXID_C, "salary-c").expect("insert c");

        let jsonl = export_bip329_jsonl(db.conn(), None).expect("unfiltered export works");
        let lines: Vec<&str> = jsonl.lines().collect();
        assert_eq!(lines.len(), 3);
    }

    #[test]
    fn export_summary_counts_supported_and_preserved_records() {
        let db = Database::open(":memory:").expect("db opens");
        labels::set_label(db.conn(), "tx", TXID_A, "salary").expect("insert tx");
        import_bip329_jsonl(
            db.conn(),
            &format!(
                r#"{{"type":"addr","ref":"{VALID_ADDR}","label":"vendor","origin":"wallet-a"}}"#
            ),
        )
        .expect("import works");

        let export = export_bip329(db.conn(), None).expect("export works");

        assert_eq!(export.record_count, 2);
        assert_eq!(export.supported_label_count, 1);
        assert_eq!(export.preserved_record_count, 1);
    }
}
