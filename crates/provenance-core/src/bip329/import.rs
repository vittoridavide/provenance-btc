use rusqlite::Connection;
use serde::{Deserialize, Serialize};

use crate::store::labels;
use crate::Result;

use super::{is_supported_type, validate_ref, Bip329Record};

const MAX_STORED_ERRORS: usize = 20;

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct ImportReport {
    pub total_lines: usize,
    pub imported: usize,
    pub skipped_unsupported_type: usize,
    pub skipped_invalid: usize,
    pub errors: Vec<ImportErrorLine>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ImportErrorLine {
    pub line_number: usize,
    pub message: String,
}

pub fn import_bip329_jsonl(conn: &Connection, input: &str) -> Result<ImportReport> {
    conn.execute_batch("BEGIN;")?;

    let result = import_lines(conn, input);

    match result {
        Ok(report) => {
            conn.execute_batch("COMMIT;")?;
            Ok(report)
        }
        Err(err) => {
            let _ = conn.execute_batch("ROLLBACK;");
            Err(err)
        }
    }
}

fn import_lines(conn: &Connection, input: &str) -> Result<ImportReport> {
    let mut report = ImportReport::default();

    for (idx, raw_line) in input.lines().enumerate() {
        let line_number = idx + 1;
        let line = raw_line.trim();
        if line.is_empty() {
            continue;
        }

        report.total_lines += 1;

        let record: Bip329Record = match serde_json::from_str(line) {
            Ok(record) => record,
            Err(err) => {
                add_invalid_error(
                    &mut report,
                    line_number,
                    format!("json parse error on line {line_number}: {err}"),
                );
                continue;
            }
        };

        if !is_supported_type(&record.r#type) {
            report.skipped_unsupported_type += 1;
            continue;
        }

        if let Err(err) = validate_ref(&record.r#type, &record.r#ref) {
            add_invalid_error(
                &mut report,
                line_number,
                format!("invalid ref on line {line_number}: {err}"),
            );
            continue;
        }

        labels::set_label(conn, &record.r#type, &record.r#ref, &record.label)?;
        report.imported += 1;
    }

    Ok(report)
}

fn add_invalid_error(report: &mut ImportReport, line_number: usize, message: String) {
    report.skipped_invalid += 1;
    if report.errors.len() < MAX_STORED_ERRORS {
        report.errors.push(ImportErrorLine {
            line_number,
            message,
        });
    }
}

#[cfg(test)]
mod tests {
    use crate::store::{db::Database, labels};

    use super::import_bip329_jsonl;

    const TXID_A: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const TXID_B: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

    #[test]
    fn imports_tx_and_output_labels() {
        let db = Database::open(":memory:").expect("db opens");
        let input = format!(
            r#"{{"type":"tx","ref":"{TXID_A}","label":"salary"}}
{{"type":"output","ref":"{TXID_A}:1","label":"salary-output"}}"#
        );

        let report = import_bip329_jsonl(db.conn(), &input).expect("import succeeds");

        assert_eq!(report.total_lines, 2);
        assert_eq!(report.imported, 2);
        assert_eq!(report.skipped_unsupported_type, 0);
        assert_eq!(report.skipped_invalid, 0);

        let tx_label = labels::get_label(db.conn(), "tx", TXID_A)
            .expect("query succeeds")
            .expect("tx label exists");
        assert_eq!(tx_label.label, "salary");

        let out_label = labels::get_label(db.conn(), "output", &format!("{TXID_A}:1"))
            .expect("query succeeds")
            .expect("output label exists");
        assert_eq!(out_label.label, "salary-output");
    }

    #[test]
    fn ignores_unsupported_types_and_reports_counts() {
        let db = Database::open(":memory:").expect("db opens");
        let input = format!(
            r#"{{"type":"address","ref":"{TXID_A}","label":"ignored"}}
{{"type":"tx","ref":"{TXID_B}","label":"kept"}}"#
        );

        let report = import_bip329_jsonl(db.conn(), &input).expect("import succeeds");

        assert_eq!(report.total_lines, 2);
        assert_eq!(report.imported, 1);
        assert_eq!(report.skipped_unsupported_type, 1);
        assert_eq!(report.skipped_invalid, 0);
    }

    #[test]
    fn invalid_json_line_does_not_abort_whole_import() {
        let db = Database::open(":memory:").expect("db opens");
        let input = format!(
            r#"{{"type":"tx","ref":"{TXID_A}","label":"first"}}
{{"type":"tx","ref":"broken","label":"oops"
{{"type":"output","ref":"{TXID_A}:0","label":"second"}}"#
        );

        let report = import_bip329_jsonl(db.conn(), &input).expect("import succeeds");

        assert_eq!(report.total_lines, 3);
        assert_eq!(report.imported, 2);
        assert_eq!(report.skipped_invalid, 1);
        assert_eq!(report.errors.len(), 1);
        assert_eq!(report.errors[0].line_number, 2);

        assert!(labels::get_label(db.conn(), "tx", TXID_A)
            .expect("query succeeds")
            .is_some());
        assert!(
            labels::get_label(db.conn(), "output", &format!("{TXID_A}:0"))
                .expect("query succeeds")
                .is_some()
        );
    }

    #[test]
    fn duplicate_ref_updates_label_via_upsert() {
        let db = Database::open(":memory:").expect("db opens");
        let input = format!(
            r#"{{"type":"tx","ref":"{TXID_A}","label":"old"}}
{{"type":"tx","ref":"{TXID_A}","label":"new"}}"#
        );

        let report = import_bip329_jsonl(db.conn(), &input).expect("import succeeds");

        assert_eq!(report.imported, 2);

        let tx_label = labels::get_label(db.conn(), "tx", TXID_A)
            .expect("query succeeds")
            .expect("label exists");
        assert_eq!(tx_label.label, "new");
    }
}
