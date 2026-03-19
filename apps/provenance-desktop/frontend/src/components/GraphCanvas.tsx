import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlowProvider,
  type EdgeTypes,
  type Node,
  type NodeTypes,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from 'reactflow'
import 'reactflow/dist/style.css'
import { useGraph } from '../hooks/useGraph'
import {
  getGraphControlsSnapshot,
  patchGraphControlsSnapshot,
  subscribeGraphControls,
  type GraphLayoutMode,
  type TransactionVisibilityFilter,
} from '../state/graphControls'
import type { GraphInputResolution, GraphSummary, ProvenanceGraph } from '../types/api'
import { categoryColorHexByKey, resolveCategoryNodeStyle } from '../utils/categoryPalette'
import {
  type GraphFlowEdge,
  type GraphFlowNodeData,
  TRANSACTION_EDGE_TYPE,
  TRANSACTION_NODE_TYPE,
  adaptProvenanceGraphToReactFlow,
} from '../utils/graphAdapter'
import { layoutGraphByMode } from '../utils/layout'
import TransactionEdge from './edges/TransactionEdge'
import TransactionNode from './nodes/TransactionNode'

const nodeTypes = {
  [TRANSACTION_NODE_TYPE]: TransactionNode,
} satisfies NodeTypes

const edgeTypes = {
  [TRANSACTION_EDGE_TYPE]: TransactionEdge,
} satisfies EdgeTypes

const DEPTH_RELOAD_DEBOUNCE_MS = 250
const DEFAULT_EDGE_STROKE = '#94a3b8'
const CATEGORY_EDGE_OPACITY = 0.3

type GraphCanvasProps = {
  input: string
  addressInputEnabled?: boolean
  selectedRootTxid?: string | null
  reloadKey: number
  selectedTxid: string | null
  onSelectTxid: (txid: string | null) => void
  onGraphSummaryChange?: (summary: GraphSummary | null) => void
  onResolutionChange?: (resolution: GraphInputResolution | null) => void
  onGraphDataChange?: (graph: ProvenanceGraph | null) => void
  onRegisterViewActions?: (actions: GraphCanvasTopBarActions | null) => void
  onRegisterRefresh?: (refresh: (() => Promise<void>) | null) => void
}

export type GraphCanvasTopBarActions = {
  fitView: () => void
  resetLayout: () => void
}

type GraphViewportProps = {
  adaptedNodes: Node<GraphFlowNodeData>[]
  adaptedEdges: GraphFlowEdge[]
  selectedTxid: string | null
  onSelectTxid: (txid: string | null) => void
  onRegisterViewActions?: (actions: GraphCanvasTopBarActions | null) => void
}

function DatabaseIcon() {
  return (
    <svg className="graph-canvas__empty-icon" viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <ellipse cx="24" cy="10" rx="14" ry="5.5" stroke="currentColor" strokeWidth="2" />
      <path d="M10 10v12c0 3 6.3 5.5 14 5.5S38 25 38 22V10" stroke="currentColor" strokeWidth="2" />
      <path d="M10 22v12c0 3 6.3 5.5 14 5.5S38 37 38 34V22" stroke="currentColor" strokeWidth="2" />
    </svg>
  )
}

function withOpacity(hexColor: string, opacity: number): string {
  const hex = hexColor.replace('#', '')
  if (hex.length !== 6) {
    return hexColor
  }
  const red = Number.parseInt(hex.slice(0, 2), 16)
  const green = Number.parseInt(hex.slice(2, 4), 16)
  const blue = Number.parseInt(hex.slice(4, 6), 16)
  if ([red, green, blue].some((value) => Number.isNaN(value))) {
    return hexColor
  }
  return `rgba(${red}, ${green}, ${blue}, ${opacity})`
}

function resolveMiniMapNodeColor(node: Node<GraphFlowNodeData>, colorByCategory: boolean): string {
  if (colorByCategory) {
    const categoryHex = categoryColorHexByKey(node.data.classification_key)
    if (categoryHex) {
      return categoryHex
    }
  }

  if (node.data.is_root) {
    return '#3b82f6'
  }
  if (node.data.status === 'confirmed') {
    return '#10b981'
  }
  if (node.data.status === 'mempool') {
    return '#f59e0b'
  }
  return '#94a3b8'
}

