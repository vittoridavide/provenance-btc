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
}

function TopBar({ title = 'Graph Workspace', rootTxid, onSubmitRootTxid }: TopBarProps) {
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
    <header className="top-bar panel">
      <div className="top-bar__left">
        <div className="top-bar__title">{title}</div>
        <form className="top-bar__search" onSubmit={handleSubmit}>
          <input
            className="top-bar__search-input"
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
            className="top-bar__button top-bar__button--search"
            disabled={isGraphLoading}
          >
            {isGraphLoading ? 'Loading…' : 'Load txid'}
          </button>
        </form>
        {validationError && <p className="top-bar__error">{validationError}</p>}
        {!validationError && isGraphLoading && (
          <p className="top-bar__status">
            <span className="spinner spinner--sm" aria-hidden="true" />
            <span>Loading graph…</span>
          </p>
        )}
        {!validationError && !isGraphLoading && graphError && (
          <p className="top-bar__status top-bar__status--error">{graphError}</p>
        )}
      </div>
      <div className="top-bar__actions">
        <button
          type="button"
          className="top-bar__button"
          onClick={() => triggerGraphControl('fit')}
          disabled={!canControl}
        >
          Fit to view
        </button>
        <button
          type="button"
          className="top-bar__button"
          onClick={() => triggerGraphControl('reset')}
          disabled={!canControl}
        >
          Reset layout
        </button>
        <button
          type="button"
          className="top-bar__button"
          onClick={() => triggerGraphControl('zoomOut')}
          disabled={!canControl}
        >
          Zoom out
        </button>
        <button
          type="button"
          className="top-bar__button"
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
