import { useEffect, useState, useSyncExternalStore } from 'react'
import type { FormEvent } from 'react'
import {
  getGraphControlsSnapshot,
  subscribeGraphControls,
} from '../state/graphControls'
import provenanceLogo from '../assets/provenance.svg'

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M10 10l3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}


type TopBarProps = {
  searchInput: string
  onSearchInput: (input: string) => void
  onOpenRpcSettings: () => void
  addressInputEnabled?: boolean
  addressUnavailableReason?: string | null
  isInputCapabilitiesLoading?: boolean
  showChangeRootTxButton?: boolean
  onChangeRootTx?: () => void
}

function TopBar({
  searchInput: submittedInput,
  onSearchInput,
  onOpenRpcSettings,
  addressInputEnabled = true,
  addressUnavailableReason = null,
  isInputCapabilitiesLoading = false,
  showChangeRootTxButton = false,
  onChangeRootTx,
}: TopBarProps) {
  void addressUnavailableReason
  void isInputCapabilitiesLoading
  const { isGraphLoading } = useSyncExternalStore(
    subscribeGraphControls,
    getGraphControlsSnapshot,
    getGraphControlsSnapshot,
  )
  const [searchInput, setSearchInput] = useState(submittedInput)

  useEffect(() => {
    setSearchInput(submittedInput)
  }, [submittedInput])

  function handleSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const normalized = searchInput.trim()
    if (!normalized) return
    setSearchInput(normalized)
    onSearchInput(normalized)
  }
  const placeholder = addressInputEnabled ? 'txid / outpoint / address' : 'txid / outpoint'


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
            placeholder={placeholder}
            spellCheck={false}
            autoCapitalize="none"
            autoCorrect="off"
            disabled={isGraphLoading}
          />
        </div>
        {showChangeRootTxButton && onChangeRootTx ? (
          <button
            type="button"
            className="top-bar__change-root-button control-button"
            onClick={onChangeRootTx}
          >
            Change root tx
          </button>
        ) : null}
      </form>
      <div className="top-bar__actions">
        <button
          type="button"
          className="top-bar__button control-button"
          onClick={onOpenRpcSettings}
        >
          RPC Settings
        </button>
      </div>
    </header>
  )
}

export default TopBar
