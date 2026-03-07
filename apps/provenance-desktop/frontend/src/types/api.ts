/**
 * NOTE:
 * Keep these interfaces manually in sync with
 * crates/provenance-core/src/api/types.rs
 */

export type TxStatus = 'confirmed' | 'mempool' | 'missing'

export type ClassificationState = 'None' | 'TxOnly' | 'Complete'

export type RefType = 'tx' | 'output'

export type GraphBuildOptions = Record<string, never>

export interface Classification {
  category: string
  context: string
  metadata: Record<string, unknown>
  tax_relevant: boolean
}

export interface GraphNode {
  txid: string
  status: TxStatus
  confirmations: number | null
  height: number | null
  time: number | null
  vsize: number | null
  fee_sat: number | null
  is_root: boolean
  label: string | null
  classification_category: string | null
  classification_state: ClassificationState
  missing_parents_count: number
}

export interface GraphEdge {
  from_txid: string
  to_txid: string
  vin_index: number
}

export interface GraphSummary {
  total_nodes: number
  unclassified_nodes: number
  missing_parent_edges: number
  confirmed_nodes: number
  mempool_nodes: number
}

export interface ProvenanceSetup {
  args: {
    url: string;
    username: string | null;
    password: string | null;
  }
}

export interface ProvenanceGraph {
  nodes: GraphNode[]
  edges: GraphEdge[]
  summary: GraphSummary
}

export interface TxInput {
  vin: number
  prev_txid: string
  prev_vout: number
  value_sat: number | null
  script_pubkey_hex: string
  script_type: string | null
  script_sig_hex: string
  witness_items_count: number
  witness_hex: string[]
  is_coinbase: boolean
}

export interface TxOutput {
  vout: number
  value_sat: number
  script_pubkey_hex: string
  script_type: string | null
  address: string | null
  label: string | null
  classification: Classification | null
}

export interface TransactionDetail {
  txid: string
  hex: string
  version: number
  lock_time: number
  weight: number
  vsize: number
  fee_sat: number | null
  feerate_sat_vb: number | null
  confirmations: number | null
  blockhash: string | null
  block_height: number | null
  block_time: number | null
  inputs: TxInput[]
  outputs: TxOutput[]
  label: string | null
  classification: Classification | null
}

export interface ImportSummary {
  imported: number
  skipped: number
  errors: string[]
}

export type ReportKind = 'transactions' | 'outputs' | 'exceptions'

export type ReportScope = 'current_graph'

export interface GraphExportContextRequest {
  root_txid: string
  traversal_depth: number
}

export interface ReportRequest {
  kind: ReportKind
  scope: ReportScope
}

export type ReportSeverity = 'error' | 'warning'

export type ReportIssueCode =
  | 'missing_parent'
  | 'mempool_transaction'
  | 'unclassified_transaction'
  | 'unclassified_output'
  | 'missing_tax_metadata'

export interface ReportWarning {
  severity: ReportSeverity
  issue_code: ReportIssueCode
  ref_type: RefType
  ref_id: string
  message: string
}

export interface ReportManifest {
  report_kind: ReportKind
  report_scope: ReportScope
  schema_version: number
  row_count: number
  columns: string[]
  suggested_filename: string
}

export interface ReportPreviewRequest {
  graph: GraphExportContextRequest
  report: ReportRequest
}

export interface ReportPreviewResponse {
  manifest: ReportManifest
  warnings: ReportWarning[]
}

export interface ReportExportRequest {
  graph: GraphExportContextRequest
  report: ReportRequest
}

export interface ReportExportResult {
  manifest: ReportManifest
  warnings: ReportWarning[]
  csv_contents: string
}

export type Bip329ImportDisposition =
  | 'apply_supported'
  | 'preserve_only'
  | 'ambiguous_supported'
  | 'invalid'
  | 'ignored_unsupported'

export interface Bip329ImportPreviewLine {
  line_number: number
  disposition: Bip329ImportDisposition
  record_type: string | null
  record_ref: string | null
  origin: string | null
  message: string | null
}

export interface Bip329ImportPreviewRequest {
  jsonl_contents: string
}

export interface Bip329ImportPreviewResponse {
  total_lines: number
  apply_supported: number
  preserve_only: number
  ambiguous_supported: number
  invalid: number
  ignored_unsupported: number
  lines: Bip329ImportPreviewLine[]
}

export interface Bip329ImportApplyRequest {
  jsonl_contents: string
}

export interface Bip329ImportErrorLine {
  line_number: number
  message: string
}

export interface Bip329ImportApplyResult {
  total_lines: number
  imported: number
  preserved_only: number
  ambiguous_supported: number
  skipped_unsupported_type: number
  skipped_invalid: number
  errors: Bip329ImportErrorLine[]
}

export interface Bip329ExportResult {
  suggested_filename: string
  record_count: number
  supported_label_count: number
  preserved_record_count: number
  jsonl_contents: string
}

