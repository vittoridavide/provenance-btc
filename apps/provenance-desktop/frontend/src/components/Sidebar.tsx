import { useSyncExternalStore } from 'react'
import {
  getGraphControlsSnapshot,
  patchGraphUiControlState,
  subscribeGraphControls,
  type GraphLayoutMode,
  type TransactionVisibilityFilter,
} from '../state/graphControls'

type SidebarProps = {
  label?: string
  collapsed?: boolean
  selectedTxid: string | null
}

function clampDepth(nextDepth: number): number {
  return Math.max(1, Math.min(25, nextDepth))
}

function parseDepthInput(input: string): number | null {
  if (input.trim().length === 0) {
    return null
  }

  const parsedDepth = Number.parseInt(input, 10)
  if (Number.isNaN(parsedDepth)) {
    return null
  }

  return clampDepth(parsedDepth)
}

function isTransactionVisibilityFilter(value: string): value is TransactionVisibilityFilter {
  return value === 'all' || value === 'confirmed' || value === 'mempool' || value === 'missing'
}

function isGraphLayoutMode(value: string): value is GraphLayoutMode {
  return value === 'lr' || value === 'tb' || value === 'radial'
}

function Sidebar({ label = 'Sidebar', collapsed = false, selectedTxid }: SidebarProps) {
  const {
    auditMode,
    colorByCategory,
    showTransactions,
    depth,
    showOnlyPathsToSelected,
    hideUnrelatedBranches,
    layoutMode,
  } = useSyncExternalStore(subscribeGraphControls, getGraphControlsSnapshot, getGraphControlsSnapshot)
  const isPathFocusUnavailable = selectedTxid === null

  if (collapsed) {
    return (
      <aside className="sidebar sidebar--collapsed surface-panel" aria-label={label}>
        <div className="sidebar__collapsed-label">{label}</div>
      </aside>
    )
  }

  return (
    <aside className="sidebar surface-panel">
      <div className="sidebar__content">
        <h2 className="section-header section-header--lg section-header--with-divider">{label}</h2>

        <section className="sidebar__section surface-card border-variant-subtle">
          <h3 className="section-header">Audit Mode</h3>
          <label className="sidebar__checkbox-row">
            <input
              className="sidebar__checkbox"
              type="checkbox"
              checked={auditMode}
              onChange={(event) => {
                patchGraphUiControlState({ auditMode: event.target.checked })
              }}
            />
            <span>Enable audit-focused analysis mode</span>
          </label>
        </section>

        <section className="sidebar__section surface-card border-variant-subtle">
          <h3 className="section-header">Color by category</h3>
          <label className="sidebar__checkbox-row">
            <input
              className="sidebar__checkbox"
              type="checkbox"
              checked={colorByCategory}
              onChange={(event) => {
                patchGraphUiControlState({ colorByCategory: event.target.checked })
              }}
            />
            <span>Color nodes using classification labels</span>
          </label>
        </section>

        <section className="sidebar__section surface-card border-variant-subtle">
          <h3 className="section-header">Filters</h3>
          <label className="sidebar__field">
            <span className="sidebar__field-label">Show transactions</span>
            <select
              className="control-select sidebar__select"
              value={showTransactions}
              onChange={(event) => {
                const nextValue = event.target.value
                if (isTransactionVisibilityFilter(nextValue)) {
                  patchGraphUiControlState({ showTransactions: nextValue })
                }
              }}
            >
              <option value="all">All</option>
              <option value="confirmed">Confirmed</option>
              <option value="mempool">Mempool</option>
              <option value="missing">Missing</option>
            </select>
          </label>

          <label
            className={`sidebar__checkbox-row ${isPathFocusUnavailable ? 'sidebar__checkbox-row--disabled' : ''}`}
          >
            <input
              className="sidebar__checkbox"
              type="checkbox"
              checked={showOnlyPathsToSelected}
              disabled={isPathFocusUnavailable}
              onChange={(event) => {
                patchGraphUiControlState({ showOnlyPathsToSelected: event.target.checked })
              }}
            />
            <span>Show only paths connected to selection</span>
          </label>
          <label
            className={`sidebar__checkbox-row ${isPathFocusUnavailable ? 'sidebar__checkbox-row--disabled' : ''}`}
          >
            <input
              className="sidebar__checkbox"
              type="checkbox"
              checked={hideUnrelatedBranches}
              disabled={isPathFocusUnavailable}
              onChange={(event) => {
                patchGraphUiControlState({ hideUnrelatedBranches: event.target.checked })
              }}
            />
            <span>Hide unrelated branches</span>
          </label>

          {isPathFocusUnavailable && (
            <p className="sidebar__helper-text">
              Select a transaction node in the graph to enable path-focus controls.
            </p>
          )}
        </section>

        <section className="sidebar__section surface-card border-variant-subtle">
          <h3 className="section-header">Graph Controls</h3>
          <label className="sidebar__field">
            <span className="sidebar__field-label">Depth ({depth})</span>
            <div className="sidebar__depth-controls">
              <input
                className="sidebar__depth-range"
                type="range"
                min={1}
                max={25}
                value={depth}
                onChange={(event) => {
                  patchGraphUiControlState({ depth: clampDepth(Number(event.target.value)) })
                }}
              />
              <input
                className="control-input sidebar__depth-input"
                type="number"
                min={1}
                max={25}
                value={depth}
                onChange={(event) => {
                  const parsedDepth = parseDepthInput(event.target.value)
                  if (parsedDepth !== null) {
                    patchGraphUiControlState({ depth: parsedDepth })
                  }
                }}
              />
            </div>
          </label>
        </section>

        <section className="sidebar__section surface-card border-variant-subtle">
          <h3 className="section-header">Layout mode</h3>
          <div className="sidebar__radio-group" role="radiogroup" aria-label="Layout mode">
            <label className="sidebar__radio-row">
              <input
                className="sidebar__radio"
                type="radio"
                name="layout-mode"
                value="lr"
                checked={layoutMode === 'lr'}
                onChange={(event) => {
                  const nextValue = event.target.value
                  if (isGraphLayoutMode(nextValue)) {
                    patchGraphUiControlState({ layoutMode: nextValue })
                  }
                }}
              />
              <span>Left → Right</span>
            </label>
            <label className="sidebar__radio-row">
              <input
                className="sidebar__radio"
                type="radio"
                name="layout-mode"
                value="tb"
                checked={layoutMode === 'tb'}
                onChange={(event) => {
                  const nextValue = event.target.value
                  if (isGraphLayoutMode(nextValue)) {
                    patchGraphUiControlState({ layoutMode: nextValue })
                  }
                }}
              />
              <span>Top → Bottom</span>
            </label>
            <label className="sidebar__radio-row">
              <input
                className="sidebar__radio"
                type="radio"
                name="layout-mode"
                value="radial"
                checked={layoutMode === 'radial'}
                onChange={(event) => {
                  const nextValue = event.target.value
                  if (isGraphLayoutMode(nextValue)) {
                    patchGraphUiControlState({ layoutMode: nextValue })
                  }
                }}
              />
              <span>Radial</span>
            </label>
          </div>
        </section>

        <section className="sidebar__section surface-card border-variant-subtle">
          <h3 className="section-header">Legend</h3>
          <ul className="sidebar__legend">
            <li>
              <span className="sidebar__legend-label">Confirmed</span>
            </li>
            <li>
              <span className="sidebar__legend-label">Mempool</span>
            </li>
            <li>
              <span className="sidebar__legend-label">Missing</span>
            </li>
          </ul>
        </section>
      </div>
    </aside>
  )
}

export default Sidebar
