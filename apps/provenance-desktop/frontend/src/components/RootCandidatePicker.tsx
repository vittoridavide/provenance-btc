import { useEffect, useId } from 'react'
import { CheckCircle2, Info, X } from 'lucide-react'
import type { GraphInputResolution } from '../types/api'
import './RootCandidatePicker.css'

const MODAL_DESCRIPTION =
  'Multiple unspent outputs were found for this address. Pick one root txid to build the graph. Address resolution is UTXO-only, so spent outputs may not appear.'

type RootCandidatePickerProps = {
  resolution: GraphInputResolution
  isOpen: boolean
  onOpenChange: (nextOpen: boolean) => void
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

function formatOptionalSatAmount(value: number | null): string {
  if (value === null || value === undefined) {
    return 'n/a'
  }
  return value.toLocaleString()
}

function RootCandidatePicker({
  resolution,
  isOpen,
  onOpenChange,
  selectedRootTxid,
  loading = false,
  onSelectRootTxid,
}: RootCandidatePickerProps) {
  const candidates = resolution.candidate_roots
  const titleId = useId()
  const descriptionId = useId()

  useEffect(() => {
    if (!isOpen) return

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return

    function handleWindowKeydown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !loading) {
        onOpenChange(false)
      }
    }

    window.addEventListener('keydown', handleWindowKeydown)
    return () => window.removeEventListener('keydown', handleWindowKeydown)
  }, [isOpen, loading, onOpenChange])

  if (!isOpen || candidates.length === 0) {
    return null
  }

  return (
    <div
      className="transaction-selection-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      aria-live="polite"
    >
      <div
        className="transaction-selection-modal__backdrop"
        onClick={() => {
          if (!loading) onOpenChange(false)
        }}
      />

      <section className="transaction-selection-modal__content">
        <header className="transaction-selection-modal__header">
          <div className="transaction-selection-modal__header-row">
            <h3 id={titleId} className="transaction-selection-modal__title">
              Select root transaction
            </h3>
            <button
              type="button"
              className="transaction-selection-modal__close"
              onClick={() => onOpenChange(false)}
              aria-label="Close transaction selection modal"
              disabled={loading}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
          <div className="transaction-selection-modal__alert-wrap">
            <div className="transaction-selection-modal__alert" role="status">
              <Info
                className="transaction-selection-modal__alert-icon"
                size={14}
                aria-hidden="true"
              />
              <p id={descriptionId} className="transaction-selection-modal__alert-description">
                <span className="transaction-selection-modal__alert-text">{MODAL_DESCRIPTION}</span>
              </p>
            </div>
          </div>
        </header>

        <div className="transaction-selection-modal__scroll-area">
          <ul className="transaction-selection-modal__list">
            {candidates.map((candidate, index) => {
              const key = `${candidate.txid}:${candidate.vout ?? 'na'}:${index}`
              const isSelected = selectedRootTxid === candidate.txid

              return (
                <li key={key} className="transaction-selection-modal__item">
                  <button
                    type="button"
                    className={`transaction-selection-modal__card${isSelected ? ' transaction-selection-modal__card--selected' : ''}`}
                    onClick={() => {
                      onSelectRootTxid(candidate.txid)
                      onOpenChange(false)
                    }}
                    disabled={loading}
                  >
                    <div className="transaction-selection-modal__card-content">
                      <div className="transaction-selection-modal__card-inner">
                        <div className="transaction-selection-modal__card-main">
                          <div className="transaction-selection-modal__card-header">
                            <span className="transaction-selection-modal__utxo-badge">
                              UTXO #{index + 1}
                            </span>
                            {isSelected ? (
                              <CheckCircle2
                                className="transaction-selection-modal__check-icon"
                                size={14}
                                aria-hidden="true"
                              />
                            ) : null}
                          </div>

                          <code className="transaction-selection-modal__txid">{candidate.txid}</code>

                          <div className="transaction-selection-modal__metadata-row">
                            <div className="transaction-selection-modal__metadata-item">
                              <span className="transaction-selection-modal__metadata-label">
                                Output:
                              </span>
                              <span className="transaction-selection-modal__badge transaction-selection-modal__badge--secondary">
                                {formatOptionalNumber(candidate.vout)}
                              </span>
                            </div>

                            <div className="transaction-selection-modal__metadata-item">
                              <span className="transaction-selection-modal__metadata-label">
                                Amount:
                              </span>
                              <span className="transaction-selection-modal__amount">
                                {formatOptionalSatAmount(candidate.amount_sat)}{' '}
                                <span className="transaction-selection-modal__amount-unit">
                                  sats
                                </span>
                              </span>
                            </div>

                            <div className="transaction-selection-modal__metadata-item">
                              <span className="transaction-selection-modal__metadata-label">
                                Block:
                              </span>
                              <span className="transaction-selection-modal__badge transaction-selection-modal__badge--outline">
                                {formatOptionalNumber(candidate.height)}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      </section>
    </div>
  )
}

export default RootCandidatePicker
