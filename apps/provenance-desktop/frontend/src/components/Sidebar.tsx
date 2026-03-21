import { useSyncExternalStore, type ReactNode } from 'react'
import {
  getGraphControlsSnapshot,
  patchGraphUiControlState,
  subscribeGraphControls,
  type TransactionVisibilityFilter,
} from '../state/graphControls'

type SidebarProps = {
  collapsed?: boolean
  selectedTxid: string | null
  onToggle?: () => void
}

function clampDepth(nextDepth: number): number {
  return Math.max(1, Math.min(25, nextDepth))
}

function isTransactionVisibilityFilter(value: string): value is TransactionVisibilityFilter {
  return value === 'all' || value === 'confirmed' || value === 'mempool' || value === 'missing'
}

function FilterIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
      <path d="M1 2h11M3.5 6.5h6M5.5 11h2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

function BookOpenIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M2.25 3.5c0-.69.56-1.25 1.25-1.25H7a2.5 2.5 0 0 1 2 1 2.5 2.5 0 0 1 2-1h3.5c.69 0 1.25.56 1.25 1.25v8.75c0 .69-.56 1.25-1.25 1.25H11a2.5 2.5 0 0 0-2 1 2.5 2.5 0 0 0-2-1H3.5c-.69 0-1.25-.56-1.25-1.25V3.5z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path d="M8 3.25v10.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

function CheckCircle2Icon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="5.75" />
      <path d="M5.2 8.1l1.8 1.8 3.8-3.8" />
    </svg>
  )
}

function CircleDotIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="5.75" />
      <circle cx="8" cy="8" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  )
}

function CircleIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="5.75" />
    </svg>
  )
}

function LegendRow({ marker, label }: { marker: ReactNode; label: string }) {
  return (
    <div className="sidebar__legend-row">
      <span className="sidebar__legend-row-marker" aria-hidden="true">
        {marker}
      </span>
      <span className="sidebar__legend-row-label">{label}</span>
    </div>
  )
}

const CLASSIFICATION_LEGEND_ITEMS = [
  { label: 'Revenue', className: 'sidebar__legend-swatch--revenue' },
  { label: 'Expense', className: 'sidebar__legend-swatch--expense' },
  { label: 'Internal Transfer', className: 'sidebar__legend-swatch--internal-transfer' },
  { label: 'Loan', className: 'sidebar__legend-swatch--loan' },
  { label: 'Owner Contribution', className: 'sidebar__legend-swatch--owner-contribution' },
  { label: 'Refund', className: 'sidebar__legend-swatch--refund' },
  { label: 'Salary', className: 'sidebar__legend-swatch--salary' },
  { label: 'Tax Payment', className: 'sidebar__legend-swatch--tax-payment' },
  { label: 'Other', className: 'sidebar__legend-swatch--other' },
] as const

function CollapseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path
        d="M9 3L5 7l4 4"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function Sidebar({
  collapsed = false,
  onToggle,
}: SidebarProps) {
  const { depth, showTransactions, colorByCategory } = useSyncExternalStore(
    subscribeGraphControls,
    getGraphControlsSnapshot,
    getGraphControlsSnapshot,
  )

  if (collapsed) {
    return (
      <aside
        className="sidebar sidebar--collapsed"
        aria-label="Controls"
        onClick={onToggle}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onToggle?.() }}
      >
        <div className="sidebar__collapsed-label">Controls</div>
      </aside>
    )
  }

  return (
    <aside className="sidebar">
      <div className="sidebar__content">
        <section className="sidebar__section">
          <div className="sidebar__section-header-row">
            <h3 className="sidebar__section-header">Graph Controls</h3>
            {onToggle && (
              <button
                type="button"
                className="sidebar__collapse-button"
                onClick={onToggle}
                aria-label="Collapse controls"
              >
                <CollapseIcon />
              </button>
            )}
          </div>

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
          </div>
        </section>

        <div className="sidebar__divider" />

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

        <div className="sidebar__legend-block">
          <div className="sidebar__divider" />

          <section className="sidebar__section sidebar__section--legend">
            <h3 className="sidebar__section-header">
              <span className="sidebar__legend-header-icon">
                <BookOpenIcon />
              </span>
              Legend
            </h3>

            <div className="sidebar__legend">
              <div className="sidebar__legend-group">
                <p className="sidebar__legend-group-label">Node Status</p>
                <div className="sidebar__legend-group-items">
                  <LegendRow
                    marker={<span className="sidebar__legend-swatch sidebar__legend-swatch--root" />}
                    label="Root (resolved input)"
                  />
                  <LegendRow
                    marker={<span className="sidebar__legend-swatch sidebar__legend-swatch--confirmed" />}
                    label="Confirmed"
                  />
                  <LegendRow
                    marker={<span className="sidebar__legend-swatch sidebar__legend-swatch--mempool" />}
                    label="Mempool"
                  />
                  <LegendRow
                    marker={<span className="sidebar__legend-swatch sidebar__legend-swatch--missing" />}
                    label="Missing parent"
                  />
                  <LegendRow
                    marker={<span className="sidebar__legend-swatch sidebar__legend-swatch--external" />}
                    label="External / unknown"
                  />
                </div>
              </div>

              <div className="sidebar__legend-group">
                <p className="sidebar__legend-group-label">Labeling State</p>
                <div className="sidebar__legend-group-items">
                  <LegendRow
                    marker={
                      <span className="sidebar__legend-indicator sidebar__legend-indicator--fully-labeled">
                        <CheckCircle2Icon />
                      </span>
                    }
                    label="Fully labeled"
                  />
                  <LegendRow
                    marker={
                      <span className="sidebar__legend-indicator sidebar__legend-indicator--partially-labeled">
                        <CircleDotIcon />
                      </span>
                    }
                    label="Partially labeled"
                  />
                  <LegendRow
                    marker={
                      <span className="sidebar__legend-indicator sidebar__legend-indicator--unlabeled">
                        <CircleIcon />
                      </span>
                    }
                    label="Unlabeled"
                  />
                </div>
              </div>

              {colorByCategory && (
                <div className="sidebar__legend-group">
                  <p className="sidebar__legend-group-label">Classification</p>
                  <div className="sidebar__legend-group-items">
                    {CLASSIFICATION_LEGEND_ITEMS.map(({ label, className }) => (
                      <LegendRow
                        key={label}
                        marker={
                          <span
                            className={`sidebar__legend-swatch sidebar__legend-swatch--classification ${className}`}
                          />
                        }
                        label={label}
                      />
                    ))}
                  </div>
                </div>
              )}

              <div className="sidebar__legend-group">
                <p className="sidebar__legend-group-label">Edge Types</p>
                <div className="sidebar__legend-group-items">
                  <LegendRow
                    marker={<span className="sidebar__legend-line sidebar__legend-line--default" />}
                    label="Spend (default)"
                  />
                  <LegendRow
                    marker={<span className="sidebar__legend-line sidebar__legend-line--selected" />}
                    label="Selected / highlighted"
                  />
                  <LegendRow
                    marker={<span className="sidebar__legend-line sidebar__legend-line--dashed" />}
                    label="Dashed (future: missing)"
                  />
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </aside>
  )
}

export default Sidebar
