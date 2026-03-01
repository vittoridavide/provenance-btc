import type { Edge, Node } from 'reactflow'
import type { GraphNode, ProvenanceGraph } from '../types/api'
import type { CategoryPaletteKey } from './categoryPalette'

const NODE_X_SPACING = 260
const NODE_Y_SPACING = 170
const NODES_PER_ROW = 4

export type GraphFlowNodeData = {
  label: string
  txid: string
  status: GraphNode['status']
  confirmations: number | null
  height: number | null
  time: number | null
  is_root: boolean
  node_label: string | null
  classification_category: string | null
  classification_state: GraphNode['classification_state']
  audit_unclassified: boolean
  category_palette_key: CategoryPaletteKey | null
  category_neutral_indicator: boolean
  missing_parents_count: number
}

export type AdaptedGraph = {
  nodes: Node<GraphFlowNodeData>[]
  edges: Edge[]
}

export const TRANSACTION_NODE_TYPE = 'transaction'

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
        height: node.height,
        time: node.time,
        is_root: node.is_root,
        node_label: node.label,
        classification_category: node.classification_category,
        classification_state: node.classification_state,
        audit_unclassified: false,
        category_palette_key: null,
        category_neutral_indicator: false,
        missing_parents_count: node.missing_parents_count,
      },
    }
  })

  const edges: Edge[] = sortedEdges.map((edge) => ({
    id: `${edge.from_txid}-${edge.to_txid}-${edge.vin_index}`,
    source: edge.from_txid,
    target: edge.to_txid,
  }))

  return { nodes, edges }
}