function applySelectedTxid<TNodeData>(
  nodes: Node<TNodeData>[],
  selectedTxid: string | null,
): Node<TNodeData>[] {
  let hasChanges = false

  const nextNodes = nodes.map((node) => {
    const isSelected = selectedTxid !== null && node.id === selectedTxid
    if (node.selected === isSelected) {
      return node
    }
    hasChanges = true
    return { ...node, selected: isSelected }
  })

  return hasChanges ? nextNodes : nodes
}

function getAuditModeSnapshot(): boolean {
  return getGraphControlsSnapshot().auditMode
}

function getColorByCategorySnapshot(): boolean {
  return getGraphControlsSnapshot().colorByCategory
}

function getTransactionVisibilitySnapshot(): TransactionVisibilityFilter {
  return getGraphControlsSnapshot().showTransactions
}

function getShowOnlyPathsToSelectedSnapshot(): boolean {
  return getGraphControlsSnapshot().showOnlyPathsToSelected
}

function getHideUnrelatedBranchesSnapshot(): boolean {
  return getGraphControlsSnapshot().hideUnrelatedBranches
}

function getDepthSnapshot(): number {
  return getGraphControlsSnapshot().depth
}

function getLayoutModeSnapshot(): GraphLayoutMode {
  return getGraphControlsSnapshot().layoutMode
}

function filterGraphByTransactionStatus(
  nodes: Node<GraphFlowNodeData>[],
  edges: GraphFlowEdge[],
  showTransactions: TransactionVisibilityFilter,
): { nodes: Node<GraphFlowNodeData>[]; edges: GraphFlowEdge[] } {
  if (showTransactions === 'all') {
    return { nodes, edges }
  }

  const filteredNodes = nodes.filter((node) => node.data.status === showTransactions)
  const visibleNodeIds = new Set(filteredNodes.map((node) => node.id))
  const filteredEdges = edges.filter(
    (edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target),
  )

  return { nodes: filteredNodes, edges: filteredEdges }
}

function collectReachableNodeIds(startNodeId: string, adjacency: Map<string, string[]>): Set<string> {
  const reachableNodeIds = new Set<string>([startNodeId])
  const queue = [startNodeId]
  let cursor = 0

  while (cursor < queue.length) {
    const currentNodeId = queue[cursor]
    cursor += 1
    const neighbors = adjacency.get(currentNodeId)
    if (!neighbors) continue

    for (const neighborNodeId of neighbors) {
      if (reachableNodeIds.has(neighborNodeId)) continue
      reachableNodeIds.add(neighborNodeId)
      queue.push(neighborNodeId)
    }
  }

  return reachableNodeIds
}

function filterGraphBySelectionPathFocus(
  nodes: Node<GraphFlowNodeData>[],
  edges: GraphFlowEdge[],
  selectedTxid: string | null,
  showOnlyPathsToSelected: boolean,
  hideUnrelatedBranches: boolean,
): { nodes: Node<GraphFlowNodeData>[]; edges: GraphFlowEdge[] } {
  const shouldFilterBySelectionPath = showOnlyPathsToSelected || hideUnrelatedBranches
  if (!shouldFilterBySelectionPath || !selectedTxid) {
    return { nodes, edges }
  }

  const visibleNodeIds = new Set(nodes.map((node) => node.id))
  if (!visibleNodeIds.has(selectedTxid)) {
    return { nodes, edges }
  }

  const forwardAdjacency = new Map<string, string[]>()
  const reverseAdjacency = new Map<string, string[]>()

  for (const edge of edges) {
    if (!visibleNodeIds.has(edge.source) || !visibleNodeIds.has(edge.target)) {
      continue
    }

    const sourceNeighbors = forwardAdjacency.get(edge.source) ?? []
    sourceNeighbors.push(edge.target)
    forwardAdjacency.set(edge.source, sourceNeighbors)

    const targetNeighbors = reverseAdjacency.get(edge.target) ?? []
    targetNeighbors.push(edge.source)
    reverseAdjacency.set(edge.target, targetNeighbors)
  }

  const ancestorNodeIds = collectReachableNodeIds(selectedTxid, reverseAdjacency)
  const descendantNodeIds = collectReachableNodeIds(selectedTxid, forwardAdjacency)
  const focusedNodeIds = new Set([...ancestorNodeIds, ...descendantNodeIds])

  const focusedNodes = nodes.filter((node) => focusedNodeIds.has(node.id))
  const focusedEdges = edges.filter(
    (edge) => focusedNodeIds.has(edge.source) && focusedNodeIds.has(edge.target),
  )

  return { nodes: focusedNodes, edges: focusedEdges }
}

