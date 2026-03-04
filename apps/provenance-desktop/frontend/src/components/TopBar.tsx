import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import {
  getGraphControlsSnapshot,
  subscribeGraphControls,
} from '../state/graphControls'
import provenanceLogo from '../assets/provenance.svg'

const TXID_PATTERN = /^[0-9a-fA-F]{64}$/

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M10 10l3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

type TopBarProps = {
  rootTxid: string
  onSearchTxid: (txid: string) => void
  onFitView: () => void
  onResetLayout: () => void
  onExportGraphJson: () => Promise<void> | void
  onExportLabels: () => Promise<void> | void
  onImportLabels: (file: File) => Promise<void> | void
  showPanelToggles: boolean
  sidebarCollapsed: boolean
  detailCollapsed: boolean
  onToggleSidebar: () => void
  onToggleDetail: () => void
}

function TopBar({
  rootTxid,
  onSearchTxid,
  onFitView,
  onResetLayout,
  onExportGraphJson,
  onExportLabels,
  onImportLabels,
  showPanelToggles,
  sidebarCollapsed,
  detailCollapsed,
  onToggleSidebar,
  onToggleDetail,
}: TopBarProps) {
  const { canControl, isGraphLoading } = useSyncExternalStore(
    subscribeGraphControls,
    getGraphControlsSnapshot,
    getGraphControlsSnapshot,
  )
  const [searchInput, setSearchInput] = useState(rootTxid)
  const [isImportingLabels, setIsImportingLabels] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const actionsDisabled = isGraphLoading || !canControl

  useEffect(() => {
    setSearchInput(rootTxid)
  }, [rootTxid])

  function handleSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const normalized = searchInput.trim().toLowerCase()
    if (!TXID_PATTERN.test(normalized)) return
    setSearchInput(normalized)
    onSearchTxid(normalized)
  }

  async function handleImportLabelsChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    setIsImportingLabels(true)

    try {
      await onImportLabels(file)
    } finally {
      setIsImportingLabels(false)
      event.target.value = ''
    }
  }

  return (
    <header className="top-bar">
      <span className="top-bar__title">
        <img src={provenanceLogo} alt="Provenance logo" className="top-bar__logo" />
        <span>Provenance Graph</span>
      </span>
      <form className="top-bar__search" onSubmit={handleSearchSubmit}>
        <div className="top-bar__search-wrapper">
          <span className="top-bar__search-icon">
            <SearchIcon />
          </span>
          <input
            className="top-bar__search-input"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="txid / outpoint / address"
            spellCheck={false}
            autoCapitalize="none"
            autoCorrect="off"
            disabled={isGraphLoading}
          />
        </div>
      </form>
      <div className="top-bar__actions">
        {showPanelToggles && (
          <>
            <button
              type="button"
              className="top-bar__button top-bar__panel-toggle control-button"
              onClick={onToggleSidebar}
              aria-pressed={!sidebarCollapsed}
            >
              {sidebarCollapsed ? 'Show controls' : 'Hide controls'}
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
          onClick={onFitView}
          disabled={actionsDisabled}
        >
          Fit to view
        </button>
        <button
          type="button"
          className="top-bar__button control-button"
          onClick={onResetLayout}
          disabled={actionsDisabled}
        >
          Reset layout
        </button>
        <button
          type="button"
          className="top-bar__button control-button"
          onClick={() => void onExportGraphJson()}
          disabled={actionsDisabled}
        >
          Export graph JSON
        </button>
        <button
          type="button"
          className="top-bar__button control-button"
          onClick={() => void onExportLabels()}
          disabled={actionsDisabled}
        >
          Export labels
        </button>
        <button
          type="button"
          className="top-bar__button control-button"
          onClick={() => fileInputRef.current?.click()}
          disabled={actionsDisabled || isImportingLabels}
        >
          {isImportingLabels ? 'Importing…' : 'Import labels'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".jsonl,.ndjson,text/plain,application/x-ndjson"
          onChange={(event) => void handleImportLabelsChange(event)}
          style={{ display: 'none' }}
        />
      </div>
    </header>
  )
}

export default TopBar
