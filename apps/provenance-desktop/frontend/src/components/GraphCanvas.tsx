import { useMemo } from 'react'
import ReactFlow, { ReactFlowProvider } from 'reactflow'
import 'reactflow/dist/style.css'
import { useGraph } from '../hooks/useGraph'
import { adaptProvenanceGraphToReactFlow } from '../utils/graphAdapter'

const DEFAULT_GRAPH_TXID = import.meta.env.VITE_PROVENANCE_GRAPH_ROOT_TXID ?? ''

function GraphCanvas() {
  const { graph, loading, error } = useGraph({
    rootTxid: DEFAULT_GRAPH_TXID,
    depth: 10,
  })

  const { nodes, edges } = useMemo(() => {
    if (!graph) {
      return { nodes: [], edges: [] }
    }

    return adaptProvenanceGraphToReactFlow(graph)
  }, [graph])
  return (
    <main className="graph-canvas panel">
      <div className="graph-canvas-inner">
        <ReactFlowProvider>
          <ReactFlow nodes={nodes} edges={edges} fitView />
        </ReactFlowProvider>
        <div className="graph-state-debug">
          {loading && 'Graph state: loading'}
          {!loading && error && `Graph state: error — ${error}`}
          {!loading &&
            !error &&
            graph &&
            `Graph state: loaded (${nodes.length} nodes / ${edges.length} edges)`}
          {!loading &&
            !error &&
            !graph &&
            (DEFAULT_GRAPH_TXID
              ? 'Graph state: idle'
              : 'Graph state: idle — set VITE_PROVENANCE_GRAPH_ROOT_TXID')}
        </div>
      </div>
    </main>
  )
}

export default GraphCanvas