function applyNodeVisualModes(
  nodes: Node<GraphFlowNodeData>[],
  auditMode: boolean,
  colorByCategory: boolean,
): Node<GraphFlowNodeData>[] {
  let hasChanges = false

  const nextNodes = nodes.map((node) => {
    const shouldHighlightUnclassified = auditMode && node.data.classification_state === 'None'
    const { paletteKey, showNeutralIndicator } = resolveCategoryNodeStyle(
      node.data.classification_category,
      colorByCategory,
    )

    if (
      node.data.audit_unclassified === shouldHighlightUnclassified &&
      node.data.category_palette_key === paletteKey &&
      node.data.category_neutral_indicator === showNeutralIndicator
    ) {
      return node
    }

    hasChanges = true
    return {
      ...node,
      data: {
        ...node.data,
        audit_unclassified: shouldHighlightUnclassified,
        category_palette_key: paletteKey,
        category_neutral_indicator: showNeutralIndicator,
      },
    }
  })

  return hasChanges ? nextNodes : nodes
}

function applyEdgeVisualModes(
  edges: GraphFlowEdge[],
  nodes: Node<GraphFlowNodeData>[],
  colorByCategory: boolean,
): GraphFlowEdge[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  let hasChanges = false

  const nextEdges = edges.map((edge) => {
    let nextStroke = DEFAULT_EDGE_STROKE

    if (colorByCategory) {
      const sourceNode = nodeById.get(edge.source)
      const targetNode = nodeById.get(edge.target)
      const sourcePalette = sourceNode?.data.classification_key ?? null
      const targetPalette = targetNode?.data.classification_key ?? null
      if (sourcePalette && sourcePalette === targetPalette) {
        const categoryColor = categoryColorHexByKey(sourcePalette)
        if (categoryColor) {
          nextStroke = withOpacity(categoryColor, CATEGORY_EDGE_OPACITY)
        }
      }
    }

    if (edge.style?.stroke === nextStroke && edge.style?.strokeWidth === 2) {
      return edge
    }

    hasChanges = true
    return {
      ...edge,
      style: {
        ...edge.style,
        stroke: nextStroke,
        strokeWidth: 2,
      },
    }
  })

  return hasChanges ? nextEdges : edges
}

