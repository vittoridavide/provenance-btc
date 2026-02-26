declare module 'dagre' {
  export namespace graphlib {
    class Graph {
      setGraph(label: Record<string, unknown>): Graph
      setDefaultEdgeLabel(newDefault: () => unknown): Graph
      setNode(name: string, label: { width: number; height: number }): Graph
      setEdge(v: string, w: string, label?: unknown): Graph
      node(name: string): { x: number; y: number; width: number; height: number }
    }
  }

  export function layout(graph: graphlib.Graph): void

  const dagre: {
    graphlib: typeof graphlib
    layout: typeof layout
  }

  export default dagre
}
