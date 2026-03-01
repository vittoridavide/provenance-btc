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

