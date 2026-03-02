import { invoke } from '@tauri-apps/api/core'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTransactionDetail } from '../hooks/useTransactionDetail'
import type { Classification, RefType, TransactionDetail } from '../types/api'

type DetailPanelProps = {
  selectedTxid: string | null
  collapsed?: boolean
  onGraphRefresh?: () => Promise<void>
}
type DetailPanelState = 'no-selection' | 'loading' | 'load-error' | 'loaded'
type DetailStatus = 'confirmed' | 'mempool' | 'unknown'
const UNKNOWN_VALUE = 'Unknown'
const INLINE_TOAST_TIMEOUT_MS = 3000

const CLASSIFICATION_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'Select classification' },
  { value: 'revenue', label: 'Revenue' },
  { value: 'expense', label: 'Expense' },
  { value: 'internal transfer', label: 'Internal transfer' },
  { value: 'exchange deposit', label: 'Exchange deposit' },
  { value: 'unknown', label: 'Unknown' },
]

function toReadableStatus(confirmations: number | null | undefined): DetailStatus {
  if (confirmations == null) return 'unknown'
  return confirmations > 0 ? 'confirmed' : 'mempool'
}

function formatTimestamp(unixTimestamp: number | null | undefined): string {
  if (unixTimestamp == null || !Number.isFinite(unixTimestamp)) return UNKNOWN_VALUE
  const timestampMs = unixTimestamp * 1000
  const date = new Date(timestampMs)
  if (!Number.isFinite(date.getTime())) return UNKNOWN_VALUE
  return date.toLocaleString()
}

function formatOptionalNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return UNKNOWN_VALUE
  return value.toLocaleString()
}

function toDisplayTxid(txid: string | null | undefined): string {
  const trimmedTxid = (txid ?? '').trim()
  return trimmedTxid.length > 0 ? trimmedTxid : UNKNOWN_VALUE
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error

  try {
    return JSON.stringify(error)
  } catch {
    return 'Unknown error'
  }
}

async function copyTextToClipboard(value: string): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value)
      return
    } catch {
      // fallback below
    }
  }

  if (typeof document === 'undefined') return
  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.setAttribute('readonly', 'true')
  textarea.style.position = 'absolute'
  textarea.style.left = '-9999px'
  textarea.style.top = '0'
  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()
  try {
    document.execCommand('copy')
  } catch {
    // ignore copy failures
  } finally {
    document.body.removeChild(textarea)
  }
}

function shortTxid(txid: string): string {
  if (txid.length <= 16) return txid
  return `${txid.slice(0, 8)}...${txid.slice(-8)}`
}

function toMetadataString(classification: TransactionDetail['classification']): string {
  if (!classification?.metadata) return ''
  try {
    return JSON.stringify(classification.metadata, null, 2)
  } catch {
    return ''
  }
}