function GraphViewport({
  adaptedNodes,
  adaptedEdges,
  selectedTxid,
  onSelectTxid,
  onRegisterViewActions,
}: GraphViewportProps) {
  const auditMode = useSyncExternalStore(
    subscribeGraphControls,
    getAuditModeSnapshot,
    getAuditModeSnapshot,
  )
  const colorByCategory = useSyncExternalStore(
    subscribeGraphControls,
    getColorByCategorySnapshot,
    getColorByCategorySnapshot,
  )
  const layoutMode = useSyncExternalStore(
    subscribeGraphControls,
    getLayoutModeSnapshot,
    getLayoutModeSnapshot,
  )
  const reactFlow = useReactFlow<GraphFlowNodeData>()
  const [nodes, setNodes, onNodesChange] = useNodesState<GraphFlowNodeData>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<GraphFlowEdge['data']>([])
  const layoutRunCountRef = useRef(0)
  const selectedTxidRef = useRef<string | null>(selectedTxid)
  const auditModeRef = useRef<boolean>(auditMode)
  const colorByCategoryRef = useRef<boolean>(colorByCategory)
  const layoutModeRef = useRef<GraphLayoutMode>(layoutMode)
  const previousLayoutModeRef = useRef<GraphLayoutMode>(layoutMode)

  useEffect(() => {
    selectedTxidRef.current = selectedTxid
  }, [selectedTxid])

  useEffect(() => {
    auditModeRef.current = auditMode
  }, [auditMode])

  useEffect(() => {
    colorByCategoryRef.current = colorByCategory
  }, [colorByCategory])

  useEffect(() => {
    layoutModeRef.current = layoutMode
  }, [layoutMode])

  const runLayout = useCallback(
    (reason: 'load' | 'reset' | 'mode-change', mode: GraphLayoutMode) => {
      const positionedNodes = layoutGraphByMode(adaptedNodes, adaptedEdges, mode)
      layoutRunCountRef.current += 1
      if (import.meta.env.DEV) {
        console.debug(`[graph-layout] run #${layoutRunCountRef.current} (${reason}, mode=${mode})`)
      }
      return positionedNodes
    },
    [adaptedEdges, adaptedNodes],
  )

  useEffect(() => {
    const didModeChange = previousLayoutModeRef.current !== layoutMode
    previousLayoutModeRef.current = layoutMode

    const positionedNodes = runLayout(didModeChange ? 'mode-change' : 'load', layoutMode)
    const selectedNodes = applySelectedTxid(positionedNodes, selectedTxidRef.current)
    const visualNodes = applyNodeVisualModes(
      selectedNodes,
      auditModeRef.current,
      colorByCategoryRef.current,
    )
    setNodes(visualNodes)
    setEdges(applyEdgeVisualModes(adaptedEdges, visualNodes, colorByCategoryRef.current))

    if (didModeChange && positionedNodes.length > 0) {
      requestAnimationFrame(() => {
        void reactFlow.fitView({ padding: 0.2, duration: 250 })
      })
    }
  }, [adaptedEdges, layoutMode, reactFlow, runLayout, setEdges, setNodes])

  useEffect(() => {
    setNodes((currentNodes) => applySelectedTxid(currentNodes, selectedTxid))
  }, [selectedTxid, setNodes])

  useEffect(() => {
    setNodes((currentNodes) => {
      const nextNodes = applyNodeVisualModes(currentNodes, auditMode, colorByCategory)
      setEdges((currentEdges) =>
        applyEdgeVisualModes(currentEdges as GraphFlowEdge[], nextNodes, colorByCategory),
      )
      return nextNodes
    })
  }, [auditMode, colorByCategory, setEdges, setNodes])

  const hasNodes = nodes.length > 0

  const fitToView = useCallback(() => {
    if (!hasNodes) return
    void reactFlow.fitView({ padding: 0.2, duration: 250 })
  }, [hasNodes, reactFlow])

  const resetLayout = useCallback(() => {
    if (!hasNodes) return
    const positionedNodes = runLayout('reset', layoutModeRef.current)
    const selectedNodes = applySelectedTxid(positionedNodes, selectedTxidRef.current)
    const visualNodes = applyNodeVisualModes(
      selectedNodes,
      auditModeRef.current,
      colorByCategoryRef.current,
    )
    setNodes(visualNodes)
    setEdges(applyEdgeVisualModes(adaptedEdges, visualNodes, colorByCategoryRef.current))

    requestAnimationFrame(() => {
      void reactFlow.fitView({ padding: 0.2, duration: 250 })
    })
  }, [adaptedEdges, hasNodes, reactFlow, runLayout, setEdges, setNodes])

  const handleNodeClick = useCallback(
    (_event: ReactMouseEvent, node: Node<GraphFlowNodeData>) => {
      onSelectTxid(node.id)
    },
    [onSelectTxid],
  )

  useEffect(() => {
    patchGraphControlsSnapshot({
      canControl: hasNodes,
      nodeCount: nodes.length,
    })
  }, [hasNodes, nodes.length])

  useEffect(() => {
    onRegisterViewActions?.({
      fitView: fitToView,
      resetLayout,
    })

    return () => {
      onRegisterViewActions?.(null)
      patchGraphControlsSnapshot({ canControl: false, nodeCount: 0 })
    }
  }, [fitToView, onRegisterViewActions, resetLayout])

  useEffect(() => {
    if (!hasNodes) return

    const fitTimer = window.setTimeout(() => {
      void reactFlow.fitView({ padding: 0.2, duration: 250 })
    }, 0)

    return () => {
      window.clearTimeout(fitTimer)
    }
  }, [adaptedNodes, hasNodes, reactFlow])

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeClick={handleNodeClick}
      onEdgeClick={() => onSelectTxid(null)}
      onPaneClick={() => onSelectTxid(null)}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      defaultEdgeOptions={{ type: TRANSACTION_EDGE_TYPE }}
      minZoom={0.1}
      maxZoom={4}
      fitView
      nodesConnectable={false}
      edgesUpdatable={false}
      className="transaction-flow"
      proOptions={{ hideAttribution: true }}
    >
      <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="#e2e8f0" />
      <Controls />
      <MiniMap
        pannable
        zoomable
        className="transaction-flow__minimap"
        nodeStrokeWidth={2}
        nodeColor={(node) => resolveMiniMapNodeColor(node as Node<GraphFlowNodeData>, colorByCategory)}
      />
    </ReactFlow>
  )
}

