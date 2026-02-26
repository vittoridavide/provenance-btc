export type GraphControlAction = 'fit' | 'reset' | 'zoomIn' | 'zoomOut'

type GraphControlHandlers = Record<GraphControlAction, () => void>

export type GraphControlsSnapshot = {
  canControl: boolean
  nodeCount: number
  isGraphLoading: boolean
  graphError: string | null
}

const listeners = new Set<() => void>()

let snapshot: GraphControlsSnapshot = {
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

export function setGraphControlsSnapshot(nextSnapshot: GraphControlsSnapshot): void {
  const unchanged =
    nextSnapshot.canControl === snapshot.canControl &&
    nextSnapshot.nodeCount === snapshot.nodeCount &&
    nextSnapshot.isGraphLoading === snapshot.isGraphLoading &&
    nextSnapshot.graphError === snapshot.graphError

  if (unchanged) {
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

export function registerGraphControlHandlers(nextHandlers: Partial<GraphControlHandlers>): void {
  handlers = nextHandlers
}

export function clearGraphControlHandlers(): void {
  handlers = {}
}

export function triggerGraphControl(action: GraphControlAction): void {
  handlers[action]?.()
}
