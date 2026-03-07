pub mod types;

use rusqlite::Connection;

use crate::reporting::{self, build_graph_export_context, GraphExportContext, TxViewProvider};
use crate::Result;

pub fn preview_report<P: TxViewProvider>(
    rpc: &P,
    conn: &Connection,
    request: &types::ReportPreviewRequest,
) -> Result<types::ReportPreviewResponse> {
    let context = build_graph_export_context(rpc, conn, &request.graph)?;
    preview_report_for_context(&context, &request.report)
}

pub fn preview_report_for_context(
    context: &GraphExportContext,
    request: &types::ReportRequest,
) -> Result<types::ReportPreviewResponse> {
    reporting::preview_report(context, request)
}

pub fn export_report<P: TxViewProvider>(
    rpc: &P,
    conn: &Connection,
    request: &types::ReportExportRequest,
) -> Result<types::ReportExportResult> {
    let context = build_graph_export_context(rpc, conn, &request.graph)?;
    export_report_for_context(&context, &request.report)
}

pub fn export_report_for_context(
    context: &GraphExportContext,
    request: &types::ReportRequest,
) -> Result<types::ReportExportResult> {
    reporting::export_report_csv(context, request)
}

#[cfg(feature = "store-sqlite")]
pub fn preview_bip329_import(
    conn: &Connection,
    request: &types::Bip329ImportPreviewRequest,
) -> Result<types::Bip329ImportPreviewResponse> {
    crate::bip329::preview_bip329_jsonl(conn, &request.jsonl_contents)
}

#[cfg(feature = "store-sqlite")]
pub fn apply_bip329_import(
    conn: &Connection,
    request: &types::Bip329ImportApplyRequest,
) -> Result<types::Bip329ImportApplyResult> {
    crate::bip329::import_bip329_jsonl(conn, &request.jsonl_contents)
}

#[cfg(feature = "store-sqlite")]
pub fn export_bip329(conn: &Connection) -> Result<types::Bip329ExportResult> {
    let generated = crate::bip329::export_bip329(conn)?;
    Ok(types::Bip329ExportResult {
        suggested_filename: "provenance-bip329-labels.jsonl".to_string(),
        record_count: generated.record_count,
        supported_label_count: generated.supported_label_count,
        preserved_record_count: generated.preserved_record_count,
        jsonl_contents: generated.jsonl_contents,
    })
}