function DetailPanel({ selectedTxid, collapsed = false, onGraphRefresh }: DetailPanelProps) {
  const { detail, loading, error, reload } = useTransactionDetail(selectedTxid)
  const activeTxid = (selectedTxid ?? '').trim()
  const hasSelection = activeTxid.length > 0
  const isStaleDetail = !!detail && detail.txid.trim() !== activeTxid
  const isLoading = loading || (hasSelection && isStaleDetail && !error)
  const loadError =
    error ?? (!isLoading && hasSelection && !detail ? 'No detail data returned for this transaction.' : null)
  const state: DetailPanelState = !hasSelection
    ? 'no-selection'
    : isLoading
      ? 'loading'
      : loadError
        ? 'load-error'
        : 'loaded'
  const loadedDetail = state === 'loaded' ? detail : null
  const detailStatus = loadedDetail ? toReadableStatus(loadedDetail.confirmations) : 'unknown'
  const displayTxid = toDisplayTxid(loadedDetail?.txid)
  const hasCopyableTxid = displayTxid !== UNKNOWN_VALUE
  const [classificationCategory, setClassificationCategory] = useState('')
  const [classificationContext, setClassificationContext] = useState('')
  const [classificationMetadata, setClassificationMetadata] = useState('')
  const [classificationTaxRelevant, setClassificationTaxRelevant] = useState(false)
  const [classificationSaving, setClassificationSaving] = useState(false)
  const [classificationError, setClassificationError] = useState<string | null>(null)
  const [classificationToast, setClassificationToast] = useState<string | null>(null)
  const [labelInput, setLabelInput] = useState('')
  const [labelSaving, setLabelSaving] = useState(false)
  const [labelDeleting, setLabelDeleting] = useState(false)
  const [labelError, setLabelError] = useState<string | null>(null)
  const [labelToast, setLabelToast] = useState<string | null>(null)
  const [selectionNotice, setSelectionNotice] = useState<string | null>(null)
  const classificationRequestRef = useRef(false)
  const labelMutationRef = useRef(false)
  const activeTxidRef = useRef(activeTxid)
  const previousTxidRef = useRef<string | null>(null)

  useEffect(() => {
    if (!loadedDetail) {
      setClassificationCategory('')
      setClassificationContext('')
      setClassificationMetadata('')
      setClassificationTaxRelevant(false)
      setLabelInput('')
      setClassificationError(null)
      setClassificationToast(null)
      setLabelError(null)
      setLabelToast(null)
      return
    }

    setClassificationCategory(loadedDetail.classification?.category ?? '')
    setClassificationContext(loadedDetail.classification?.context ?? '')
    setClassificationMetadata(toMetadataString(loadedDetail.classification))
    setClassificationTaxRelevant(loadedDetail.classification?.tax_relevant ?? false)
    setLabelInput(loadedDetail.label ?? '')
    setClassificationError(null)
    setClassificationToast(null)
    setLabelError(null)
    setLabelToast(null)
  }, [loadedDetail])

  useEffect(() => {
    if (!labelToast) return

    const timeoutId = window.setTimeout(() => {
      setLabelToast(null)
    }, INLINE_TOAST_TIMEOUT_MS)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [labelToast])

  useEffect(() => {
    if (!classificationToast) return

    const timeoutId = window.setTimeout(() => {
      setClassificationToast(null)
    }, INLINE_TOAST_TIMEOUT_MS)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [classificationToast])
  useEffect(() => {
    if (!selectionNotice) return

    const timeoutId = window.setTimeout(() => {
      setSelectionNotice(null)
    }, INLINE_TOAST_TIMEOUT_MS)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [selectionNotice])
  useEffect(() => {
    activeTxidRef.current = activeTxid
  }, [activeTxid])

  const classificationOptions = useMemo(() => {
    const options = [...CLASSIFICATION_OPTIONS]
    const trimmedCategory = classificationCategory.trim()
    if (trimmedCategory && !options.some((option) => option.value === trimmedCategory)) {
      options.splice(1, 0, { value: trimmedCategory, label: trimmedCategory })
    }
    return options
  }, [classificationCategory])
  const formDetail = detail
  const existingClassificationCategory = formDetail?.classification?.category?.trim() ?? ''
  const existingClassificationContext = formDetail?.classification?.context?.trim() ?? ''
  const existingClassificationMetadata = toMetadataString(formDetail?.classification ?? null).trim()
  const existingClassificationTaxRelevant = formDetail?.classification?.tax_relevant ?? false
  const normalizedClassificationCategory = classificationCategory.trim()
  const normalizedClassificationContext = classificationContext.trim()
  const normalizedClassificationMetadata = classificationMetadata.trim()
  const normalizedExistingLabel = (formDetail?.label ?? '').trim()
  const normalizedLabelInput = labelInput.trim()
  const hasPersistedLabel = normalizedExistingLabel.length > 0
  const labelChanged = normalizedLabelInput !== normalizedExistingLabel
  const classificationChanged = !!formDetail
    && (normalizedClassificationCategory !== existingClassificationCategory
      || normalizedClassificationContext !== existingClassificationContext
      || normalizedClassificationMetadata !== existingClassificationMetadata
      || classificationTaxRelevant !== existingClassificationTaxRelevant)
  const hasUnsavedChanges = !!formDetail && (classificationChanged || labelChanged)
  const isUnclassified =
    !!loadedDetail && (loadedDetail.classification?.category?.trim() ?? '').length === 0
  const saveClassificationDisabled = classificationSaving || !normalizedClassificationCategory
  const saveLabelDisabled =
    labelSaving || labelDeleting || !normalizedLabelInput || !labelChanged
  const deleteLabelDisabled = labelDeleting || labelSaving

  useEffect(() => {
    const previousTxid = previousTxidRef.current
    previousTxidRef.current = activeTxid
    if (!previousTxid || previousTxid === activeTxid) {
      return
    }
    if (!hasUnsavedChanges) {
      return
    }
    setSelectionNotice('Unsaved edits were cleared when you switched transactions.')
  }, [activeTxid, hasUnsavedChanges])

  async function refreshAfterMutation() {
    await reload({
      txid: activeTxidRef.current,
      throwOnError: true,
    })
    if (onGraphRefresh) {
      await onGraphRefresh()
    }
  }

  async function handleSaveClassification() {
    if (!loadedDetail) return
    if (classificationRequestRef.current) return
    classificationRequestRef.current = true
    const category = classificationCategory.trim()
    if (!category) {
      setClassificationError('Select a primary classification before saving.')
      classificationRequestRef.current = false
      return
    }

    let metadata: Classification['metadata'] = {}
    if (classificationMetadata.trim().length > 0) {
      try {
        const parsed = JSON.parse(classificationMetadata)
        if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') {
          setClassificationError('Metadata must be a JSON object.')
          classificationRequestRef.current = false
          return
        }
        metadata = parsed
      } catch (parseError) {
        setClassificationError(`Metadata is not valid JSON: ${toErrorMessage(parseError)}`)
        classificationRequestRef.current = false
        return
      }
    }

    setClassificationSaving(true)
    setClassificationError(null)
    setClassificationToast(null)

    try {
      const payload: Classification = {
        category,
        context: classificationContext,
        metadata,
        tax_relevant: classificationTaxRelevant,
      }
      await invoke('cmd_set_classification', {
        refType: 'tx' as RefType,
        refId: loadedDetail.txid,
        classification: payload,
      })
    } catch (invokeError) {
      setClassificationError(`Failed to save classification: ${toErrorMessage(invokeError)}`)
      setClassificationSaving(false)
      classificationRequestRef.current = false
      return
    }

    try {
      await refreshAfterMutation()
      setClassificationToast('Transaction classification saved.')
    } catch (refreshError) {
      setClassificationError(
        `Classification saved, but failed to refresh graph/detail: ${toErrorMessage(refreshError)}`,
      )
    } finally {
      setClassificationSaving(false)
      classificationRequestRef.current = false
    }
  }

  async function handleSaveLabel() {
    if (!loadedDetail) return
    if (labelMutationRef.current) return
    labelMutationRef.current = true
    const nextLabel = normalizedLabelInput
    if (!labelChanged) {
      labelMutationRef.current = false
      return
    }
    if (!nextLabel) {
      setLabelError('Enter a label before saving.')
      labelMutationRef.current = false
      return
    }

    setLabelSaving(true)
    setLabelError(null)
    setLabelToast(null)

    try {
      await invoke('cmd_set_label', {
        refType: 'tx' as RefType,
        refId: loadedDetail.txid,
        label: nextLabel,
      })
    } catch (invokeError) {
      setLabelError(`Failed to save label: ${toErrorMessage(invokeError)}`)
      setLabelSaving(false)
      labelMutationRef.current = false
      return
    }

    try {
      await refreshAfterMutation()
      setLabelToast('Transaction label saved.')
    } catch (refreshError) {
      setLabelError(`Label saved, but failed to refresh graph/detail: ${toErrorMessage(refreshError)}`)
    } finally {
      setLabelSaving(false)
      labelMutationRef.current = false
    }
  }

  async function handleDeleteLabel() {
    if (!loadedDetail || !hasPersistedLabel) return
    if (labelMutationRef.current) return
    labelMutationRef.current = true
    setLabelDeleting(true)
    setLabelError(null)
    setLabelToast(null)

    try {
      await invoke('cmd_delete_label', {
        refType: 'tx' as RefType,
        refId: loadedDetail.txid,
      })
    } catch (invokeError) {
      setLabelError(`Failed to delete label: ${toErrorMessage(invokeError)}`)
      setLabelDeleting(false)
      labelMutationRef.current = false
      return
    }

    try {
      await refreshAfterMutation()
      setLabelToast('Transaction label deleted.')
    } catch (refreshError) {
      setLabelError(`Label deleted, but failed to refresh graph/detail: ${toErrorMessage(refreshError)}`)
    } finally {
      setLabelDeleting(false)
      labelMutationRef.current = false
    }
  }

  if (collapsed) {
    return (
      <aside className="detail-panel detail-panel--collapsed surface-panel" aria-label="Transaction details">
        <div className="detail-panel__collapsed-label">Details</div>
      </aside>
    )
  }

  return (
    <aside className="detail-panel surface-panel">
      <div className="detail-panel__content">
        <h2 className="detail-panel__title section-header section-header--lg section-header--with-divider">
          Transaction Details
        </h2>
        {selectionNotice && (
          <p
            className="detail-panel__inline-toast surface-card state-tone state-tone--warning state-surface"
            role="status"
            aria-live="polite"
          >
            {selectionNotice}
          </p>
        )}

        {state === 'no-selection' && (
          <p className="detail-panel__placeholder state-tone state-tone--info state-text">
            Select a transaction node to inspect details.
          </p>
        )}
        {state === 'loading' && (
          <p className="detail-panel__status state-tone state-tone--loading state-text">
            <span className="spinner spinner--sm" aria-hidden="true" />
            <span>Loading {shortTxid(activeTxid)}…</span>
          </p>
        )}
        {state === 'load-error' && (
          <div className="detail-panel__error surface-card state-tone state-tone--error state-surface">
            <strong>Failed to load transaction</strong>
            <span>{loadError}</span>
          </div>
        )}
        {state === 'loaded' && loadedDetail && (
          <>
            <div className="detail-panel__section surface-card border-variant-subtle">
              <h3 className="section-header">Transaction Summary</h3>
              <div className="detail-panel__kv detail-panel__kv--txid">
                <span>Transaction ID</span>
                <div className="detail-panel__txid-value">
                  <code className="detail-panel__txid-code" title={displayTxid}>
                    {displayTxid}
                  </code>
                  <button
                    type="button"
                    className="detail-panel__copy-button control-button"
                    onClick={() => void copyTextToClipboard(displayTxid)}
                    aria-label="Copy transaction id"
                    disabled={!hasCopyableTxid}
                  >
                    Copy
                  </button>
                </div>
              </div>
              <div className="detail-panel__kv">
                <span>Status</span>
                <span className={`tx-badge tx-badge--status tx-badge--status-${detailStatus}`}>
                  {detailStatus}
                </span>
              </div>
              <div className="detail-panel__kv">
                <span>Confirmations</span>
                <span>{formatOptionalNumber(loadedDetail.confirmations)}</span>
              </div>
              <div className="detail-panel__kv">
                <span>Block Height</span>
                <span>{formatOptionalNumber(loadedDetail.block_height)}</span>
              </div>
              <div className="detail-panel__kv">
                <span>Time</span>
                <span>{formatTimestamp(loadedDetail.block_time)}</span>
              </div>
              <div className="detail-panel__kv">
                <span>vsize</span>
                <span>{formatOptionalNumber(loadedDetail.vsize)}</span>
              </div>
              <div className="detail-panel__kv">
                <span>Weight</span>
                <span>{formatOptionalNumber(loadedDetail.weight)}</span>
              </div>
              <div className="detail-panel__kv">
                <span>Version</span>
                <span>{formatOptionalNumber(loadedDetail.version)}</span>
              </div>
            </div>
            {isUnclassified && (
              <div className="detail-panel__warning surface-card state-tone state-tone--warning state-surface">
                <strong>Unclassified Transaction</strong>
                <span>Adding classification improves audit traceability and tax reporting.</span>
              </div>
            )}

            <div className="detail-panel__section surface-card border-variant-subtle">
              <h3 className="section-header">Labels &amp; Classification</h3>
              <label className="detail-panel__field">
                <span className="detail-panel__field-label">Primary Classification</span>
                <select
                  className="control-select"
                  value={classificationCategory}
                  onChange={(event) => {
                    setClassificationCategory(event.target.value)
                    if (classificationError) setClassificationError(null)
                    if (classificationToast) setClassificationToast(null)
                  }}
                >
                  {classificationOptions.map((option) => (
                    <option key={option.value || 'empty'} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="detail-panel__field">
                <span className="detail-panel__field-label">Business context</span>
                <textarea
                  className="control-input detail-panel__textarea"
                  value={classificationContext}
                  onChange={(event) => {
                    setClassificationContext(event.target.value)
                    if (classificationError) setClassificationError(null)
                    if (classificationToast) setClassificationToast(null)
                  }}
                  placeholder="Add business context for this transaction."
                  rows={3}
                />
              </label>

              <label className="detail-panel__field detail-panel__field--checkbox">
                <span className="detail-panel__field-label">Tax relevant</span>
                <input
                  type="checkbox"
                  className="detail-panel__checkbox"
                  checked={classificationTaxRelevant}
                  onChange={(event) => {
                    setClassificationTaxRelevant(event.target.checked)
                    if (classificationError) setClassificationError(null)
                    if (classificationToast) setClassificationToast(null)
                  }}
                />
              </label>

              <details className="detail-panel__metadata">
                <summary className="detail-panel__metadata-summary">Metadata (JSON)</summary>
                <textarea
                  className="control-input detail-panel__textarea"
                  value={classificationMetadata}
                  onChange={(event) => {
                    setClassificationMetadata(event.target.value)
                    if (classificationError) setClassificationError(null)
                    if (classificationToast) setClassificationToast(null)
                  }}
                  placeholder='{"invoice": "INV-1001"}'
                  rows={4}
                />
              </details>

              {classificationError && (
                <p className="detail-panel__inline-error state-tone state-tone--error state-text">
                  {classificationError}
                </p>
              )}

              <div className="detail-panel__actions">
                <button
                  type="button"
                  className="control-button"
                  onClick={() => void handleSaveClassification()}
                  disabled={saveClassificationDisabled}
                >
                  {classificationSaving ? (
                    <>
                      <span className="spinner spinner--sm" aria-hidden="true" />
                      <span>Saving…</span>
                    </>
                  ) : (
                    'Save Classification'
                  )}
                </button>
              </div>
              {classificationToast && (
                <p
                  className="detail-panel__inline-toast surface-card state-tone state-tone--success state-surface"
                  role="status"
                  aria-live="polite"
                >
                  {classificationToast}
                </p>
              )}

              <div className="detail-panel__divider" />

              <label className="detail-panel__field">
                <span className="detail-panel__field-label">BIP-329 Label</span>
                <div className="detail-panel__label-row">
                  <input
                    className="control-input detail-panel__label-input"
                    value={labelInput}
                    onChange={(event) => {
                      setLabelInput(event.target.value)
                      if (labelError) setLabelError(null)
                      if (labelToast) setLabelToast(null)
                    }}
                    placeholder="Add a label for this transaction."
                  />
                  <div className="detail-panel__label-actions">
                    <button
                      type="button"
                      className="control-button"
                      onClick={() => void handleSaveLabel()}
                      disabled={saveLabelDisabled}
                    >
                      {labelSaving ? (
                        <>
                          <span className="spinner spinner--sm" aria-hidden="true" />
                          <span>Saving…</span>
                        </>
                      ) : (
                        'Save Label'
                      )}
                    </button>
                    {hasPersistedLabel && (
                      <button
                        type="button"
                        className="control-button"
                        onClick={() => void handleDeleteLabel()}
                        disabled={deleteLabelDisabled}
                      >
                        {labelDeleting ? (
                          <>
                            <span className="spinner spinner--sm" aria-hidden="true" />
                            <span>Deleting…</span>
                          </>
                        ) : (
                          'Delete Label'
                        )}
                      </button>
                    )}
                  </div>
                </div>
              </label>
              {labelToast && (
                <p
                  className="detail-panel__inline-toast surface-card state-tone state-tone--success state-surface"
                  role="status"
                  aria-live="polite"
                >
                  {labelToast}
                </p>
              )}

              {labelError && (
                <p className="detail-panel__inline-error state-tone state-tone--error state-text">{labelError}</p>
              )}
            </div>


            <div className="detail-panel__section surface-card border-variant-subtle">
              <h3 className="section-header">Outputs</h3>
              {loadedDetail.outputs.length === 0 && (
                <p className="detail-panel__placeholder state-tone state-tone--empty state-text">
                  No outputs.
                </p>
              )}
              {loadedDetail.outputs.length > 0 && (
                <ul className="detail-panel__outputs">
                  {loadedDetail.outputs.map((output) => {
                    const address = output.address?.trim() ?? ''
                    const hasAddress = address.length > 0
                    const scriptPubKey = output.script_pubkey_hex?.trim() ?? ''
                    const destinationValue = hasAddress ? address : scriptPubKey
                    const destinationLabel = hasAddress ? 'Address' : 'Script'
                    const destinationFallback = hasAddress ? 'Address unavailable' : 'Script unavailable'
                    const destinationDisplay = destinationValue || destinationFallback
                    const scriptType = output.script_type?.trim() || 'Unknown script'
                    const outputLabel = output.label?.trim() ?? ''
                    const classificationCategory = output.classification?.category?.trim() ?? ''
                    const classificationContext = output.classification?.context?.trim() ?? ''
                    const classificationSummaryParts = [
                      classificationContext,
                      output.classification?.tax_relevant ? 'Tax relevant' : '',
                    ].filter((part) => part.length > 0)
                    const classificationSummary = classificationSummaryParts.join(' • ')
                    const hasOutputTags =
                      outputLabel.length > 0 ||
                      classificationCategory.length > 0 ||
                      classificationSummary.length > 0

                    return (
                      <li key={output.vout} className="detail-panel__output-item">
                        <div className="detail-panel__output-header">
                          <span>vout {output.vout}</span>
                          <span>{output.value_sat.toLocaleString()} sat</span>
                        </div>
                        <div className="detail-panel__output-meta">
                          <div className="detail-panel__output-meta-row">
                            <span className="detail-panel__output-meta-label">{destinationLabel}</span>
                            <span
                              className="detail-panel__output-meta-value detail-panel__output-destination"
                              title={destinationDisplay}
                            >
                              {destinationDisplay}
                            </span>
                          </div>
                          <div className="detail-panel__output-meta-row">
                            <span className="detail-panel__output-meta-label">Script type</span>
                            <span className="detail-panel__output-meta-value" title={scriptType}>
                              {scriptType}
                            </span>
                          </div>
                        </div>
                        {hasOutputTags && (
                          <div className="detail-panel__output-tags">
                            {outputLabel && (
                              <span className="detail-panel__output-label" title={outputLabel}>
                                Label: {outputLabel}
                              </span>
                            )}
                            {classificationCategory && (
                              <span className="tx-badge tx-badge--classification" title={classificationCategory}>
                                {classificationCategory}
                              </span>
                            )}
                            {classificationSummary && (
                              <span className="detail-panel__output-summary" title={classificationSummary}>
                                {classificationSummary}
                              </span>
                            )}
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </>
        )}
      </div>
    </aside>
  )
}

export default DetailPanel
