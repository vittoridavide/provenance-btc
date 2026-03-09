import { useEffect, useState, useSyncExternalStore } from 'react'
import type { FormEvent } from 'react'
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
  onExportGraphJson: () => Promise<void> | void
  onOpenImportExport: () => void
}

function TopBar({
  rootTxid,
  onSearchTxid,
  onExportGraphJson,
  onOpenImportExport,
}: TopBarProps) {
  const { canControl, isGraphLoading } = useSyncExternalStore(
    subscribeGraphControls,
    getGraphControlsSnapshot,
    getGraphControlsSnapshot,
  )
  const [searchInput, setSearchInput] = useState(rootTxid)
  const graphActionDisabled = isGraphLoading || !canControl

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


  return (
    <header className="top-bar">
      <span className="top-bar__title">
        <img src={provenanceLogo} alt="Provenance logo" className="top-bar__logo" />
        <span>Provenance</span>
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
        <button
          type="button"
          className="top-bar__button control-button"
          onClick={() => void onExportGraphJson()}
          disabled={graphActionDisabled}
        >
          Export graph JSON
        </button>
        <button
          type="button"
          className="top-bar__button control-button"
          onClick={onOpenImportExport}
        >
          Import / Export
        </button>
      </div>
    </header>
  )
}

export default TopBar
