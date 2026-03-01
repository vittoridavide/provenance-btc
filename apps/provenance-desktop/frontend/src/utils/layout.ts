import dagre from 'dagre'
import type { Edge, Node } from 'reactflow'
import type { GraphLayoutMode } from '../state/graphControls'

const DEFAULT_NODE_WIDTH = 220
const DEFAULT_NODE_HEIGHT = 96
const DEFAULT_RANK_SEP = 120
const DEFAULT_NODE_SEP = 72
const DEFAULT_RADIAL_RING_GAP = 240
const DEFAULT_RADIAL_MIN_NODES_PER_RING = 6
const FULL_CIRCLE_RADIANS = Math.PI * 2

type DagreLayoutOptions = {
  nodeWidth?: number
  nodeHeight?: number
  rankSep?: number
  nodeSep?: number
  radialRingGap?: number
  radialMinNodesPerRing?: number
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

function sortedGraphElements<TNodeData>(nodes: Node<TNodeData>[], edges: Edge[]) {
  return {
    sortedNodes: [...nodes].sort((a, b) => a.id.localeCompare(b.id)),
    sortedEdges: [...edges].sort((a, b) => edgeSortKey(a).localeCompare(edgeSortKey(b))),
  }
}

function layoutGraphWithDagreRankdir<TNodeData>(
  nodes: Node<TNodeData>[],
  edges: Edge[],
  rankdir: 'LR' | 'TB',
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
    rankdir,
    ranksep: rankSep,
    nodesep: nodeSep,
  })

  const { sortedNodes, sortedEdges } = sortedGraphElements(nodes, edges)
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

function isRootGraphNode<TNodeData>(node: Node<TNodeData>): boolean {
  const nodeData = node.data as { is_root?: boolean } | undefined
  return nodeData?.is_root === true
}

function layoutGraphRadial<TNodeData>(
  nodes: Node<TNodeData>[],
  edges: Edge[],
  options: DagreLayoutOptions = {},
): Node<TNodeData>[] {
  if (nodes.length === 0) {
    return []
  }

  const nodeWidth = options.nodeWidth ?? DEFAULT_NODE_WIDTH
  const nodeHeight = options.nodeHeight ?? DEFAULT_NODE_HEIGHT
  const radialRingGap = options.radialRingGap ?? DEFAULT_RADIAL_RING_GAP
  const radialMinNodesPerRing = options.radialMinNodesPerRing ?? DEFAULT_RADIAL_MIN_NODES_PER_RING
  const { sortedNodes, sortedEdges } = sortedGraphElements(nodes, edges)
  const nodeIds = new Set(sortedNodes.map((node) => node.id))
  const rootNodeId = sortedNodes.find(isRootGraphNode)?.id ?? sortedNodes[0].id

  const adjacency = new Map<string, string[]>()
  for (const edge of sortedEdges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      continue
    }

    const sourceNeighbors = adjacency.get(edge.source) ?? []
    sourceNeighbors.push(edge.target)
    adjacency.set(edge.source, sourceNeighbors)

    const targetNeighbors = adjacency.get(edge.target) ?? []
    targetNeighbors.push(edge.source)
    adjacency.set(edge.target, targetNeighbors)
  }

  const nodeDepthById = new Map<string, number>()
  nodeDepthById.set(rootNodeId, 0)
  const queue = [rootNodeId]
  let cursor = 0

  while (cursor < queue.length) {
    const currentNodeId = queue[cursor]
    cursor += 1

    const currentDepth = nodeDepthById.get(currentNodeId) ?? 0
    const neighbors = adjacency.get(currentNodeId)
    if (!neighbors) continue

    for (const neighborNodeId of neighbors) {
      if (nodeDepthById.has(neighborNodeId)) {
        continue
      }

      nodeDepthById.set(neighborNodeId, currentDepth + 1)
      queue.push(neighborNodeId)
    }
  }

  const maxDepth = Math.max(...nodeDepthById.values(), 0)
  for (const node of sortedNodes) {
    if (!nodeDepthById.has(node.id)) {
      nodeDepthById.set(node.id, maxDepth + 1)
    }
  }

  const nodesByDepth = new Map<number, Node<TNodeData>[]>()
  for (const node of sortedNodes) {
    const depth = nodeDepthById.get(node.id) ?? 0
    const depthNodes = nodesByDepth.get(depth) ?? []
    depthNodes.push(node)
    nodesByDepth.set(depth, depthNodes)
  }

  const positionedNodesById = new Map<string, { x: number; y: number }>()
  const sortedDepths = [...nodesByDepth.keys()].sort((a, b) => a - b)

  for (const depth of sortedDepths) {
    const depthNodes = nodesByDepth.get(depth)
    if (!depthNodes) continue

    const sortedDepthNodes = [...depthNodes].sort((a, b) => a.id.localeCompare(b.id))

    if (depth === 0 && sortedDepthNodes.length === 1) {
      const rootNode = sortedDepthNodes[0]
      const rootSize = resolveNodeSize(rootNode, nodeWidth, nodeHeight)
      positionedNodesById.set(rootNode.id, {
        x: -rootSize.width / 2,
        y: -rootSize.height / 2,
      })
      continue
    }

    const radius = Math.max(1, depth) * radialRingGap
    const ringSlots = Math.max(sortedDepthNodes.length, radialMinNodesPerRing)
    const angularStep = FULL_CIRCLE_RADIANS / ringSlots

    for (let index = 0; index < sortedDepthNodes.length; index += 1) {
      const node = sortedDepthNodes[index]
      const size = resolveNodeSize(node, nodeWidth, nodeHeight)
      const angle = -Math.PI / 2 + index * angularStep

      positionedNodesById.set(node.id, {
        x: radius * Math.cos(angle) - size.width / 2,
        y: radius * Math.sin(angle) - size.height / 2,
      })
    }
  }

  return sortedNodes.map((node) => {
    const position = positionedNodesById.get(node.id)
    if (!position) {
      const size = resolveNodeSize(node, nodeWidth, nodeHeight)
      return {
        ...node,
        position: {
          x: -size.width / 2,
          y: -size.height / 2,
        },
      }
    }

    return {
      ...node,
      position,
    }
  })
}

export function layoutGraphByMode<TNodeData>(
  nodes: Node<TNodeData>[],
  edges: Edge[],
  layoutMode: GraphLayoutMode,
  options: DagreLayoutOptions = {},
): Node<TNodeData>[] {
  if (layoutMode === 'tb') {
    return layoutGraphWithDagreRankdir(nodes, edges, 'TB', options)
  }

  if (layoutMode === 'radial') {
    return layoutGraphRadial(nodes, edges, options)
  }

  return layoutGraphWithDagreRankdir(nodes, edges, 'LR', options)
}

export function layoutGraphLeftToRight<TNodeData>(
  nodes: Node<TNodeData>[],
  edges: Edge[],
  options: DagreLayoutOptions = {},
): Node<TNodeData>[] {
  return layoutGraphWithDagreRankdir(nodes, edges, 'LR', options)
}
