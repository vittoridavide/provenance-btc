import { useState, useSyncExternalStore } from 'react'
import type { FormEvent } from 'react'
import {
  getGraphControlsSnapshot,
  subscribeGraphControls,
  triggerGraphControl,
} from '../state/graphControls'

const TXID_PATTERN = /^[0-9a-fA-F]{64}$/
type TopBarProps = {
  title?: string
  rootTxid: string
  onSubmitRootTxid: (txid: string) => void
  showPanelToggles: boolean
  sidebarCollapsed: boolean
  detailCollapsed: boolean
  onToggleSidebar: () => void
  onToggleDetail: () => void
}

function TopBar({
  title = 'Graph Workspace',
  rootTxid,
  onSubmitRootTxid,
  showPanelToggles,
  sidebarCollapsed,
  detailCollapsed,
  onToggleSidebar,
  onToggleDetail,
}: TopBarProps) {
  const { canControl, graphError, isGraphLoading } = useSyncExternalStore(
    subscribeGraphControls,
    getGraphControlsSnapshot,
    getGraphControlsSnapshot,
  )
  const [searchInput, setSearchInput] = useState(rootTxid)
  const [validationError, setValidationError] = useState<string | null>(null)

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const normalizedInput = searchInput.trim().toLowerCase()
    if (!TXID_PATTERN.test(normalizedInput)) {
      setValidationError('Please enter a valid 64-character hexadecimal txid.')
      return
    }

    setValidationError(null)
    setSearchInput(normalizedInput)
    onSubmitRootTxid(normalizedInput)
  }

  return (
    <header className="top-bar surface-panel">
      <div className="top-bar__left">
        <div className="top-bar__title section-header section-header--lg">{title}</div>
        <form className="top-bar__search" onSubmit={handleSubmit}>
          <input
            className="top-bar__search-input control-input"
            value={searchInput}
            onChange={(event) => {
              setSearchInput(event.target.value)
              if (validationError) setValidationError(null)
            }}
            placeholder="txid (64 hex chars)"
            spellCheck={false}
            autoCapitalize="none"
            autoCorrect="off"
          />
          <button
            type="submit"
            className="top-bar__button top-bar__button--search control-button"
            disabled={isGraphLoading}
          >
            {isGraphLoading ? 'Loading…' : 'Load txid'}
          </button>
        </form>
        {validationError && (
          <p className="top-bar__error state-tone state-tone--error state-text">{validationError}</p>
        )}
        {!validationError && isGraphLoading && (
          <p className="top-bar__status state-tone state-tone--loading state-text">
            <span className="spinner spinner--sm" aria-hidden="true" />
            <span>Loading graph…</span>
          </p>
        )}
        {!validationError && !isGraphLoading && graphError && (
          <p className="top-bar__status state-tone state-tone--error state-text">{graphError}</p>
        )}
      </div>
      <div className="top-bar__actions">
        {showPanelToggles && (
          <>
            <button
              type="button"
              className="top-bar__button top-bar__panel-toggle control-button"
              onClick={onToggleSidebar}
              aria-pressed={!sidebarCollapsed}
            >
              {sidebarCollapsed ? 'Show filters' : 'Hide filters'}
            </button>
            <button
              type="button"
              className="top-bar__button top-bar__panel-toggle control-button"
              onClick={onToggleDetail}
              aria-pressed={!detailCollapsed}
            >
              {detailCollapsed ? 'Show details' : 'Hide details'}
            </button>
          </>
        )}
        <button
          type="button"
          className="top-bar__button control-button"
          onClick={() => triggerGraphControl('fit')}
          disabled={!canControl}
        >
          Fit to view
        </button>
        <button
          type="button"
          className="top-bar__button control-button"
          onClick={() => triggerGraphControl('reset')}
          disabled={!canControl}
        >
          Reset layout
        </button>
        <button
          type="button"
          className="top-bar__button control-button"
          onClick={() => triggerGraphControl('zoomOut')}
          disabled={!canControl}
        >
          Zoom out
        </button>
        <button
          type="button"
          className="top-bar__button control-button"
          onClick={() => triggerGraphControl('zoomIn')}
          disabled={!canControl}
        >
          Zoom in
        </button>
      </div>
    </header>
  )
}

export default TopBar
