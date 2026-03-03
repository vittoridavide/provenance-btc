import type { Edge, Node } from 'reactflow'
import type { GraphNode, ProvenanceGraph } from '../types/api'
import { mapCategoryToDisplayLabel, mapCategoryToPaletteKey, type CategoryPaletteKey } from './categoryPalette'

const NODE_X_SPACING = 400
const NODE_Y_SPACING = 180
const NODES_PER_ROW = 4
export type GraphFlowNodeLabelingState =
  | 'unlabeled'
  | 'partially-labeled'
  | 'fully-labeled'
  | 'conflicted'

export type GraphFlowNodeData = {
  label: string
  txid: string
  status: GraphNode['status']
  confirmations: number | null
  block_height: number | null
  block_time: number | null
  timestamp_label: string | null
  script_type: string | null
  vsize: number | null
  fee_sat: number | null
  is_root: boolean
  node_label: string | null
  classification_category: string | null
  classification_label: string | null
  classification_key: CategoryPaletteKey | null
  classification_state: GraphNode['classification_state']
  labeling_state: GraphFlowNodeLabelingState
  labeled_output_count: number
  total_output_count: number
  audit_unclassified: boolean
  category_palette_key: CategoryPaletteKey | null
  category_neutral_indicator: boolean
  missing_parents_count: number
}
export type GraphFlowEdgeData = {
  vinIndex: number
  label: string
}

export type GraphFlowEdge = Edge<GraphFlowEdgeData>

export type AdaptedGraph = {
  nodes: Node<GraphFlowNodeData>[]
  edges: GraphFlowEdge[]
}

export const TRANSACTION_NODE_TYPE = 'transaction'
export const TRANSACTION_EDGE_TYPE = 'transaction'

function compareNodes(a: GraphNode, b: GraphNode): number {
  if (a.is_root !== b.is_root) {
    return a.is_root ? -1 : 1
  }

  return a.txid.localeCompare(b.txid)
}

function nodeDisplayLabel(node: GraphNode): string {
  if (node.label && node.label.trim().length > 0) {
    return node.label
  }

  return `${node.txid.slice(0, 8)}…`
}

function mapClassificationStateToLabelingState(
  classificationState: GraphNode['classification_state'],
): GraphFlowNodeLabelingState {
  if (classificationState === 'Complete') {
    return 'fully-labeled'
  }
  if (classificationState === 'TxOnly') {
    return 'partially-labeled'
  }
  return 'unlabeled'
}

function toTimestampLabel(blockTime: number | null): string | null {
  if (blockTime === null || !Number.isFinite(blockTime)) {
    return null
  }
  const date = new Date(blockTime * 1000)
  if (!Number.isFinite(date.getTime())) {
    return null
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

export function adaptProvenanceGraphToReactFlow(graph: ProvenanceGraph): AdaptedGraph {
  const sortedNodes = [...graph.nodes].sort(compareNodes)
  const sortedEdges = [...graph.edges].sort((a, b) => {
    const bySource = a.from_txid.localeCompare(b.from_txid)
    if (bySource !== 0) return bySource

    const byTarget = a.to_txid.localeCompare(b.to_txid)
    if (byTarget !== 0) return byTarget

    return a.vin_index - b.vin_index
  })

  const nodes: Node<GraphFlowNodeData>[] = sortedNodes.map((node, index) => {
    const column = index % NODES_PER_ROW
    const row = Math.floor(index / NODES_PER_ROW)

    return {
      id: node.txid,
      type: TRANSACTION_NODE_TYPE,
      position: {
        x: column * NODE_X_SPACING,
        y: row * NODE_Y_SPACING,
      },
      data: {
        label: nodeDisplayLabel(node),
        txid: node.txid,
        status: node.status,
        confirmations: node.confirmations,
        block_height: node.height,
        block_time: node.time,
        timestamp_label: toTimestampLabel(node.time),
        script_type: null,
        vsize: null,
        fee_sat: null,
        is_root: node.is_root,
        node_label: node.label,
        classification_category: node.classification_category,
        classification_label: mapCategoryToDisplayLabel(node.classification_category),
        classification_key: mapCategoryToPaletteKey(node.classification_category),
        classification_state: node.classification_state,
        labeling_state: mapClassificationStateToLabelingState(node.classification_state),
        labeled_output_count: 0,
        total_output_count: 0,
        audit_unclassified: false,
        category_palette_key: null,
        category_neutral_indicator: false,
        missing_parents_count: node.missing_parents_count,
      },
    }
  })

  const edges: GraphFlowEdge[] = sortedEdges.map((edge) => ({
    id: `${edge.to_txid}-${edge.from_txid}-${edge.vin_index}`,
    source: edge.to_txid,
    target: edge.from_txid,
    type: TRANSACTION_EDGE_TYPE,
    data: {
      vinIndex: edge.vin_index,
      label: `vin ${edge.vin_index}`,
    },
  }))

  return { nodes, edges }
}
