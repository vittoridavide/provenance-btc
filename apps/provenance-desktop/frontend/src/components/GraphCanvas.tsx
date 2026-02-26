import { useCallback, useEffect, useMemo, useRef } from 'react'
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
  clearGraphControlHandlers,
  patchGraphControlsSnapshot,
  registerGraphControlHandlers,
} from '../state/graphControls'
import {
  type GraphFlowNodeData,
  TRANSACTION_NODE_TYPE,
  adaptProvenanceGraphToReactFlow,
} from '../utils/graphAdapter'
import { layoutGraphLeftToRight } from '../utils/layout'
import TransactionNode from './nodes/TransactionNode'

const nodeTypes = {
  [TRANSACTION_NODE_TYPE]: TransactionNode,
} satisfies NodeTypes

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

function GraphViewport({
  adaptedNodes,
  adaptedEdges,
  selectedTxid,
  onSelectTxid,
}: GraphViewportProps) {
  const reactFlow = useReactFlow<GraphFlowNodeData>()
  const [nodes, setNodes, onNodesChange] = useNodesState<GraphFlowNodeData>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])
  const layoutRunCountRef = useRef(0)
  const selectedTxidRef = useRef<string | null>(selectedTxid)

  useEffect(() => {
    selectedTxidRef.current = selectedTxid
  }, [selectedTxid])

  const runLayout = useCallback(
    (reason: 'load' | 'reset') => {
      const positionedNodes = layoutGraphLeftToRight(adaptedNodes, adaptedEdges)
      layoutRunCountRef.current += 1

      if (import.meta.env.DEV) {
        console.debug(`[graph-layout] run #${layoutRunCountRef.current} (${reason})`)
      }

      return positionedNodes
    },
    [adaptedEdges, adaptedNodes],
  )

  useEffect(() => {
    const positionedNodes = runLayout('load')
    setNodes(applySelectedTxid(positionedNodes, selectedTxidRef.current))
    setEdges(adaptedEdges)
  }, [adaptedEdges, runLayout, setEdges, setNodes])

  useEffect(() => {
    setNodes((currentNodes) => applySelectedTxid(currentNodes, selectedTxid))
  }, [selectedTxid, setNodes])

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

    const positionedNodes = runLayout('reset')
    setNodes(applySelectedTxid(positionedNodes, selectedTxidRef.current))
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
  const { graph, loading, error, reload } = useGraph({
    rootTxid,
    depth: 10,
    reloadKey,
  })

  const { nodes: adaptedNodes, edges: adaptedEdges } = useMemo(() => {
    if (!graph) {
      return { nodes: [], edges: [] }
    }

    return adaptProvenanceGraphToReactFlow(graph)
  }, [graph])

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
            `Graph state: loaded (${adaptedNodes.length} nodes / ${adaptedEdges.length} edges)`}
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
