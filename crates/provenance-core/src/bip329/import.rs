use std::collections::{BTreeMap, BTreeSet};

use rusqlite::Connection;
use serde::{Deserialize, Serialize};

use crate::store::{bip329_records, labels};
use crate::Result;

use super::{validate_ref, Bip329Record, StandardRecordType, ValidationError};

const MAX_STORED_ERRORS: usize = 20;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ImportDisposition {
    ApplySupported,
    PreserveOnly,
    AmbiguousSupported,
    Invalid,
    IgnoredUnsupported,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ImportConflictPolicy {
    PreferLocal,
    PreferImport,
    OnlyNew,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ImportPreviewLine {
    pub line_number: usize,
    pub disposition: ImportDisposition,
    pub record_type: Option<String>,
    pub record_ref: Option<String>,
    pub origin: Option<String>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct ImportPreview {
    pub total_lines: usize,
    pub apply_supported: usize,
    pub preserve_only: usize,
    pub ambiguous_supported: usize,
    pub invalid: usize,
    pub ignored_unsupported: usize,
    pub lines: Vec<ImportPreviewLine>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct ImportReport {
    pub total_lines: usize,
    pub imported: usize,
    pub preserved_only: usize,
    pub ambiguous_supported: usize,
    pub skipped_unsupported_type: usize,
    pub skipped_invalid: usize,
    pub errors: Vec<ImportErrorLine>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ImportErrorLine {
    pub line_number: usize,
    pub message: String,
}

#[derive(Debug, Clone)]
enum ProvisionalKind {
    CandidateSupportedLabel,
    PreserveOnly { tracks_local_label: bool },
    IgnoredUnsupported,
}

#[derive(Debug, Clone)]
struct ParsedLine {
    line_number: usize,
    raw_json: String,
    record: Bip329Record,
    provisional: ProvisionalKind,
}

#[derive(Debug, Clone)]
enum EvaluatedKind {
    ApplySupported,
    PreserveOnly { tracks_local_label: bool },
    AmbiguousSupported,
    IgnoredUnsupported,
    Invalid(String),
}

#[derive(Debug, Clone)]
struct EvaluatedLine {
    line_number: usize,
    raw_json: String,
    record: Option<Bip329Record>,
    kind: EvaluatedKind,
}

#[derive(Debug, Clone)]
struct AmbiguityCandidate {
    origin_key: String,
    label: Option<String>,
}

pub fn preview_bip329_jsonl(conn: &Connection, input: &str) -> Result<ImportPreview> {
    Ok(evaluate_input(conn, input)?.preview)
}

pub fn import_bip329_jsonl(conn: &Connection, input: &str) -> Result<ImportReport> {
    import_bip329_jsonl_with_policy(conn, input, ImportConflictPolicy::PreferImport)
}

pub fn import_bip329_jsonl_with_policy(
    conn: &Connection,
    input: &str,
    policy: ImportConflictPolicy,
) -> Result<ImportReport> {
    conn.execute_batch("BEGIN;")?;

    let result = apply_import(conn, input, policy);

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

fn apply_import(
    conn: &Connection,
    input: &str,
    policy: ImportConflictPolicy,
) -> Result<ImportReport> {
    let evaluation = evaluate_input(conn, input)?;
    let mut report = ImportReport {
        total_lines: evaluation.preview.total_lines,
        ..ImportReport::default()
    };

    for line in evaluation.lines {
        match line.kind {
            EvaluatedKind::ApplySupported => {
                let record = line.record.expect("apply lines always have a record");
                let existing_label = labels::get_label(conn, &record.r#type, &record.r#ref)?
                    .map(|label| label.label);
                match supported_import_action(&record, existing_label.as_deref(), policy) {
                    SupportedImportAction::Apply => {
                        bip329_records::upsert_record(conn, &record, &line.raw_json, true)?;
                        if let Some(label) = record.label.as_deref() {
                            labels::set_label(conn, &record.r#type, &record.r#ref, label)?;
                            report.imported += 1;
                        }
                    }
                    SupportedImportAction::PreserveOnly { tracks_local_label } => {
                        bip329_records::upsert_record(
                            conn,
                            &record,
                            &line.raw_json,
                            tracks_local_label,
                        )?;
                        report.preserved_only += 1;
                    }
                }
            }
            EvaluatedKind::PreserveOnly { tracks_local_label } => {
                let record = line.record.expect("preserved lines always have a record");
                bip329_records::upsert_record(conn, &record, &line.raw_json, tracks_local_label)?;
                report.preserved_only += 1;
            }
            EvaluatedKind::AmbiguousSupported => {
                let record = line.record.expect("ambiguous lines always have a record");
                bip329_records::upsert_record(conn, &record, &line.raw_json, false)?;
                report.ambiguous_supported += 1;
            }
            EvaluatedKind::IgnoredUnsupported => {
                let record = line.record.expect("ignored lines always have a record");
                bip329_records::upsert_record(conn, &record, &line.raw_json, false)?;
                report.skipped_unsupported_type += 1;
            }
            EvaluatedKind::Invalid(message) => {
                add_invalid_error(&mut report, line.line_number, message);
            }
        }
    }

    Ok(report)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SupportedImportAction {
    Apply,
    PreserveOnly { tracks_local_label: bool },
}

fn supported_import_action(
    record: &Bip329Record,
    existing_label: Option<&str>,
    policy: ImportConflictPolicy,
) -> SupportedImportAction {
    let imported_label = record.label.as_deref();
    match (policy, existing_label, imported_label) {
        (ImportConflictPolicy::PreferImport, _, _) => SupportedImportAction::Apply,
        (ImportConflictPolicy::PreferLocal, Some(current), Some(imported))
            if current != imported =>
        {
            SupportedImportAction::PreserveOnly {
                tracks_local_label: true,
            }
        }
        (ImportConflictPolicy::OnlyNew, Some(_), _) => SupportedImportAction::PreserveOnly {
            tracks_local_label: false,
        },
        _ => SupportedImportAction::Apply,
    }
}

struct EvaluationOutput {
    preview: ImportPreview,
    lines: Vec<EvaluatedLine>,
}

fn evaluate_input(conn: &Connection, input: &str) -> Result<EvaluationOutput> {
    let mut parsed_lines = Vec::new();
    let mut evaluated_lines = Vec::new();
    let mut preview = ImportPreview::default();
    let mut supported_label_refs = BTreeSet::new();

    for (idx, raw_line) in input.lines().enumerate() {
        let line_number = idx + 1;
        let line = raw_line.trim();
        if line.is_empty() {
            continue;
        }

        preview.total_lines += 1;

        match parse_line(line_number, line) {
            Ok(parsed) => {
                if matches!(parsed.provisional, ProvisionalKind::CandidateSupportedLabel) {
                    supported_label_refs
                        .insert((parsed.record.r#type.clone(), parsed.record.r#ref.clone()));
                }
                parsed_lines.push(parsed);
            }
            Err(message) => {
                evaluated_lines.push(EvaluatedLine {
                    line_number,
                    raw_json: line.to_owned(),
                    record: None,
                    kind: EvaluatedKind::Invalid(message),
                });
            }
        }
    }

    let ambiguous_refs = ambiguous_supported_refs(conn, &supported_label_refs, &parsed_lines)?;

    for parsed in parsed_lines {
        let (disposition, kind, message) = match parsed.provisional {
            ProvisionalKind::CandidateSupportedLabel => {
                if ambiguous_refs
                    .contains(&(parsed.record.r#type.clone(), parsed.record.r#ref.clone()))
                {
                    (
                        ImportDisposition::AmbiguousSupported,
                        EvaluatedKind::AmbiguousSupported,
                        Some(
                            "multiple supported records collapse to the same local reference"
                                .to_owned(),
                        ),
                    )
                } else {
                    (
                        ImportDisposition::ApplySupported,
                        EvaluatedKind::ApplySupported,
                        None,
                    )
                }
            }
            ProvisionalKind::PreserveOnly { tracks_local_label } => (
                ImportDisposition::PreserveOnly,
                EvaluatedKind::PreserveOnly { tracks_local_label },
                None,
            ),
            ProvisionalKind::IgnoredUnsupported => (
                ImportDisposition::IgnoredUnsupported,
                EvaluatedKind::IgnoredUnsupported,
                Some("record type is not modeled locally and will be preserved only".to_owned()),
            ),
        };

        increment_preview_count(&mut preview, disposition);
        preview.lines.push(ImportPreviewLine {
            line_number: parsed.line_number,
            disposition,
            record_type: Some(parsed.record.r#type.clone()),
            record_ref: Some(parsed.record.r#ref.clone()),
            origin: parsed.record.origin.clone(),
            message: message.clone(),
        });
        evaluated_lines.push(EvaluatedLine {
            line_number: parsed.line_number,
            raw_json: parsed.raw_json,
            record: Some(parsed.record),
            kind,
        });
    }

    for line in &evaluated_lines {
        if let EvaluatedKind::Invalid(message) = &line.kind {
            increment_preview_count(&mut preview, ImportDisposition::Invalid);
            preview.lines.push(ImportPreviewLine {
                line_number: line.line_number,
                disposition: ImportDisposition::Invalid,
                record_type: None,
                record_ref: None,
                origin: None,
                message: Some(message.clone()),
            });
        }
    }

    preview.lines.sort_by_key(|line| line.line_number);
    evaluated_lines.sort_by_key(|line| line.line_number);

    Ok(EvaluationOutput {
        preview,
        lines: evaluated_lines,
    })
}

fn parse_line(line_number: usize, line: &str) -> std::result::Result<ParsedLine, String> {
    let record: Bip329Record = serde_json::from_str(line)
        .map_err(|err| format!("json parse error on line {line_number}: {err}"))?;

    if let Some(standard_type) = record.standard_type() {
        validate_ref(&record.r#type, &record.r#ref)
            .map_err(|err| format!("invalid record on line {line_number}: {err}"))?;

        if record.spendable.is_some() && standard_type != StandardRecordType::Output {
            return Err(format!(
                "invalid record on line {line_number}: {}",
                ValidationError::InvalidSpendableUsage
            ));
        }

        let provisional = match standard_type {
            StandardRecordType::Tx | StandardRecordType::Output => {
                if record.label.is_some() {
                    ProvisionalKind::CandidateSupportedLabel
                } else {
                    ProvisionalKind::PreserveOnly {
                        tracks_local_label: true,
                    }
                }
            }
            StandardRecordType::Addr
            | StandardRecordType::Pubkey
            | StandardRecordType::Input
            | StandardRecordType::Xpub => ProvisionalKind::PreserveOnly {
                tracks_local_label: false,
            },
        };

        Ok(ParsedLine {
            line_number,
            raw_json: line.to_owned(),
            record,
            provisional,
        })
    } else {
        Ok(ParsedLine {
            line_number,
            raw_json: line.to_owned(),
            record,
            provisional: ProvisionalKind::IgnoredUnsupported,
        })
    }
}

fn ambiguous_supported_refs(
    conn: &Connection,
    refs: &BTreeSet<(String, String)>,
    parsed_lines: &[ParsedLine],
) -> Result<BTreeSet<(String, String)>> {
    let mut current_candidates: BTreeMap<(String, String), Vec<AmbiguityCandidate>> =
        BTreeMap::new();

    for line in parsed_lines {
        if matches!(line.provisional, ProvisionalKind::CandidateSupportedLabel) {
            current_candidates
                .entry((line.record.r#type.clone(), line.record.r#ref.clone()))
                .or_default()
                .push(AmbiguityCandidate {
                    origin_key: line.record.origin_key().to_owned(),
                    label: line.record.label.clone(),
                });
        }
    }

    let mut ambiguous = BTreeSet::new();
    for (record_type, record_ref) in refs {
        let mut candidates = current_candidates
            .get(&(record_type.clone(), record_ref.clone()))
            .cloned()
            .unwrap_or_default();
        candidates.extend(existing_candidates(conn, record_type, record_ref)?);

        let non_empty_origins: BTreeSet<&str> = candidates
            .iter()
            .filter_map(|candidate| {
                if candidate.origin_key.is_empty() {
                    None
                } else {
                    Some(candidate.origin_key.as_str())
                }
            })
            .collect();
        let distinct_labels: BTreeSet<&str> = candidates
            .iter()
            .filter_map(|candidate| candidate.label.as_deref())
            .collect();

        if non_empty_origins.len() > 1 || distinct_labels.len() > 1 {
            ambiguous.insert((record_type.clone(), record_ref.clone()));
        }
    }

    Ok(ambiguous)
}

fn existing_candidates(
    conn: &Connection,
    record_type: &str,
    record_ref: &str,
) -> Result<Vec<AmbiguityCandidate>> {
    let mut out = Vec::new();
    for stored in bip329_records::get_records_by_ref(conn, record_type, record_ref)? {
        let payload = stored.payload()?;
        let label = if stored.tracks_local_label {
            labels::get_label(conn, record_type, record_ref)?.map(|stored_label| stored_label.label)
        } else {
            payload.label.clone()
        };

        out.push(AmbiguityCandidate {
            origin_key: stored.origin_key,
            label,
        });
    }

    Ok(out)
}

fn increment_preview_count(preview: &mut ImportPreview, disposition: ImportDisposition) {
    match disposition {
        ImportDisposition::ApplySupported => preview.apply_supported += 1,
        ImportDisposition::PreserveOnly => preview.preserve_only += 1,
        ImportDisposition::AmbiguousSupported => preview.ambiguous_supported += 1,
        ImportDisposition::Invalid => preview.invalid += 1,
        ImportDisposition::IgnoredUnsupported => preview.ignored_unsupported += 1,
    }
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
    use std::collections::BTreeMap;

    use serde_json::json;

    use crate::store::{bip329_records, db::Database, labels};

    use super::{
        import_bip329_jsonl, import_bip329_jsonl_with_policy, preview_bip329_jsonl,
        ImportConflictPolicy, ImportDisposition,
    };

    const TXID_A: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const VALID_ADDR: &str = "1BoatSLRHtKNngkdXEeobR76b53LETtpyT";

    #[test]
    fn imports_tx_and_output_labels_and_preserves_records() {
        let db = Database::open(":memory:").expect("db opens");
        let input = format!(
            r#"{{"type":"tx","ref":"{TXID_A}","label":"salary","origin":"wallet"}}
{{"type":"output","ref":"{TXID_A}:1","label":"salary-output","spendable":true}}"#
        );

        let report = import_bip329_jsonl(db.conn(), &input).expect("import succeeds");

        assert_eq!(report.total_lines, 2);
        assert_eq!(report.imported, 2);
        assert_eq!(report.preserved_only, 0);
        assert_eq!(report.ambiguous_supported, 0);
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

        let stored_tx =
            bip329_records::get_records_by_ref(db.conn(), "tx", TXID_A).expect("query succeeds");
        assert_eq!(stored_tx.len(), 1);
        assert!(stored_tx[0].tracks_local_label);
    }

    #[test]
    fn preview_classifies_all_required_dispositions() {
        let db = Database::open(":memory:").expect("db opens");
        let input = format!(
            r#"{{"type":"tx","ref":"{TXID_A}","label":"salary","origin":"wallet-a"}}
{{"type":"tx","ref":"{TXID_A}","label":"salary","origin":"wallet-b"}}
{{"type":"addr","ref":"{VALID_ADDR}","label":"vendor"}}
{{"type":"future_type","ref":"foo","label":"bar"}}
{{"type":"tx","ref":"broken","spendable":true}}"#
        );

        let preview = preview_bip329_jsonl(db.conn(), &input).expect("preview succeeds");

        assert_eq!(preview.total_lines, 5);
        assert_eq!(preview.apply_supported, 0);
        assert_eq!(preview.preserve_only, 1);
        assert_eq!(preview.ambiguous_supported, 2);
        assert_eq!(preview.ignored_unsupported, 1);
        assert_eq!(preview.invalid, 1);

        let dispositions: Vec<ImportDisposition> =
            preview.lines.iter().map(|line| line.disposition).collect();
        assert_eq!(
            dispositions,
            vec![
                ImportDisposition::AmbiguousSupported,
                ImportDisposition::AmbiguousSupported,
                ImportDisposition::PreserveOnly,
                ImportDisposition::IgnoredUnsupported,
                ImportDisposition::Invalid,
            ]
        );
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
    fn ambiguous_supported_records_are_preserved_but_not_applied() {
        let db = Database::open(":memory:").expect("db opens");
        let input = format!(
            r#"{{"type":"tx","ref":"{TXID_A}","label":"old","origin":"wallet-a"}}
{{"type":"tx","ref":"{TXID_A}","label":"new","origin":"wallet-b"}}"#
        );

        let report = import_bip329_jsonl(db.conn(), &input).expect("import succeeds");

        assert_eq!(report.imported, 0);
        assert_eq!(report.ambiguous_supported, 2);
        assert!(labels::get_label(db.conn(), "tx", TXID_A)
            .expect("query succeeds")
            .is_none());

        let stored =
            bip329_records::get_records_by_ref(db.conn(), "tx", TXID_A).expect("query succeeds");
        assert_eq!(stored.len(), 2);
        assert!(stored.iter().all(|record| !record.tracks_local_label));
    }

    #[test]
    fn preserve_only_supported_records_track_future_local_labels() {
        let db = Database::open(":memory:").expect("db opens");
        let input = format!(
            r#"{{"type":"output","ref":"{TXID_A}:0","spendable":false,"origin":"wallet-a"}}"#
        );

        let report = import_bip329_jsonl(db.conn(), &input).expect("import succeeds");
        assert_eq!(report.imported, 0);
        assert_eq!(report.preserved_only, 1);

        let stored =
            bip329_records::get_records_by_ref(db.conn(), "output", &format!("{TXID_A}:0"))
                .expect("query succeeds");
        assert_eq!(stored.len(), 1);
        assert!(stored[0].tracks_local_label);
    }

    #[test]
    fn existing_multi_origin_state_makes_new_supported_import_ambiguous() {
        let db = Database::open(":memory:").expect("db opens");
        let base_record = crate::bip329::Bip329Record {
            r#type: "tx".to_owned(),
            r#ref: TXID_A.to_owned(),
            label: Some("salary".to_owned()),
            origin: Some("wallet-a".to_owned()),
            spendable: None,
            extra: BTreeMap::from([(String::from("foo"), json!(1))]),
        };
        bip329_records::upsert_record(
            db.conn(),
            &base_record,
            &base_record.to_json_line().unwrap(),
            true,
        )
        .expect("seed succeeds");

        let preview = preview_bip329_jsonl(
            db.conn(),
            &format!(r#"{{"type":"tx","ref":"{TXID_A}","label":"salary","origin":"wallet-b"}}"#),
        )
        .expect("preview succeeds");

        assert_eq!(preview.ambiguous_supported, 1);
        assert_eq!(
            preview.lines[0].disposition,
            ImportDisposition::AmbiguousSupported
        );
    }

    #[test]
    fn prefer_local_keeps_existing_label_and_binds_preserved_origin_to_local_state() {
        let db = Database::open(":memory:").expect("db opens");
        labels::set_label(db.conn(), "tx", TXID_A, "local").expect("seed label");

        let report = import_bip329_jsonl_with_policy(
            db.conn(),
            &format!(
                r#"{{"type":"tx","ref":"{TXID_A}","label":"imported","origin":"wallet-a","custom":true}}"#
            ),
            ImportConflictPolicy::PreferLocal,
        )
        .expect("import succeeds");

        assert_eq!(report.imported, 0);
        assert_eq!(report.preserved_only, 1);

        let tx_label = labels::get_label(db.conn(), "tx", TXID_A)
            .expect("query succeeds")
            .expect("local label remains");
        assert_eq!(tx_label.label, "local");

        let stored =
            bip329_records::get_records_by_ref(db.conn(), "tx", TXID_A).expect("query succeeds");
        assert_eq!(stored.len(), 1);
        assert!(stored[0].tracks_local_label);
    }

    #[test]
    fn only_new_preserves_conflicting_supported_record_without_overwriting_local_label() {
        let db = Database::open(":memory:").expect("db opens");
        labels::set_label(db.conn(), "tx", TXID_A, "local").expect("seed label");

        let report = import_bip329_jsonl_with_policy(
            db.conn(),
            &format!(r#"{{"type":"tx","ref":"{TXID_A}","label":"imported"}}"#),
            ImportConflictPolicy::OnlyNew,
        )
        .expect("import succeeds");

        assert_eq!(report.imported, 0);
        assert_eq!(report.preserved_only, 1);

        let tx_label = labels::get_label(db.conn(), "tx", TXID_A)
            .expect("query succeeds")
            .expect("local label remains");
        assert_eq!(tx_label.label, "local");

        let stored =
            bip329_records::get_records_by_ref(db.conn(), "tx", TXID_A).expect("query succeeds");
        assert_eq!(stored.len(), 1);
        assert!(!stored[0].tracks_local_label);
    }
}
