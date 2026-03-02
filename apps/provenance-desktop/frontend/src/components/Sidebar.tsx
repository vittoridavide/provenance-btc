import { useSyncExternalStore } from 'react'
import {
  getGraphControlsSnapshot,
  patchGraphUiControlState,
  subscribeGraphControls,
  type GraphLayoutMode,
  type TransactionVisibilityFilter,
} from '../state/graphControls'

type SidebarProps = {
  collapsed?: boolean
  selectedTxid: string | null
}

function clampDepth(nextDepth: number): number {
  return Math.max(1, Math.min(25, nextDepth))
}

function isTransactionVisibilityFilter(value: string): value is TransactionVisibilityFilter {
  return value === 'all' || value === 'confirmed' || value === 'mempool' || value === 'missing'
}

function isGraphLayoutMode(value: string): value is GraphLayoutMode {
  return value === 'lr' || value === 'tb' || value === 'radial'
}

function Toggle({
  checked,
  onChange,
  disabled = false,
}: {
  checked: boolean
  onChange: (value: boolean) => void
  disabled?: boolean
}) {
  return (
    <label className="toggle">
      <input
        type="checkbox"
        className="toggle__input"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="toggle__track">
        <span className="toggle__thumb" />
      </span>
    </label>
  )
}

function ShieldIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 1.5L2.5 4v3.75c0 3 2.5 5.5 5.5 6.5 3-1 5.5-3.5 5.5-6.5V4L8 1.5z"
        fill="rgba(59,130,246,0.12)"
        stroke="rgb(59,130,246)"
        strokeWidth="1.25"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function PaletteIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="5.5" stroke="rgb(147,51,234)" strokeWidth="1.25" fill="rgba(147,51,234,0.08)" />
      <circle cx="5.75" cy="7" r="1.25" fill="rgb(239,68,68)" />
      <circle cx="10.25" cy="7" r="1.25" fill="rgb(34,197,94)" />
      <circle cx="8" cy="10.5" r="1.25" fill="rgb(59,130,246)" />
    </svg>
  )
}

function FilterIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
      <path d="M1 2h11M3.5 6.5h6M5.5 11h2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

function Sidebar({ collapsed = false, selectedTxid }: SidebarProps) {
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
      <aside className="sidebar sidebar--collapsed" aria-label="Controls">
        <div className="sidebar__collapsed-label">Controls</div>
      </aside>
    )
  }

  return (
    <aside className="sidebar">
      {/* Scrollable content */}
      <div className="sidebar__content">
        {/* Audit Mode toggle row */}
        <div className="sidebar__toggle-row sidebar__toggle-row--audit">
          <span className="sidebar__toggle-row-icon">
            <ShieldIcon />
          </span>
          <span className="sidebar__toggle-row-label">Audit Mode</span>
          <Toggle
            checked={auditMode}
            onChange={(v) => patchGraphUiControlState({ auditMode: v })}
          />
        </div>

        {/* Color by category toggle row */}
        <div className="sidebar__toggle-row sidebar__toggle-row--palette">
          <span className="sidebar__toggle-row-icon">
            <PaletteIcon />
          </span>
          <span className="sidebar__toggle-row-label">Color by category</span>
          <Toggle
            checked={colorByCategory}
            onChange={(v) => patchGraphUiControlState({ colorByCategory: v })}
          />
        </div>

        <div className="sidebar__divider" />

        {/* Filters section */}
        <section className="sidebar__section">
          <h3 className="sidebar__section-header">
            <FilterIcon />
            Filters
          </h3>
          <div className="sidebar__field">
            <span className="sidebar__field-label">Show transactions</span>
            <select
              className="control-select"
              value={showTransactions}
              onChange={(event) => {
                const nextValue = event.target.value
                if (isTransactionVisibilityFilter(nextValue)) {
                  patchGraphUiControlState({ showTransactions: nextValue })
                }
              }}
            >
              <option value="all">All transactions</option>
              <option value="confirmed">Confirmed</option>
              <option value="mempool">Mempool</option>
              <option value="missing">Missing</option>
            </select>
          </div>
        </section>

        <div className="sidebar__divider" />

        {/* Graph Controls section */}
        <section className="sidebar__section">
          <h3 className="sidebar__section-header">Graph Controls</h3>

          <div className="sidebar__field">
            <span className="sidebar__field-label">Depth: {depth}</span>
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
            <div className="sidebar__range-labels">
              <span>1</span>
              <span>25</span>
            </div>
          </div>

          <div className={`sidebar__toggle-control${isPathFocusUnavailable ? ' sidebar__toggle-control--disabled' : ''}`}>
            <span className="sidebar__toggle-control-label">Show only paths to selected</span>
            <Toggle
              checked={showOnlyPathsToSelected}
              disabled={isPathFocusUnavailable}
              onChange={(v) => patchGraphUiControlState({ showOnlyPathsToSelected: v })}
            />
          </div>

          <div className={`sidebar__toggle-control${isPathFocusUnavailable ? ' sidebar__toggle-control--disabled' : ''}`}>
            <span className="sidebar__toggle-control-label">Hide unrelated branches</span>
            <Toggle
              checked={hideUnrelatedBranches}
              disabled={isPathFocusUnavailable}
              onChange={(v) => patchGraphUiControlState({ hideUnrelatedBranches: v })}
            />
          </div>

          {isPathFocusUnavailable && (
            <p className="sidebar__helper-text">
              Select a transaction in the graph to enable path-focus controls.
            </p>
          )}

          <div className="sidebar__field">
            <span className="sidebar__field-label">Layout mode</span>
            <select
              className="control-select"
              value={layoutMode}
              onChange={(event) => {
                const nextValue = event.target.value
                if (isGraphLayoutMode(nextValue)) {
                  patchGraphUiControlState({ layoutMode: nextValue })
                }
              }}
            >
              <option value="lr">Left → Right</option>
              <option value="tb">Top → Bottom</option>
              <option value="radial">Radial</option>
            </select>
          </div>
        </section>

        <div className="sidebar__divider" />

        {/* Legend section */}
        <section className="sidebar__section">
          <h3 className="sidebar__section-header">Legend</h3>
          <ul className="sidebar__legend">
            <li className="sidebar__legend-item">
              <span className="sidebar__legend-icon sidebar__legend-icon--root" aria-hidden="true" />
              <span>Root transaction</span>
            </li>
            <li className="sidebar__legend-item">
              <span className="sidebar__legend-icon sidebar__legend-icon--confirmed" aria-hidden="true" />
              <span>Confirmed</span>
            </li>
            <li className="sidebar__legend-item">
              <span className="sidebar__legend-icon sidebar__legend-icon--mempool" aria-hidden="true" />
              <span>Mempool</span>
            </li>
            <li className="sidebar__legend-item">
              <span className="sidebar__legend-icon sidebar__legend-icon--missing" aria-hidden="true" />
              <span>Missing parent</span>
            </li>
            <li className="sidebar__legend-item">
              <span className="sidebar__legend-icon sidebar__legend-icon--external" aria-hidden="true" />
              <span>External/unknown</span>
            </li>
          </ul>
        </section>
      </div>
    </aside>
  )
}

export default Sidebar
