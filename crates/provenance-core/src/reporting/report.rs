use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use time::{format_description::well_known::Rfc3339, OffsetDateTime};

use crate::api::types::{Classification, RefType, TxStatus};
use crate::{CoreError, Result};

use super::{
    GraphCompletenessWarning, GraphCompletenessWarningCode, GraphContextOutputRow,
    GraphContextTxNode, GraphExportContext,
};

const REPORT_SCHEMA_VERSION_V1: u32 = 1;
const TRANSACTIONS_COLUMNS_V1: &[&str] = &[
    "root_txid",
    "graph_depth",
    "txid",
    "status",
    "confirmations",
    "block_height",
    "block_time",
    "fee_sat",
    "feerate_sat_vb",
    "classification_category",
    "tax_relevant",
    "counterparty",
    "reference_id",
    "gl_category",
    "missing_parents_count",
];
const OUTPUTS_COLUMNS_V1: &[&str] = &[
    "root_txid",
    "graph_depth",
    "txid",
    "vout",
    "outpoint",
    "status",
    "block_height",
    "block_time",
    "value_sat",
    "address",
    "script_type",
    "output_label",
    "output_classification_category",
    "internal_change",
    "parent_tx_classification_category",
    "counterparty",
    "reference_id",
    "gl_category",
];
const EXCEPTIONS_COLUMNS_V1: &[&str] = &[
    "root_txid",
    "ref_type",
    "ref_id",
    "severity",
    "issue_code",
    "message",
];

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ReportKind {
    Transactions,
    Outputs,
    Exceptions,
}

impl ReportKind {
    fn columns(self) -> Vec<String> {
        match self {
            Self::Transactions => TRANSACTIONS_COLUMNS_V1,
            Self::Outputs => OUTPUTS_COLUMNS_V1,
            Self::Exceptions => EXCEPTIONS_COLUMNS_V1,
        }
        .iter()
        .map(|column| (*column).to_string())
        .collect()
    }

    fn schema_version(self) -> u32 {
        REPORT_SCHEMA_VERSION_V1
    }

