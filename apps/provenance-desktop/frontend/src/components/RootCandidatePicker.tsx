import type { GraphInputResolution } from '../types/api'

type RootCandidatePickerProps = {
  resolution: GraphInputResolution
  selectedRootTxid: string | null
  loading?: boolean
  onSelectRootTxid: (rootTxid: string) => void
}

function formatOptionalNumber(value: number | null): string {
  if (value === null || value === undefined) {
    return 'n/a'
  }
  return value.toLocaleString()
}

function RootCandidatePicker({
  resolution,
  selectedRootTxid,
  loading = false,
  onSelectRootTxid,
}: RootCandidatePickerProps) {
  const candidates = resolution.candidate_roots

  if (!resolution.requires_selection || candidates.length === 0) {
    return null
  }

  return (
    <section className="root-candidate-picker surface-card" aria-live="polite">
      <header className="root-candidate-picker__header">
        <h3 className="root-candidate-picker__title">Select root transaction</h3>
        <p className="root-candidate-picker__copy">
          Multiple unspent outputs were found for this address. Pick one root txid to build the graph.
        </p>
        <p className="root-candidate-picker__hint">
          Address resolution is UTXO-only, so spent outputs may not appear.
        </p>
      </header>

      <ul className="root-candidate-picker__list">
        {candidates.map((candidate, index) => {
          const key = `${candidate.txid}:${candidate.vout ?? 'na'}:${index}`
          const isSelected = selectedRootTxid === candidate.txid

          return (
            <li key={key} className="root-candidate-picker__item">
              <button
                type="button"
                className={`root-candidate-picker__button${isSelected ? ' root-candidate-picker__button--selected' : ''}`}
                onClick={() => onSelectRootTxid(candidate.txid)}
                disabled={loading}
              >
                <code className="root-candidate-picker__txid">{candidate.txid}</code>
                <span className="root-candidate-picker__meta">
                  <span>vout: {formatOptionalNumber(candidate.vout)}</span>
                  <span>amount_sat: {formatOptionalNumber(candidate.amount_sat)}</span>
                  <span>height: {formatOptionalNumber(candidate.height)}</span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

export default RootCandidatePicker