function GraphCanvas({
  input,
  addressInputEnabled = true,
  selectedRootTxid = null,
  reloadKey,
  selectedTxid,
  onSelectTxid,
  onGraphSummaryChange,
  onResolutionChange,
  onGraphDataChange,
  onRegisterViewActions,
  onRegisterRefresh,
}: GraphCanvasProps) {
  const showTransactions = useSyncExternalStore(
    subscribeGraphControls,
    getTransactionVisibilitySnapshot,
    getTransactionVisibilitySnapshot,
  )
  const showOnlyPathsToSelected = useSyncExternalStore(
    subscribeGraphControls,
    getShowOnlyPathsToSelectedSnapshot,
    getShowOnlyPathsToSelectedSnapshot,
  )
  const hideUnrelatedBranches = useSyncExternalStore(
    subscribeGraphControls,
    getHideUnrelatedBranchesSnapshot,
    getHideUnrelatedBranchesSnapshot,
  )
  const depth = useSyncExternalStore(subscribeGraphControls, getDepthSnapshot, getDepthSnapshot)
  const [debouncedDepth, setDebouncedDepth] = useState(depth)

  useEffect(() => {
    const debounceTimer = window.setTimeout(() => {
      setDebouncedDepth(depth)
    }, DEPTH_RELOAD_DEBOUNCE_MS)

    return () => {
      window.clearTimeout(debounceTimer)
    }
  }, [depth])

  const { graph, resolution, loading, error, reload } = useGraph({
    input,
    depth: debouncedDepth,
    selectedRootTxid,
    reloadKey,
  })

  const refreshGraph = useCallback(async () => {
    await reload({
      input,
      depth,
      selectedRootTxid,
      throwOnError: true,
    })
  }, [depth, input, reload, selectedRootTxid])

  useEffect(() => {
    onRegisterRefresh?.(refreshGraph)
    return () => {
      onRegisterRefresh?.(null)
    }
  }, [onRegisterRefresh, refreshGraph])

  useEffect(() => {
    onGraphSummaryChange?.(graph?.summary ?? null)
  }, [graph, onGraphSummaryChange])

  useEffect(() => {
    onGraphDataChange?.(graph ?? null)
  }, [graph, onGraphDataChange])

  useEffect(() => {
    onResolutionChange?.(resolution ?? null)
  }, [onResolutionChange, resolution])

  const { nodes: fullAdaptedNodes, edges: fullAdaptedEdges } = useMemo(() => {
    if (!graph) {
      return { nodes: [], edges: [] as GraphFlowEdge[] }
    }
    return adaptProvenanceGraphToReactFlow(graph)
  }, [graph])

  const { nodes: statusFilteredNodes, edges: statusFilteredEdges } = useMemo(
    () => filterGraphByTransactionStatus(fullAdaptedNodes, fullAdaptedEdges, showTransactions),
    [fullAdaptedEdges, fullAdaptedNodes, showTransactions],
  )

  const { nodes: adaptedNodes, edges: adaptedEdges } = useMemo(
    () =>
      filterGraphBySelectionPathFocus(
        statusFilteredNodes,
        statusFilteredEdges,
        selectedTxid,
        showOnlyPathsToSelected,
        hideUnrelatedBranches,
      ),
    [
      hideUnrelatedBranches,
      selectedTxid,
      showOnlyPathsToSelected,
      statusFilteredEdges,
      statusFilteredNodes,
    ],
  )

  const fullAdaptedNodeIds = useMemo(
    () => new Set(fullAdaptedNodes.map((node) => node.id)),
    [fullAdaptedNodes],
  )

  useEffect(() => {
    if (!selectedTxid) return
    if (fullAdaptedNodeIds.has(selectedTxid)) return
    onSelectTxid(null)
  }, [fullAdaptedNodeIds, onSelectTxid, selectedTxid])

  useEffect(() => {
    patchGraphControlsSnapshot({
      isGraphLoading: loading,
      graphError: error,
    })
  }, [error, loading])

  const hasGraphData = adaptedNodes.length > 0
  const hasInput = input.trim().length > 0
  const requiresSelection = !!resolution?.requires_selection
  const showRootPrompt = !hasInput && !loading && !graph
  const showLoadingOverlay = loading && !hasGraphData
  const showSelectionRequiredOverlay = !loading && !error && requiresSelection && !hasGraphData
  const showEmptyGraph = !loading && !error && !!graph && !requiresSelection && adaptedNodes.length === 0
  const showErrorOverlay = !!error && !hasGraphData && !showSelectionRequiredOverlay
  const showErrorBanner = !!error && hasGraphData
  const showRefreshingBanner = loading && hasGraphData

  return (
    <main className="graph-canvas surface-panel">
      <div className={`graph-canvas-inner${showRefreshingBanner ? ' graph-canvas-inner--refreshing' : ''}`}>
        <ReactFlowProvider>
          <GraphViewport
            adaptedNodes={adaptedNodes}
            adaptedEdges={adaptedEdges}
            selectedTxid={selectedTxid}
            onSelectTxid={onSelectTxid}
            onRegisterViewActions={onRegisterViewActions}
          />
        </ReactFlowProvider>

        {showRootPrompt && (
          <div className="graph-canvas__overlay">
            <div className="graph-canvas__state-card graph-canvas__state-card--empty ">
              <DatabaseIcon />
              <strong>
                {addressInputEnabled
                  ? 'Search by txid, outpoint, or address to begin'
                  : 'Search by txid or outpoint to begin'}
              </strong>
            </div>
          </div>
        )}

        {showLoadingOverlay && (
          <div className="graph-canvas__overlay">
            <div className="graph-canvas__state-card surface-card state-tone state-tone--loading state-surface">
              <div className="graph-canvas__state-row">
                <span className="spinner" aria-hidden="true" />
                <strong>Loading provenance graph...</strong>
              </div>
            </div>
          </div>
        )}

        {showSelectionRequiredOverlay && (
          <div className="graph-canvas__overlay">
            <div className="graph-canvas__state-card surface-card state-tone state-tone--empty state-surface">
              <strong>Root selection required</strong>
              <span>
                Multiple unspent roots match this address. Select a candidate root to build the graph.
              </span>
            </div>
          </div>
        )}

        {showEmptyGraph && (
          <div className="graph-canvas__overlay">
            <div className="graph-canvas__state-card surface-card state-tone state-tone--empty state-surface">
              <strong>Graph is empty</strong>
              <span>No nodes were returned for this root/depth selection.</span>
            </div>
          </div>
        )}

        {showErrorOverlay && (
          <div className="graph-canvas__overlay">
            <div className="graph-canvas__state-card surface-card state-tone state-tone--error state-surface">
              <strong>Unable to build graph</strong>
              <span>{error}</span>
              <button
                type="button"
                className="graph-canvas__retry control-button"
                onClick={() => void reload()}
              >
                Retry
              </button>
            </div>
          </div>
        )}

        {showErrorBanner && (
          <div className="graph-canvas__banner surface-card state-tone state-tone--error state-surface">
            <span>Graph refresh failed: {error}</span>
            <button
              type="button"
              className="graph-canvas__banner-action control-button"
              onClick={() => void reload()}
            >
              Retry
            </button>
          </div>
        )}

        {showRefreshingBanner && (
          <div className="graph-canvas__banner surface-card graph-canvas__banner--loading state-tone state-tone--loading state-surface">
            <span className="spinner spinner--sm" aria-hidden="true" />
            <span>Refreshing graph...</span>
          </div>
        )}
      </div>
    </main>
  )
}

export default GraphCanvas
