import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import ReactFlow, {
  ReactFlowProvider,
  type Edge,
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
  clearGraphControlHandlers,
  patchGraphControlsSnapshot,
  registerGraphControlHandlers,
  subscribeGraphControls,
  type GraphLayoutMode,
  type TransactionVisibilityFilter,
} from '../state/graphControls'
import {
  type GraphFlowNodeData,
  TRANSACTION_NODE_TYPE,
  adaptProvenanceGraphToReactFlow,
} from '../utils/graphAdapter'
import { resolveCategoryNodeStyle } from '../utils/categoryPalette'
import { layoutGraphByMode } from '../utils/layout'
import TransactionNode from './nodes/TransactionNode'

const nodeTypes = {
  [TRANSACTION_NODE_TYPE]: TransactionNode,
} satisfies NodeTypes
const DEPTH_RELOAD_DEBOUNCE_MS = 250

type GraphCanvasProps = {
  rootTxid: string
  reloadKey: number
  selectedTxid: string | null
  onSelectTxid: (txid: string | null) => void
}

type GraphViewportProps = {
  adaptedNodes: Node<GraphFlowNodeData>[]
  adaptedEdges: Edge[]
  selectedTxid: string | null
  onSelectTxid: (txid: string | null) => void
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
  edges: Edge[],
  showTransactions: TransactionVisibilityFilter,
): { nodes: Node<GraphFlowNodeData>[]; edges: Edge[] } {
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

function collectReachableNodeIds(
  startNodeId: string,
  adjacency: Map<string, string[]>,
): Set<string> {
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
  edges: Edge[],
  selectedTxid: string | null,
  showOnlyPathsToSelected: boolean,
  hideUnrelatedBranches: boolean,
): { nodes: Node<GraphFlowNodeData>[]; edges: Edge[] } {
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

  const ancestorNodeIds = collectReachableNodeIds(selectedTxid, forwardAdjacency)
  const descendantNodeIds = collectReachableNodeIds(selectedTxid, reverseAdjacency)
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

function GraphViewport({
  adaptedNodes,
  adaptedEdges,
  selectedTxid,
  onSelectTxid,
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
  const [edges, setEdges, onEdgesChange] = useEdgesState([])
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
    setNodes(applyNodeVisualModes(selectedNodes, auditModeRef.current, colorByCategoryRef.current))
    setEdges(adaptedEdges)

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
    setNodes((currentNodes) => applyNodeVisualModes(currentNodes, auditMode, colorByCategory))
  }, [auditMode, colorByCategory, setNodes])

  const hasNodes = nodes.length > 0

  const fitToView = useCallback(() => {
    if (!hasNodes) return
    void reactFlow.fitView({ padding: 0.2, duration: 250 })
  }, [hasNodes, reactFlow])

  const zoomIn = useCallback(() => {
    if (!hasNodes) return
    void reactFlow.zoomIn({ duration: 150 })
  }, [hasNodes, reactFlow])

  const zoomOut = useCallback(() => {
    if (!hasNodes) return
    void reactFlow.zoomOut({ duration: 150 })
  }, [hasNodes, reactFlow])

  const resetLayout = useCallback(() => {
    if (!hasNodes) return
    const positionedNodes = runLayout('reset', layoutModeRef.current)
    const selectedNodes = applySelectedTxid(positionedNodes, selectedTxidRef.current)
    setNodes(applyNodeVisualModes(selectedNodes, auditModeRef.current, colorByCategoryRef.current))
    setEdges(adaptedEdges)

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
    registerGraphControlHandlers({
      fit: fitToView,
      reset: resetLayout,
      zoomIn,
      zoomOut,
    })

    return () => {
      clearGraphControlHandlers()
      patchGraphControlsSnapshot({ canControl: false, nodeCount: 0 })
    }
  }, [fitToView, resetLayout, zoomIn, zoomOut])

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
      onPaneClick={() => onSelectTxid(null)}
      nodeTypes={nodeTypes}
    />
  )
}

function GraphCanvas({ rootTxid, reloadKey, selectedTxid, onSelectTxid }: GraphCanvasProps) {
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
  const { graph, loading, error, reload } = useGraph({
    rootTxid,
    depth: debouncedDepth,
    reloadKey,
  })
  const { nodes: fullAdaptedNodes, edges: fullAdaptedEdges } = useMemo(() => {
    if (!graph) {
      return { nodes: [], edges: [] }
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
  const hasRootTxid = rootTxid.trim().length > 0
  const showRootPrompt = !hasRootTxid && !loading && !graph
  const showLoadingOverlay = loading && !hasGraphData
  const showEmptyGraph = !loading && !error && !!graph && adaptedNodes.length === 0
  const showErrorOverlay = !!error && !hasGraphData
  const showErrorBanner = !!error && hasGraphData
  const showRefreshingBanner = loading && hasGraphData

  return (
    <main className="graph-canvas surface-panel">
      <div className="graph-canvas-inner">
        <ReactFlowProvider>
          <GraphViewport
            adaptedNodes={adaptedNodes}
            adaptedEdges={adaptedEdges}
            selectedTxid={selectedTxid}
            onSelectTxid={onSelectTxid}
          />
        </ReactFlowProvider>
        {showRootPrompt && (
          <div className="graph-canvas__overlay">
            <div className="graph-canvas__state-card surface-card state-tone state-tone--info state-surface">
              <strong>No graph root selected</strong>
              <span>Enter a txid in the top bar to load a provenance graph.</span>
            </div>
          </div>
        )}
        {showLoadingOverlay && (
          <div className="graph-canvas__overlay">
            <div className="graph-canvas__state-card surface-card state-tone state-tone--loading state-surface">
              <div className="graph-canvas__state-row">
                <span className="spinner" aria-hidden="true" />
                <strong>Loading graph…</strong>
              </div>
              <span>Fetching graph data from the backend command.</span>
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
            <span>Refreshing graph…</span>
          </div>
        )}
        <div className="graph-state-debug">
          {loading && 'Graph state: loading'}
          {!loading && error && `Graph state: error — ${error}`}
          {!loading &&
            !error &&
            graph &&
            `Graph state: loaded (${adaptedNodes.length}/${fullAdaptedNodes.length} nodes, ${adaptedEdges.length}/${fullAdaptedEdges.length} edges)`}
          {!loading &&
            !error &&
            !graph &&
            (rootTxid
              ? 'Graph state: idle'
              : 'Graph state: idle — set VITE_PROVENANCE_GRAPH_ROOT_TXID')}
        </div>
      </div>
    </main>
  )
}

export default GraphCanvas