    fn file_stem(self) -> &'static str {
        match self {
            Self::Transactions => "transactions",
            Self::Outputs => "outputs",
            Self::Exceptions => "exceptions",
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ReportScope {
    CurrentGraph,
}

impl ReportScope {
    fn file_stem(self) -> &'static str {
        match self {
            Self::CurrentGraph => "current-graph",
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub struct ReportRequest {
    pub kind: ReportKind,
    pub scope: ReportScope,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ReportSeverity {
    Error,
    Warning,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum ReportIssueCode {
    MissingParent,
    MempoolTransaction,
    UnclassifiedTransaction,
    UnclassifiedOutput,
    MissingTaxMetadata,
}

impl ReportIssueCode {
    fn as_str(self) -> &'static str {
        match self {
            Self::MissingParent => "missing_parent",
            Self::MempoolTransaction => "mempool_transaction",
            Self::UnclassifiedTransaction => "unclassified_transaction",
            Self::UnclassifiedOutput => "unclassified_output",
            Self::MissingTaxMetadata => "missing_tax_metadata",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ReportWarning {
    pub severity: ReportSeverity,
    pub issue_code: ReportIssueCode,
    pub ref_type: RefType,
    pub ref_id: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ReportManifest {
    pub report_kind: ReportKind,
    pub report_scope: ReportScope,
    pub schema_version: u32,
    pub row_count: u32,
    pub columns: Vec<String>,
    pub suggested_filename: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ReportPreview {
    pub manifest: ReportManifest,
    pub warnings: Vec<ReportWarning>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GeneratedReport {
    pub manifest: ReportManifest,
    pub warnings: Vec<ReportWarning>,
    pub csv_contents: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TransactionsReportRowV1 {
    pub root_txid: String,
    pub graph_depth: u32,
    pub txid: String,
    pub status: TxStatus,
    pub confirmations: Option<u32>,
    pub block_height: Option<u32>,
    pub block_time: Option<String>,
    pub fee_sat: Option<u64>,
    pub feerate_sat_vb: Option<f64>,
    pub classification_category: Option<String>,
    pub tax_relevant: Option<bool>,
    pub counterparty: Option<String>,
    pub reference_id: Option<String>,
    pub gl_category: Option<String>,
    pub missing_parents_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct OutputsReportRowV1 {
    pub root_txid: String,
    pub graph_depth: u32,
    pub txid: String,
    pub vout: u32,
    pub outpoint: String,
    pub status: TxStatus,
    pub block_height: Option<u32>,
    pub block_time: Option<String>,
    pub value_sat: u64,
    pub address: Option<String>,
    pub script_type: Option<String>,
    pub output_label: Option<String>,
    pub output_classification_category: Option<String>,
    pub internal_change: Option<bool>,
    pub parent_tx_classification_category: Option<String>,
    pub counterparty: Option<String>,
    pub reference_id: Option<String>,
    pub gl_category: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ExceptionsReportRowV1 {
    pub root_txid: String,
    pub ref_type: RefType,
    pub ref_id: String,
    pub severity: ReportSeverity,
    pub issue_code: ReportIssueCode,
    pub message: String,
}

pub fn preview_report(
    context: &GraphExportContext,
    request: &ReportRequest,
) -> Result<ReportPreview> {
    let warnings = collect_report_warnings(context);
    let rows = build_report_rows(context, request, &warnings);
    let manifest = build_manifest(context, request, rows.len() as u32);

    Ok(ReportPreview { manifest, warnings })
}

pub fn export_report_csv(
    context: &GraphExportContext,
    request: &ReportRequest,
) -> Result<GeneratedReport> {
    let warnings = collect_report_warnings(context);
    let rows = build_report_rows(context, request, &warnings);
    let csv_contents = rows.serialize_csv()?;
    let manifest = build_manifest(context, request, rows.len() as u32);

    Ok(GeneratedReport {
        manifest,
        warnings,
        csv_contents,
    })
}

fn build_manifest(
    context: &GraphExportContext,
    request: &ReportRequest,
    row_count: u32,
) -> ReportManifest {
    ReportManifest {
        report_kind: request.kind,
        report_scope: request.scope,
        schema_version: request.kind.schema_version(),
        row_count,
        columns: request.kind.columns(),
        suggested_filename: suggested_filename(context, request),
    }
}

fn suggested_filename(context: &GraphExportContext, request: &ReportRequest) -> String {
    format!(
        "provenance-{}-{}-{}.csv",
        request.kind.file_stem(),
        request.scope.file_stem(),
        context.root_txid
    )
}

fn build_report_rows(
    context: &GraphExportContext,
    request: &ReportRequest,
    warnings: &[ReportWarning],
) -> ReportRows {
    match request.kind {
        ReportKind::Transactions => ReportRows::Transactions(build_transactions_rows(context)),
        ReportKind::Outputs => ReportRows::Outputs(build_outputs_rows(context)),
        ReportKind::Exceptions => ReportRows::Exceptions(build_exceptions_rows(context, warnings)),
    }
}

fn build_transactions_rows(context: &GraphExportContext) -> Vec<TransactionsReportRowV1> {
    let mut rows = context
        .tx_nodes
        .iter()
        .map(|node| TransactionsReportRowV1 {
            root_txid: context.root_txid.clone(),
            graph_depth: node.graph_depth,
            txid: node.txid.clone(),
            status: node.status,
            confirmations: node.confirmations,
            block_height: node.height,
            block_time: format_timestamp(node.time),
            fee_sat: node.fee_sat,
            feerate_sat_vb: calculate_feerate(node.fee_sat, node.vsize),
            classification_category: classification_category(node.classification.as_ref()),
            tax_relevant: node
                .classification
                .as_ref()
                .map(|classification| classification.tax_relevant),
            counterparty: accounting_counterparty(node.classification.as_ref()),
            reference_id: accounting_reference_id(node.classification.as_ref()),
            gl_category: accounting_gl_category(node.classification.as_ref()),
            missing_parents_count: node.missing_parents_count,
        })
        .collect::<Vec<_>>();

    rows.sort_by(|a, b| {
        a.graph_depth
            .cmp(&b.graph_depth)
            .then_with(|| a.txid.cmp(&b.txid))
    });
    rows
}

fn build_outputs_rows(context: &GraphExportContext) -> Vec<OutputsReportRowV1> {
    let mut rows = context
        .output_rows
        .iter()
        .map(|row| OutputsReportRowV1 {
            root_txid: row.root_txid.clone(),
            graph_depth: row.graph_depth,
            txid: row.txid.clone(),
            vout: row.vout,
            outpoint: row.outpoint.clone(),
            status: row.tx_status,
            block_height: row.block_height,
            block_time: format_timestamp(row.block_time),
            value_sat: row.value_sat,
            address: clean_optional_str(row.address.as_deref()),
            script_type: clean_optional_str(row.script_type.as_deref()),
            // The current desktop detail flow stores local-only notes in the label field.
            // Keep the contract column in place, but do not export those notes in v1.
            output_label: None,
            output_classification_category: classification_category(row.classification.as_ref()),
            internal_change: output_internal_change(row),
            parent_tx_classification_category: classification_category(
                row.tx_classification.as_ref(),
            ),
            counterparty: accounting_counterparty(row.tx_classification.as_ref()),
            reference_id: accounting_reference_id(row.tx_classification.as_ref()),
            gl_category: accounting_gl_category(row.tx_classification.as_ref()),
        })
        .collect::<Vec<_>>();

    rows.sort_by(|a, b| {
        a.graph_depth
            .cmp(&b.graph_depth)
            .then_with(|| a.txid.cmp(&b.txid))
            .then_with(|| a.vout.cmp(&b.vout))
    });
    rows
}

fn build_exceptions_rows(
    context: &GraphExportContext,
    warnings: &[ReportWarning],
) -> Vec<ExceptionsReportRowV1> {
    warnings
        .iter()
        .map(|warning| ExceptionsReportRowV1 {
            root_txid: context.root_txid.clone(),
            ref_type: warning.ref_type,
            ref_id: warning.ref_id.clone(),
            severity: warning.severity,
            issue_code: warning.issue_code,
            message: warning.message.clone(),
        })
        .collect()
}

fn collect_report_warnings(context: &GraphExportContext) -> Vec<ReportWarning> {
    let mut warnings = context
        .warnings
        .iter()
        .map(report_warning_from_graph_warning)
        .collect::<Vec<_>>();

    warnings.extend(
        context
            .tx_nodes
            .iter()
            .filter_map(missing_tax_metadata_warning),
    );

    warnings.sort_by(|a, b| {
        severity_rank(a.severity)
            .cmp(&severity_rank(b.severity))
            .then_with(|| ref_type_rank(a.ref_type).cmp(&ref_type_rank(b.ref_type)))
            .then_with(|| a.ref_id.cmp(&b.ref_id))
            .then_with(|| a.issue_code.as_str().cmp(b.issue_code.as_str()))
            .then_with(|| a.message.cmp(&b.message))
    });
    warnings
}

fn report_warning_from_graph_warning(warning: &GraphCompletenessWarning) -> ReportWarning {
    let (severity, issue_code) = match warning.code {
        GraphCompletenessWarningCode::MissingParent => {
            (ReportSeverity::Error, ReportIssueCode::MissingParent)
        }
        GraphCompletenessWarningCode::MempoolTransaction => {
            (ReportSeverity::Warning, ReportIssueCode::MempoolTransaction)
        }
        GraphCompletenessWarningCode::UnclassifiedTransaction => (
            ReportSeverity::Warning,
            ReportIssueCode::UnclassifiedTransaction,
        ),
        GraphCompletenessWarningCode::UnclassifiedOutput => {
            (ReportSeverity::Warning, ReportIssueCode::UnclassifiedOutput)
        }
    };

    ReportWarning {
        severity,
        issue_code,
        ref_type: warning.ref_type,
        ref_id: warning.ref_id.clone(),
        message: warning.message.clone(),
    }
}

fn missing_tax_metadata_warning(node: &GraphContextTxNode) -> Option<ReportWarning> {
    let classification = node.classification.as_ref()?;
    if !classification.tax_relevant {
        return None;
    }

    let missing_category = classification.category.trim().is_empty();
    let counterparty = accounting_counterparty(Some(classification));
    let reference_id = accounting_reference_id(Some(classification));
    let gl_category = accounting_gl_category(Some(classification));
    let missing_accounting_identifiers =
        counterparty.is_none() && reference_id.is_none() && gl_category.is_none();

    if !missing_category && !missing_accounting_identifiers {
        return None;
    }

    let message = if missing_category {
        format!(
            "tax-relevant transaction '{}' is missing a classification category",
            node.txid
        )
    } else {
        format!(
            "tax-relevant transaction '{}' is missing all accounting identifiers",
            node.txid
        )
    };

    Some(ReportWarning {
        severity: ReportSeverity::Warning,
        issue_code: ReportIssueCode::MissingTaxMetadata,
        ref_type: RefType::Tx,
        ref_id: node.txid.clone(),
        message,
    })
}

fn severity_rank(severity: ReportSeverity) -> u8 {
    match severity {
        ReportSeverity::Error => 0,
        ReportSeverity::Warning => 1,
    }
}

fn ref_type_rank(ref_type: RefType) -> u8 {
    match ref_type {
        RefType::Tx => 0,
        RefType::Output => 1,
    }
}

fn output_internal_change(row: &GraphContextOutputRow) -> Option<bool> {
    read_metadata_bool(row.classification.as_ref(), "internal_change")
}

fn accounting_counterparty(classification: Option<&Classification>) -> Option<String> {
    read_metadata_string_any(classification, &["counterparty"])
}

fn accounting_reference_id(classification: Option<&Classification>) -> Option<String> {
    read_metadata_string_any(
        classification,
        &["invoice_id", "external_ref", "invoice_reference_id"],
    )
}

fn accounting_gl_category(classification: Option<&Classification>) -> Option<String> {
    read_metadata_string_any(classification, &["gl_category"])
}

fn classification_category(classification: Option<&Classification>) -> Option<String> {
    classification.and_then(|classification| clean_optional_str(Some(&classification.category)))
}

fn read_metadata_string_any(
    classification: Option<&Classification>,
    keys: &[&str],
) -> Option<String> {
    keys.iter()
        .find_map(|key| read_metadata_value(classification, key).and_then(value_to_string))
}

fn read_metadata_bool(classification: Option<&Classification>, key: &str) -> Option<bool> {
    match read_metadata_value(classification, key) {
        Some(Value::Bool(value)) => Some(*value),
        Some(Value::String(value)) => match value.trim().to_ascii_lowercase().as_str() {
            "true" => Some(true),
            "false" => Some(false),
            _ => None,
        },
        Some(Value::Number(value)) => {
            if value.as_i64() == Some(1) {
                Some(true)
            } else if value.as_i64() == Some(0) {
                Some(false)
            } else {
                None
            }
        }
        _ => None,
    }
}

fn read_metadata_value<'a>(
    classification: Option<&'a Classification>,
    key: &str,
) -> Option<&'a Value> {
    metadata_object(classification?).and_then(|metadata| metadata.get(key))
}

fn metadata_object(classification: &Classification) -> Option<&Map<String, Value>> {
    classification.metadata.as_object()
}

fn value_to_string(value: &Value) -> Option<String> {
    match value {
        Value::String(value) => clean_optional_str(Some(value)),
        Value::Number(value) => Some(value.to_string()),
        Value::Bool(value) => Some(value.to_string()),
        _ => None,
    }
}

fn clean_optional_str(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

fn calculate_feerate(fee_sat: Option<u64>, vsize: Option<u64>) -> Option<f64> {
    let fee_sat = fee_sat?;
    let vsize = vsize?;
    if vsize == 0 {
        return None;
    }
    Some(fee_sat as f64 / vsize as f64)
}

fn format_timestamp(timestamp: Option<u64>) -> Option<String> {
    let timestamp = i64::try_from(timestamp?).ok()?;
    let datetime = OffsetDateTime::from_unix_timestamp(timestamp).ok()?;
    datetime.format(&Rfc3339).ok()
}

enum ReportRows {
    Transactions(Vec<TransactionsReportRowV1>),
    Outputs(Vec<OutputsReportRowV1>),
    Exceptions(Vec<ExceptionsReportRowV1>),
}

impl ReportRows {
    fn len(&self) -> usize {
        match self {
            Self::Transactions(rows) => rows.len(),
            Self::Outputs(rows) => rows.len(),
            Self::Exceptions(rows) => rows.len(),
        }
    }

    fn serialize_csv(&self) -> Result<String> {
        let mut writer = csv::WriterBuilder::new()
            .has_headers(false)
            .from_writer(Vec::new());
        writer
            .write_record(self.headers())
            .map_err(|err| CoreError::Other(format!("failed to write CSV header: {err}")))?;

        match self {
            Self::Transactions(rows) => serialize_csv_rows(&mut writer, rows)?,
            Self::Outputs(rows) => serialize_csv_rows(&mut writer, rows)?,
            Self::Exceptions(rows) => serialize_csv_rows(&mut writer, rows)?,
        }

        let bytes = writer
            .into_inner()
            .map_err(|err| CoreError::Other(format!("failed to finalize CSV writer: {err}")))?;
        String::from_utf8(bytes)
            .map_err(|err| CoreError::Other(format!("generated CSV is not valid UTF-8: {err}")))
    }

    fn headers(&self) -> &'static [&'static str] {
        match self {
            Self::Transactions(_) => TRANSACTIONS_COLUMNS_V1,
            Self::Outputs(_) => OUTPUTS_COLUMNS_V1,
            Self::Exceptions(_) => EXCEPTIONS_COLUMNS_V1,
        }
    }
}

fn serialize_csv_rows<W: std::io::Write, T: Serialize>(
    writer: &mut csv::Writer<W>,
    rows: &[T],
) -> Result<()> {
    for row in rows {
        writer
            .serialize(row)
            .map_err(|err| CoreError::Other(format!("failed to serialize CSV row: {err}")))?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use crate::api::types::{Classification, GraphSummary};

    use super::{
        build_outputs_rows, build_transactions_rows, export_report_csv, preview_report,
        GraphCompletenessWarning, GraphCompletenessWarningCode, GraphContextOutputRow,
        GraphContextTxNode, GraphExportContext, ReportIssueCode, ReportKind, ReportRequest,
        ReportScope, ReportSeverity,
    };
    use crate::api::types::{ClassificationState, RefType, TxStatus};

    const ROOT_TXID: &str = "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
    const MEMPOOL_TXID: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const MISSING_TXID: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

    #[test]
    fn preview_and_export_transactions_report_include_deterministic_manifest_and_warnings() {
        let context = sample_context();
        let request = ReportRequest {
            kind: ReportKind::Transactions,
            scope: ReportScope::CurrentGraph,
        };

        let preview = preview_report(&context, &request).expect("preview builds");
        assert_eq!(preview.manifest.schema_version, 1);
        assert_eq!(preview.manifest.row_count, 3);
        assert_eq!(
            preview.manifest.suggested_filename,
            format!("provenance-transactions-current-graph-{ROOT_TXID}.csv")
        );
        assert_eq!(
            preview.manifest.columns,
            vec![
                "root_txid",
                "graph_depth",
                "txid",
                "status",
                "confirmations",
                "block_height",
                "block_time",
                "fee_sat",
                "feerate_sat_vb",
                "classification_category",
                "tax_relevant",
                "counterparty",
                "reference_id",
                "gl_category",
                "missing_parents_count",
            ]
        );

        let warning_codes = preview
            .warnings
            .iter()
            .map(|warning| warning.issue_code)
            .collect::<Vec<_>>();
        assert_eq!(
            warning_codes,
            vec![
                ReportIssueCode::MissingParent,
                ReportIssueCode::MempoolTransaction,
                ReportIssueCode::MissingTaxMetadata,
                ReportIssueCode::UnclassifiedOutput,
            ]
        );

        let report = export_report_csv(&context, &request).expect("report exports");
        let mut reader = csv::Reader::from_reader(report.csv_contents.as_bytes());
        let headers = reader.headers().expect("headers").clone();
        assert_eq!(
            headers,
            csv::StringRecord::from(vec![
                "root_txid",
                "graph_depth",
                "txid",
                "status",
                "confirmations",
                "block_height",
                "block_time",
                "fee_sat",
                "feerate_sat_vb",
                "classification_category",
                "tax_relevant",
                "counterparty",
                "reference_id",
                "gl_category",
                "missing_parents_count",
            ])
        );

        let rows = reader
            .records()
            .map(|row| row.expect("row"))
            .collect::<Vec<_>>();
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0].get(2), Some(ROOT_TXID));
        assert_eq!(rows[0].get(6), Some("2023-11-14T22:13:20Z"));
        assert_eq!(rows[0].get(9), Some("Income"));
        assert_eq!(rows[0].get(10), Some("true"));
        assert_eq!(rows[0].get(11), Some("Alice"));
        assert_eq!(rows[0].get(12), Some("INV-42"));
        assert_eq!(rows[0].get(13), Some("income"));
        assert_eq!(rows[0].get(14), Some("1"));

        assert_eq!(rows[1].get(2), Some(MEMPOOL_TXID));
        assert_eq!(rows[1].get(3), Some("mempool"));
        assert_eq!(rows[1].get(10), Some("true"));
        assert_eq!(rows[1].get(11), Some(""));
        assert_eq!(rows[1].get(12), Some(""));
        assert_eq!(rows[1].get(13), Some(""));

        assert_eq!(rows[2].get(2), Some(MISSING_TXID));
        assert_eq!(rows[2].get(3), Some("missing"));
        assert_eq!(rows[2].get(6), Some(""));
    }

    #[test]
    fn outputs_report_keeps_internal_notes_local_only_and_carries_parent_accounting_metadata() {
        let context = sample_context();

        let rows = build_outputs_rows(&context);
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0].txid, ROOT_TXID);
        assert_eq!(rows[0].vout, 0);
        assert_eq!(rows[0].output_label, None);
        assert_eq!(
            rows[0].output_classification_category.as_deref(),
            Some("Owned")
        );
        assert_eq!(rows[0].internal_change, Some(true));
        assert_eq!(
            rows[0].parent_tx_classification_category.as_deref(),
            Some("Income")
        );
        assert_eq!(rows[0].counterparty.as_deref(), Some("Alice"));
        assert_eq!(rows[0].reference_id.as_deref(), Some("INV-42"));
        assert_eq!(rows[0].gl_category.as_deref(), Some("income"));

        assert_eq!(rows[1].txid, ROOT_TXID);
        assert_eq!(rows[1].vout, 1);
        assert_eq!(rows[1].output_classification_category, None);
        assert_eq!(rows[1].output_label, None);

        let request = ReportRequest {
            kind: ReportKind::Outputs,
            scope: ReportScope::CurrentGraph,
        };
        let report = export_report_csv(&context, &request).expect("report exports");
        let mut reader = csv::Reader::from_reader(report.csv_contents.as_bytes());
        let records = reader
            .records()
            .map(|row| row.expect("row"))
            .collect::<Vec<_>>();
        assert_eq!(records[0].get(11), Some(""));
        assert_eq!(records[0].get(12), Some("Owned"));
        assert_eq!(records[0].get(13), Some("true"));
        assert_eq!(records[0].get(15), Some("Alice"));
        assert_eq!(records[0].get(16), Some("INV-42"));
        assert_eq!(records[0].get(17), Some("income"));
    }

    #[test]
    fn exceptions_report_rows_line_up_with_preview_warnings() {
        let context = sample_context();
        let request = ReportRequest {
            kind: ReportKind::Exceptions,
            scope: ReportScope::CurrentGraph,
        };

        let preview = preview_report(&context, &request).expect("preview builds");
        let report = export_report_csv(&context, &request).expect("report exports");
        assert_eq!(preview.manifest.row_count as usize, preview.warnings.len());

        let mut reader = csv::Reader::from_reader(report.csv_contents.as_bytes());
        let records = reader
            .records()
            .map(|row| row.expect("row"))
            .collect::<Vec<_>>();
        assert_eq!(records.len(), preview.warnings.len());
        assert_eq!(records[0].get(1), Some("tx"));
        assert_eq!(records[0].get(2), Some(ROOT_TXID));
        assert_eq!(records[0].get(3), Some("error"));
        assert_eq!(records[0].get(4), Some("missing_parent"));

        assert_eq!(records[1].get(2), Some(MEMPOOL_TXID));
        assert_eq!(records[1].get(4), Some("mempool_transaction"));
        assert_eq!(records[2].get(2), Some(MEMPOOL_TXID));
        assert_eq!(records[2].get(4), Some("missing_tax_metadata"));
        assert_eq!(records[3].get(1), Some("output"));
        let output_ref = format!("{ROOT_TXID}:1");
        assert_eq!(records[3].get(2), Some(output_ref.as_str()));
        assert_eq!(records[3].get(4), Some("unclassified_output"));
    }

    #[test]
    fn missing_tax_metadata_only_triggers_for_tax_relevant_transactions_with_no_identifiers() {
        let context = sample_context();
        let rows = build_transactions_rows(&context);
        assert_eq!(rows[0].txid, ROOT_TXID);
        assert_eq!(rows[1].txid, MEMPOOL_TXID);
        assert_eq!(rows[1].tax_relevant, Some(true));

        let preview = preview_report(
            &context,
            &ReportRequest {
                kind: ReportKind::Transactions,
                scope: ReportScope::CurrentGraph,
            },
        )
        .expect("preview builds");

        let missing_tax = preview
            .warnings
            .iter()
            .filter(|warning| warning.issue_code == ReportIssueCode::MissingTaxMetadata)
            .collect::<Vec<_>>();
        assert_eq!(missing_tax.len(), 1);
        assert_eq!(missing_tax[0].ref_id, MEMPOOL_TXID);
        assert_eq!(missing_tax[0].severity, ReportSeverity::Warning);
    }

    fn sample_context() -> GraphExportContext {
        GraphExportContext {
            root_txid: ROOT_TXID.to_string(),
            traversal_depth: 2,
            tx_nodes: vec![
                GraphContextTxNode {
                    graph_depth: 0,
                    txid: ROOT_TXID.to_string(),
                    status: TxStatus::Confirmed,
                    confirmations: Some(12),
                    height: Some(810_000),
                    time: Some(1_700_000_000),
                    vsize: Some(100),
                    fee_sat: Some(1_000),
                    is_root: true,
                    label: Some("root private note".to_string()),
                    classification: Some(Classification {
                        category: "Income".to_string(),
                        context: String::new(),
                        metadata: json!({
                            "counterparty": "Alice",
                            "invoice_id": "INV-42",
                            "gl_category": "income",
                            "notes": "keep local"
                        }),
                        tax_relevant: true,
                    }),
                    classification_state: ClassificationState::TxOnly,
                    missing_parents_count: 1,
                },
                GraphContextTxNode {
                    graph_depth: 1,
                    txid: MEMPOOL_TXID.to_string(),
                    status: TxStatus::Mempool,
                    confirmations: Some(0),
                    height: None,
                    time: None,
                    vsize: Some(200),
                    fee_sat: Some(500),
                    is_root: false,
                    label: None,
                    classification: Some(Classification {
                        category: "Expense".to_string(),
                        context: String::new(),
                        metadata: json!({}),
                        tax_relevant: true,
                    }),
                    classification_state: ClassificationState::TxOnly,
                    missing_parents_count: 0,
                },
                GraphContextTxNode {
                    graph_depth: 2,
                    txid: MISSING_TXID.to_string(),
                    status: TxStatus::Missing,
                    confirmations: None,
                    height: None,
                    time: None,
                    vsize: None,
                    fee_sat: None,
                    is_root: false,
                    label: None,
                    classification: None,
                    classification_state: ClassificationState::None,
                    missing_parents_count: 0,
                },
            ],
            output_rows: vec![
                GraphContextOutputRow {
                    root_txid: ROOT_TXID.to_string(),
                    graph_depth: 0,
                    txid: ROOT_TXID.to_string(),
                    vout: 0,
                    outpoint: format!("{ROOT_TXID}:0"),
                    tx_status: TxStatus::Confirmed,
                    block_height: Some(810_000),
                    block_time: Some(1_700_000_000),
                    value_sat: 75_000,
                    address: Some("bc1qrootoutput0".to_string()),
                    script_type: Some("p2wpkh".to_string()),
                    label: Some("local-only note".to_string()),
                    classification: Some(Classification {
                        category: "Owned".to_string(),
                        context: String::new(),
                        metadata: json!({
                            "internal_change": true
                        }),
                        tax_relevant: false,
                    }),
                    tx_label: Some("root private note".to_string()),
                    tx_classification: Some(Classification {
                        category: "Income".to_string(),
                        context: String::new(),
                        metadata: json!({
                            "counterparty": "Alice",
                            "invoice_id": "INV-42",
                            "gl_category": "income"
                        }),
                        tax_relevant: true,
                    }),
                },
                GraphContextOutputRow {
                    root_txid: ROOT_TXID.to_string(),
                    graph_depth: 0,
                    txid: ROOT_TXID.to_string(),
                    vout: 1,
                    outpoint: format!("{ROOT_TXID}:1"),
                    tx_status: TxStatus::Confirmed,
                    block_height: Some(810_000),
                    block_time: Some(1_700_000_000),
                    value_sat: 25_000,
                    address: Some("bc1qrootoutput1".to_string()),
                    script_type: Some("p2tr".to_string()),
                    label: Some("second local-only note".to_string()),
                    classification: None,
                    tx_label: Some("root private note".to_string()),
                    tx_classification: Some(Classification {
                        category: "Income".to_string(),
                        context: String::new(),
                        metadata: json!({
                            "counterparty": "Alice",
                            "invoice_id": "INV-42",
                            "gl_category": "income"
                        }),
                        tax_relevant: true,
                    }),
                },
                GraphContextOutputRow {
                    root_txid: ROOT_TXID.to_string(),
                    graph_depth: 1,
                    txid: MEMPOOL_TXID.to_string(),
                    vout: 0,
                    outpoint: format!("{MEMPOOL_TXID}:0"),
                    tx_status: TxStatus::Mempool,
                    block_height: None,
                    block_time: None,
                    value_sat: 10_000,
                    address: Some("bc1qmempooloutput0".to_string()),
                    script_type: Some("p2wpkh".to_string()),
                    label: None,
                    classification: Some(Classification {
                        category: "External".to_string(),
                        context: String::new(),
                        metadata: json!({}),
                        tax_relevant: false,
                    }),
                    tx_label: None,
                    tx_classification: Some(Classification {
                        category: "Expense".to_string(),
                        context: String::new(),
                        metadata: json!({}),
                        tax_relevant: true,
                    }),
                },
            ],
            edges: Vec::new(),
            warnings: vec![
                GraphCompletenessWarning {
                    code: GraphCompletenessWarningCode::MissingParent,
                    ref_type: RefType::Tx,
                    ref_id: ROOT_TXID.to_string(),
                    message: "missing parent during ancestry walk".to_string(),
                },
                GraphCompletenessWarning {
                    code: GraphCompletenessWarningCode::MempoolTransaction,
                    ref_type: RefType::Tx,
                    ref_id: MEMPOOL_TXID.to_string(),
                    message: "transaction is unconfirmed".to_string(),
                },
                GraphCompletenessWarning {
                    code: GraphCompletenessWarningCode::UnclassifiedOutput,
                    ref_type: RefType::Output,
                    ref_id: format!("{ROOT_TXID}:1"),
                    message: "output has no classification".to_string(),
                },
            ],
            summary: GraphSummary::default(),
        }
    }
}
