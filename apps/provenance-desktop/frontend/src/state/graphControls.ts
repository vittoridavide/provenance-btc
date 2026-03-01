export type GraphControlAction = 'fit' | 'reset' | 'zoomIn' | 'zoomOut'
export type TransactionVisibilityFilter = 'all' | 'confirmed' | 'mempool' | 'missing'
export type GraphLayoutMode = 'lr' | 'tb' | 'radial'

type GraphControlHandlers = Record<GraphControlAction, () => void>

export type GraphUiControlState = {
  auditMode: boolean
  colorByCategory: boolean
  showTransactions: TransactionVisibilityFilter
  depth: number
  showOnlyPathsToSelected: boolean
  hideUnrelatedBranches: boolean
  layoutMode: GraphLayoutMode
}

export type GraphControlsSnapshot = GraphUiControlState & {
  canControl: boolean
  nodeCount: number
  isGraphLoading: boolean
  graphError: string | null
}

const listeners = new Set<() => void>()
const DEFAULT_GRAPH_UI_CONTROL_STATE: GraphUiControlState = {
  auditMode: false,
  colorByCategory: false,
  showTransactions: 'all',
  depth: 10,
  showOnlyPathsToSelected: false,
  hideUnrelatedBranches: false,
  layoutMode: 'lr',
}

let snapshot: GraphControlsSnapshot = {
  ...DEFAULT_GRAPH_UI_CONTROL_STATE,
  canControl: false,
  nodeCount: 0,
  isGraphLoading: false,
  graphError: null,
}

let handlers: Partial<GraphControlHandlers> = {}

function emitChange() {
  for (const listener of listeners) {
    listener()
  }
}

export function subscribeGraphControls(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getGraphControlsSnapshot(): GraphControlsSnapshot {
  return snapshot
}
function areSnapshotsEqual(a: GraphControlsSnapshot, b: GraphControlsSnapshot): boolean {
  return (
    a.auditMode === b.auditMode &&
    a.colorByCategory === b.colorByCategory &&
    a.showTransactions === b.showTransactions &&
    a.depth === b.depth &&
    a.showOnlyPathsToSelected === b.showOnlyPathsToSelected &&
    a.hideUnrelatedBranches === b.hideUnrelatedBranches &&
    a.layoutMode === b.layoutMode &&
    a.canControl === b.canControl &&
    a.nodeCount === b.nodeCount &&
    a.isGraphLoading === b.isGraphLoading &&
    a.graphError === b.graphError
  )
}

export function setGraphControlsSnapshot(nextSnapshot: GraphControlsSnapshot): void {
  if (areSnapshotsEqual(nextSnapshot, snapshot)) {
    return
  }

  snapshot = nextSnapshot
  emitChange()
}

export function patchGraphControlsSnapshot(patch: Partial<GraphControlsSnapshot>): void {
  setGraphControlsSnapshot({
    ...snapshot,
    ...patch,
  })
}

export function patchGraphUiControlState(patch: Partial<GraphUiControlState>): void {
  patchGraphControlsSnapshot(patch)
}

export function registerGraphControlHandlers(nextHandlers: Partial<GraphControlHandlers>): void {
  handlers = nextHandlers
}

export function clearGraphControlHandlers(): void {
  handlers = {}
}

export function triggerGraphControl(action: GraphControlAction): void {
  handlers[action]?.()
}
