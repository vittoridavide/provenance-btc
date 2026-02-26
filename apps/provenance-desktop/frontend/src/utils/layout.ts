import dagre from 'dagre'
import type { Edge, Node } from 'reactflow'

const DEFAULT_NODE_WIDTH = 220
const DEFAULT_NODE_HEIGHT = 96
const DEFAULT_RANK_SEP = 120
const DEFAULT_NODE_SEP = 72

type DagreLayoutOptions = {
  nodeWidth?: number
  nodeHeight?: number
  rankSep?: number
  nodeSep?: number
}

function edgeSortKey(edge: Edge): string {
  return `${edge.source}::${edge.target}::${edge.id}`
}

function resolveNodeSize<TNodeData>(
  node: Node<TNodeData>,
  fallbackWidth: number,
  fallbackHeight: number,
) {
  const measuredWidth = node.width
  const measuredHeight = node.height

  return {
    width: measuredWidth ?? fallbackWidth,
    height: measuredHeight ?? fallbackHeight,
  }
}

export function layoutGraphLeftToRight<TNodeData>(
  nodes: Node<TNodeData>[],
  edges: Edge[],
  options: DagreLayoutOptions = {},
): Node<TNodeData>[] {
  if (nodes.length === 0) {
    return []
  }

  const nodeWidth = options.nodeWidth ?? DEFAULT_NODE_WIDTH
  const nodeHeight = options.nodeHeight ?? DEFAULT_NODE_HEIGHT
  const rankSep = options.rankSep ?? DEFAULT_RANK_SEP
  const nodeSep = options.nodeSep ?? DEFAULT_NODE_SEP

  const graph = new dagre.graphlib.Graph()
  graph.setDefaultEdgeLabel(() => ({}))
  graph.setGraph({
    rankdir: 'LR',
    ranksep: rankSep,
    nodesep: nodeSep,
  })

  const sortedNodes = [...nodes].sort((a, b) => a.id.localeCompare(b.id))
  const sortedEdges = [...edges].sort((a, b) => edgeSortKey(a).localeCompare(edgeSortKey(b)))
  const nodeIds = new Set(sortedNodes.map((node) => node.id))

  for (const node of sortedNodes) {
    const size = resolveNodeSize(node, nodeWidth, nodeHeight)
    graph.setNode(node.id, {
      width: size.width,
      height: size.height,
    })
  }

  for (const edge of sortedEdges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      continue
    }

    graph.setEdge(edge.source, edge.target)
  }

  dagre.layout(graph)

  return sortedNodes.map((node) => {
    const size = resolveNodeSize(node, nodeWidth, nodeHeight)
    const positionedNode = graph.node(node.id)

    return {
      ...node,
      position: {
        x: positionedNode.x - size.width / 2,
        y: positionedNode.y - size.height / 2,
      },
    }
  })
}
