import { invoke } from '@tauri-apps/api/core'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useTransactionDetail } from '../hooks/useTransactionDetail'
import {
  getGraphControlsSnapshot,
  subscribeGraphControls,
} from '../state/graphControls'
import type { Classification, RefType } from '../types/api'

type DetailPanelProps = {
  selectedTxid: string | null
  collapsed?: boolean
  onGraphRefresh?: () => Promise<void>
  onSetAsRoot?: (txid: string) => void
  onResetRoot?: () => void
  onFocusNode?: (txid: string) => void
}

type DetailPanelState = 'loading' | 'load-error' | 'loaded'
type DetailStatus = 'confirmed' | 'mempool' | 'unknown'

const UNKNOWN_VALUE = 'N/A'
const INLINE_TOAST_TIMEOUT_MS = 3000

const CLASSIFICATION_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'Select classification...' },
  { value: 'revenue', label: 'Revenue' },
  { value: 'expense', label: 'Expense' },
  { value: 'internal_transfer', label: 'Internal Transfer' },
  { value: 'loan', label: 'Loan' },
  { value: 'owner_contribution', label: 'Owner Contribution' },
  { value: 'refund', label: 'Refund' },
  { value: 'salary', label: 'Salary' },
  { value: 'tax_payment', label: 'Tax Payment' },
  { value: 'other', label: 'Other' },
]

function getAuditModeSnapshot(): boolean {
  return getGraphControlsSnapshot().auditMode
}

function toReadableStatus(confirmations: number | null | undefined): DetailStatus {
  if (confirmations == null) return 'unknown'
  return confirmations > 0 ? 'confirmed' : 'mempool'
}

function formatTimestamp(unixTimestamp: number | null | undefined): string {
  if (unixTimestamp == null || !Number.isFinite(unixTimestamp)) return UNKNOWN_VALUE
  const date = new Date(unixTimestamp * 1000)
  if (!Number.isFinite(date.getTime())) return UNKNOWN_VALUE
  return date.toLocaleString()
}

function formatOptionalNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return UNKNOWN_VALUE
  return value.toLocaleString()
}

function toDisplayTxid(txid: string | null | undefined): string {
  const t = (txid ?? '').trim()
  return t.length > 0 ? t : UNKNOWN_VALUE
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
    // ignore
  } finally {
    document.body.removeChild(textarea)
  }
}

function shortTxid(txid: string): string {
  if (txid.length <= 16) return txid
  return `${txid.slice(0, 8)}...${txid.slice(-8)}`
}

// ── Inline SVG icons ─────────────────────────────────────────────────────────

function CopyIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="5" y="5" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M11 5V3.5A1.5 1.5 0 009.5 2h-6A1.5 1.5 0 002 3.5v6A1.5 1.5 0 003.5 11H5"
        stroke="currentColor"
        strokeWidth="1.4"
      />
    </svg>
  )
}

function FileIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3 2h7l3 3v9a1 1 0 01-1 1H3a1 1 0 01-1-1V3a1 1 0 011-1z"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <path d="M10 2v4h4" stroke="currentColor" strokeWidth="1.3" />
      <path d="M5 8h6M5 11h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

function ClockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M8 5v3.5l2 1.5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function ChevronDown() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path
        d="M2.5 4.5l3.5 3.5 3.5-3.5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function ChevronUp() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path
        d="M2.5 7.5l3.5-3.5 3.5 3.5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <label className="toggle">
      <input
        type="checkbox"
        className="toggle__input"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="toggle__track">
        <span className="toggle__thumb" />
      </span>
    </label>
  )
}

// ── Component ────────────────────────────────────────────────────────────────

function DetailPanel({
  selectedTxid,
  collapsed = false,
  onGraphRefresh,
  onSetAsRoot,
  onResetRoot,
  onFocusNode,
}: DetailPanelProps) {
  // ── Store subscriptions (must be before any early returns) ───────────────
  const auditMode = useSyncExternalStore(
    subscribeGraphControls,
    getAuditModeSnapshot,
    getAuditModeSnapshot,
  )

  // ── Data fetching ────────────────────────────────────────────────────────
  const { detail, loading, error, reload } = useTransactionDetail(selectedTxid)
  const activeTxid = (selectedTxid ?? '').trim()
  const hasSelection = activeTxid.length > 0
  const isStaleDetail = !!detail && detail.txid.trim() !== activeTxid
  const isLoading = loading || (hasSelection && isStaleDetail && !error)
  const loadError =
    error ??
    (!isLoading && hasSelection && !detail ? 'No detail data returned for this transaction.' : null)
  const state: DetailPanelState = isLoading ? 'loading' : loadError ? 'load-error' : 'loaded'
  const loadedDetail = state === 'loaded' ? detail : null
  const detailStatus = loadedDetail ? toReadableStatus(loadedDetail.confirmations) : 'unknown'
  const displayTxid = toDisplayTxid(loadedDetail?.txid)
  const hasCopyableTxid = displayTxid !== UNKNOWN_VALUE

  // ── Classification form state ────────────────────────────────────────────
  const [classificationCategory, setClassificationCategory] = useState('')
  const [classificationContext, setClassificationContext] = useState('')
  const [classificationTaxRelevant, setClassificationTaxRelevant] = useState(false)
  const [metaInvoiceId, setMetaInvoiceId] = useState('')
  const [metaCounterparty, setMetaCounterparty] = useState('')
  const [metaGlCategory, setMetaGlCategory] = useState('')
  const [metaExternalRef, setMetaExternalRef] = useState('')
  const [accountingExpanded, setAccountingExpanded] = useState(false)
  const [classificationSaving, setClassificationSaving] = useState(false)
  const [classificationError, setClassificationError] = useState<string | null>(null)
  const [classificationToast, setClassificationToast] = useState<string | null>(null)

  // ── Label form state ─────────────────────────────────────────────────────
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

  // ── Sync form with loaded detail ─────────────────────────────────────────
  useEffect(() => {
    if (!loadedDetail) {
      setClassificationCategory('')
      setClassificationContext('')
      setClassificationTaxRelevant(false)
      setMetaInvoiceId('')
      setMetaCounterparty('')
      setMetaGlCategory('')
      setMetaExternalRef('')
      setLabelInput('')
      setClassificationError(null)
      setClassificationToast(null)
      setLabelError(null)
      setLabelToast(null)
      return
    }
    setClassificationCategory(loadedDetail.classification?.category ?? '')
    setClassificationContext(loadedDetail.classification?.context ?? '')
    setClassificationTaxRelevant(loadedDetail.classification?.tax_relevant ?? false)
    const meta = loadedDetail.classification?.metadata ?? {}
    setMetaInvoiceId(String(meta.invoice_id ?? ''))
    setMetaCounterparty(String(meta.counterparty ?? ''))
    setMetaGlCategory(String(meta.gl_category ?? ''))
    setMetaExternalRef(String(meta.external_ref ?? ''))
    setLabelInput(loadedDetail.label ?? '')
    setClassificationError(null)
    setClassificationToast(null)
    setLabelError(null)
    setLabelToast(null)
  }, [loadedDetail])

  // ── Toast auto-dismiss ───────────────────────────────────────────────────
  useEffect(() => {
    if (!labelToast) return
    const id = window.setTimeout(() => setLabelToast(null), INLINE_TOAST_TIMEOUT_MS)
    return () => window.clearTimeout(id)
  }, [labelToast])

  useEffect(() => {
    if (!classificationToast) return
    const id = window.setTimeout(() => setClassificationToast(null), INLINE_TOAST_TIMEOUT_MS)
    return () => window.clearTimeout(id)
  }, [classificationToast])

  useEffect(() => {
    if (!selectionNotice) return
    const id = window.setTimeout(() => setSelectionNotice(null), INLINE_TOAST_TIMEOUT_MS)
    return () => window.clearTimeout(id)
  }, [selectionNotice])

  useEffect(() => {
    activeTxidRef.current = activeTxid
  }, [activeTxid])

  // ── Derived values ───────────────────────────────────────────────────────
  const formDetail = detail
  const existingClassificationCategory = formDetail?.classification?.category?.trim() ?? ''
  const existingClassificationContext = formDetail?.classification?.context?.trim() ?? ''
  const existingClassificationTaxRelevant = formDetail?.classification?.tax_relevant ?? false
  const existingMeta = formDetail?.classification?.metadata ?? {}
  const existingMetaInvoiceId = String(existingMeta.invoice_id ?? '')
  const existingMetaCounterparty = String(existingMeta.counterparty ?? '')
  const existingMetaGlCategory = String(existingMeta.gl_category ?? '')
  const existingMetaExternalRef = String(existingMeta.external_ref ?? '')

  const normalizedClassificationCategory = classificationCategory.trim()
  const normalizedExistingLabel = (formDetail?.label ?? '').trim()
  const normalizedLabelInput = labelInput.trim()
  const hasPersistedLabel = normalizedExistingLabel.length > 0
  const labelChanged = normalizedLabelInput !== normalizedExistingLabel

  const classificationChanged =
    !!formDetail &&
    (normalizedClassificationCategory !== existingClassificationCategory ||
      classificationContext.trim() !== existingClassificationContext ||
      metaInvoiceId.trim() !== existingMetaInvoiceId ||
      metaCounterparty.trim() !== existingMetaCounterparty ||
      metaGlCategory.trim() !== existingMetaGlCategory ||
      metaExternalRef.trim() !== existingMetaExternalRef ||
      classificationTaxRelevant !== existingClassificationTaxRelevant)

  const hasUnsavedChanges = !!formDetail && (classificationChanged || labelChanged)
  const isUnclassified =
    !!loadedDetail && (loadedDetail.classification?.category?.trim() ?? '').length === 0
  const saveClassificationDisabled = classificationSaving || !normalizedClassificationCategory
  const saveLabelDisabled = labelSaving || labelDeleting || !normalizedLabelInput || !labelChanged
  const deleteLabelDisabled = labelDeleting || labelSaving

  // Extend options list with any persisted category not in the predefined set
  const classificationOptions = useMemo(() => {
    const options = [...CLASSIFICATION_OPTIONS]
    if (normalizedClassificationCategory && !options.some((o) => o.value === normalizedClassificationCategory)) {
      options.splice(1, 0, { value: normalizedClassificationCategory, label: normalizedClassificationCategory })
    }
    return options
  }, [normalizedClassificationCategory])

  // ── Warn about unsaved changes when switching tx ─────────────────────────
  useEffect(() => {
    const previousTxid = previousTxidRef.current
    previousTxidRef.current = activeTxid
    if (!previousTxid || previousTxid === activeTxid) return
    if (!hasUnsavedChanges) return
    setSelectionNotice('Unsaved edits were cleared when you switched transactions.')
  }, [activeTxid, hasUnsavedChanges])

  // ── Mutation helpers ─────────────────────────────────────────────────────
  async function refreshAfterMutation() {
    await reload({ txid: activeTxidRef.current, throwOnError: true })
    if (onGraphRefresh) await onGraphRefresh()
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

    // Build metadata preserving unknown keys, overwriting known structured fields
    const baseMetadata = loadedDetail.classification?.metadata ?? {}
    const meta: Record<string, unknown> = { ...baseMetadata }
    delete meta.invoice_id
    delete meta.counterparty
    delete meta.gl_category
    delete meta.external_ref
    if (metaInvoiceId.trim()) meta.invoice_id = metaInvoiceId.trim()
    if (metaCounterparty.trim()) meta.counterparty = metaCounterparty.trim()
    if (metaGlCategory.trim()) meta.gl_category = metaGlCategory.trim()
    if (metaExternalRef.trim()) meta.external_ref = metaExternalRef.trim()

    setClassificationSaving(true)
    setClassificationError(null)
    setClassificationToast(null)

    try {
      const payload: Classification = {
        category,
        context: classificationContext,
        metadata: meta,
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
        `Classification saved, but failed to refresh: ${toErrorMessage(refreshError)}`,
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
      setLabelError(`Label saved, but failed to refresh: ${toErrorMessage(refreshError)}`)
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
      setLabelError(`Label deleted, but failed to refresh: ${toErrorMessage(refreshError)}`)
    } finally {
      setLabelDeleting(false)
      labelMutationRef.current = false
    }
  }

  // ── Early returns (AFTER all hook calls) ─────────────────────────────────
  if (!hasSelection) return null

  if (collapsed) {
    return (
      <aside
        className="detail-panel detail-panel--collapsed surface-panel"
        aria-label="Transaction details"
      >
        <div className="detail-panel__collapsed-label">Details</div>
      </aside>
    )
  }

  // ── Full panel ───────────────────────────────────────────────────────────
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

        {state === 'loading' && (
          <p className="detail-panel__status state-tone state-tone--loading state-text">
            <span className="spinner spinner--sm" aria-hidden="true" />
            <span>Loading {shortTxid(activeTxid)}…</span>
          </p>
        )}

        {state === 'load-error' && (
          <div className="detail-panel__error surface-card state-tone state-tone--error state-surface">
            <strong>Failed to load transaction</strong>
            <span>{loadError ?? 'Unknown error'}</span>
          </div>
        )}

        {state === 'loaded' && loadedDetail && (
          <>
            {/* Unclassified warning — hidden in audit mode */}
            {isUnclassified && !auditMode && (
              <div className="detail-panel__warning surface-card state-tone state-tone--warning state-surface">
                <strong>Unclassified Transaction</strong>
                <span>Adding classification improves audit traceability and tax reporting.</span>
              </div>
            )}

            {/* ── Section 1: Labels & Classification (hidden in audit mode) ── */}
            {!auditMode && (
              <div className="detail-panel__section surface-card border-variant-subtle">
                <h3 className="section-header">Labels &amp; Classification</h3>

                {/* 1A: Primary Classification dropdown */}
                <label className="detail-panel__field">
                  <span className="detail-panel__field-label">
                    Primary Classification{' '}
                    <span style={{ color: '#ef4444' }} aria-hidden="true">*</span>
                  </span>
                  <select
                    className="control-select"
                    value={classificationCategory}
                    onChange={(e) => {
                      setClassificationCategory(e.target.value)
                      if (classificationError) setClassificationError(null)
                      if (classificationToast) setClassificationToast(null)
                    }}
                  >
                    {classificationOptions.map((opt) => (
                      <option key={opt.value || 'empty'} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </label>

                {/* 1B: Business context */}
                <label className="detail-panel__field">
                  <span className="detail-panel__field-label">Business context</span>
                  <textarea
                    className="control-input detail-panel__textarea"
                    value={classificationContext}
                    onChange={(e) => {
                      setClassificationContext(e.target.value)
                      if (classificationError) setClassificationError(null)
                      if (classificationToast) setClassificationToast(null)
                    }}
                    placeholder="Explanation for audit purposes..."
                    rows={3}
                  />
                </label>

                {/* 1C: Accounting Metadata collapsible */}
                <div>
                  <button
                    type="button"
                    className="control-button detail-panel__accounting-toggle"
                    onClick={() => setAccountingExpanded((v) => !v)}
                    aria-expanded={accountingExpanded}
                  >
                    <span>Accounting Metadata</span>
                    <span className="detail-panel__accounting-chevron">
                      {accountingExpanded ? <ChevronUp /> : <ChevronDown />}
                    </span>
                  </button>

                  {accountingExpanded && (
                    <div className="detail-panel__accounting-expanded">
                      <div className="detail-panel__accounting-field">
                        <span className="detail-panel__accounting-label">Invoice ID</span>
                        <input
                          className="control-input detail-panel__accounting-input"
                          value={metaInvoiceId}
                          onChange={(e) => {
                            setMetaInvoiceId(e.target.value)
                            if (classificationError) setClassificationError(null)
                          }}
                          placeholder="INV-2026-001"
                        />
                      </div>
                      <div className="detail-panel__accounting-field">
                        <span className="detail-panel__accounting-label">Counterparty name</span>
                        <input
                          className="control-input detail-panel__accounting-input"
                          value={metaCounterparty}
                          onChange={(e) => {
                            setMetaCounterparty(e.target.value)
                            if (classificationError) setClassificationError(null)
                          }}
                          placeholder="Entity or person"
                        />
                      </div>
                      <div className="detail-panel__accounting-field">
                        <span className="detail-panel__accounting-label">GL category</span>
                        <input
                          className="control-input detail-panel__accounting-input"
                          value={metaGlCategory}
                          onChange={(e) => {
                            setMetaGlCategory(e.target.value)
                            if (classificationError) setClassificationError(null)
                          }}
                          placeholder="General ledger code"
                        />
                      </div>
                      <div className="detail-panel__accounting-field">
                        <span className="detail-panel__accounting-label">External reference</span>
                        <input
                          className="control-input detail-panel__accounting-input"
                          value={metaExternalRef}
                          onChange={(e) => {
                            setMetaExternalRef(e.target.value)
                            if (classificationError) setClassificationError(null)
                          }}
                          placeholder="ERP or system ID"
                        />
                      </div>
                      <div className="detail-panel__tax-toggle">
                        <span className="detail-panel__tax-toggle-label">Tax relevance</span>
                        <Toggle
                          checked={classificationTaxRelevant}
                          onChange={(v) => {
                            setClassificationTaxRelevant(v)
                            if (classificationError) setClassificationError(null)
                          }}
                        />
                      </div>
                    </div>
                  )}
                </div>

                {classificationError && (
                  <p className="detail-panel__inline-error state-tone state-tone--error state-text">
                    {classificationError}
                  </p>
                )}

                {/* 1D: Save Classification button */}
                <div className="detail-panel__actions">
                  <button
                    type="button"
                    className="control-button detail-panel__save-btn"
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

                {/* BIP-329 Label */}
                <label className="detail-panel__field">
                  <span className="detail-panel__field-label">BIP-329 Label</span>
                  <div className="detail-panel__label-row">
                    <input
                      className="control-input detail-panel__label-input"
                      value={labelInput}
                      onChange={(e) => {
                        setLabelInput(e.target.value)
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
                  <p className="detail-panel__inline-error state-tone state-tone--error state-text">
                    {labelError}
                  </p>
                )}
              </div>
            )}

            {/* ── Section 2: Label Source Metadata (only if label exists) ── */}
            {!!loadedDetail.label && loadedDetail.label.trim().length > 0 && (
              <div className="detail-panel__label-source surface-card border-variant-subtle">
                <div className="detail-panel__label-source-header">
                  <FileIcon />
                  <span>Label Source</span>
                </div>
                <div className="detail-panel__label-source-rows">
                  <div className="detail-panel__label-source-row">
                    <span className="detail-panel__label-source-key">Created:</span>
                    <span className="detail-panel__label-source-value">N/A</span>
                  </div>
                  <div className="detail-panel__label-source-row">
                    <span className="detail-panel__label-source-key">Modified:</span>
                    <span className="detail-panel__label-source-value">N/A</span>
                  </div>
                  <div className="detail-panel__label-source-row">
                    <span className="detail-panel__label-source-key">Source:</span>
                    <span className="detail-panel__source-badge">Manual</span>
                  </div>
                </div>
              </div>
            )}

            <div className="detail-panel__separator" />

            {/* ── Section 3: Transaction ── */}
            <div className="detail-panel__section surface-card border-variant-subtle">
              <h3 className="section-header">Transaction</h3>

              {/* 3A: TXID */}
              <div>
                <span className="detail-panel__stat-label">Transaction ID</span>
                <div className="detail-panel__txid-row">
                  <code className="detail-panel__txid-mono" title={displayTxid}>
                    {displayTxid}
                  </code>
                  <button
                    type="button"
                    className="detail-panel__small-copy"
                    onClick={() => void copyTextToClipboard(displayTxid)}
                    aria-label="Copy transaction ID"
                    disabled={!hasCopyableTxid}
                  >
                    <CopyIcon />
                  </button>
                </div>
              </div>

              {/* 3B: Status & Confirmations */}
              <div className="detail-panel__stat-grid">
                <div>
                  <span className="detail-panel__stat-label">Status</span>
                  <span className={`tx-badge tx-badge--status tx-badge--status-${detailStatus}`}>
                    {detailStatus}
                  </span>
                </div>
                <div>
                  <span className="detail-panel__stat-label">Confirmations</span>
                  <span className="detail-panel__stat-value">
                    {formatOptionalNumber(loadedDetail.confirmations)}
                  </span>
                </div>
              </div>

              {/* 3C: Block height & Time (only when confirmed) */}
              {detailStatus === 'confirmed' && (
                <div className="detail-panel__stat-grid">
                  <div>
                    <span className="detail-panel__stat-label">Block Height</span>
                    <span className="detail-panel__stat-value">
                      {formatOptionalNumber(loadedDetail.block_height)}
                    </span>
                  </div>
                  <div>
                    <span className="detail-panel__stat-label">Time</span>
                    <span className="detail-panel__stat-value">
                      {formatTimestamp(loadedDetail.block_time)}
                    </span>
                  </div>
                </div>
              )}

              {/* 3D: Audit mode banner */}
              {auditMode && (
                <div className="detail-panel__audit-banner">
                  <ClockIcon />
                  <span>Audit Trail Verified</span>
                </div>
              )}

              {/* 3E: Metrics */}
              <div className="detail-panel__metric-grid">
                <div>
                  <span className="detail-panel__stat-label">vsize</span>
                  <span className="detail-panel__stat-value">
                    {formatOptionalNumber(loadedDetail.vsize)}
                  </span>
                </div>
                <div>
                  <span className="detail-panel__stat-label">Weight</span>
                  <span className="detail-panel__stat-value">
                    {formatOptionalNumber(loadedDetail.weight)}
                  </span>
                </div>
                <div>
                  <span className="detail-panel__stat-label">Version</span>
                  <span className="detail-panel__stat-value">
                    {formatOptionalNumber(loadedDetail.version)}
                  </span>
                </div>
              </div>
            </div>

            <div className="detail-panel__separator" />

            {/* ── Section 4: Outputs ── */}
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
                    const scriptType = output.script_type?.trim() ?? ''
                    const outputLabel = output.label?.trim() ?? ''
                    const hasLabel = outputLabel.length > 0
                    const classificationCat = output.classification?.category?.trim() ?? ''
                    const taxRelevant = output.classification?.tax_relevant ?? false
                    const hasOutputTags = hasLabel || classificationCat.length > 0

                    return (
                      <li key={output.vout} className="detail-panel__output-item">
                        {/* Row 1: vout + value + script type + label button */}
                        <div className="detail-panel__output-row1">
                          <span className="detail-panel__output-vout">vout {output.vout}</span>
                          <span className="detail-panel__output-value">
                            {output.value_sat.toLocaleString()} sat
                          </span>
                          {scriptType && (
                            <span className="tx-badge detail-panel__script-badge">
                              {scriptType}
                            </span>
                          )}
                          <button
                            type="button"
                            className={`control-button detail-panel__output-label-btn${hasLabel ? ' detail-panel__output-label-btn--labeled' : ''}`}
                          >
                            {hasLabel ? 'Edit' : 'Label'}
                          </button>
                        </div>

                        {/* Row 2: classification + tax badges */}
                        {hasOutputTags && (
                          <div className="detail-panel__output-row2">
                            {classificationCat && (
                              <span className="detail-panel__output-class-badge">
                                {classificationCat}
                              </span>
                            )}
                            {taxRelevant && (
                              <span className="detail-panel__output-tax-badge">Tax</span>
                            )}
                          </div>
                        )}

                        {/* Row 3: address + copy */}
                        {hasAddress && (
                          <div className="detail-panel__output-row3">
                            <span className="detail-panel__output-addr" title={address}>
                              {address}
                            </span>
                            <button
                              type="button"
                              className="detail-panel__small-copy"
                              onClick={() => void copyTextToClipboard(address)}
                              aria-label="Copy address"
                            >
                              <CopyIcon />
                            </button>
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>

            <div className="detail-panel__separator" />

            {/* ── Section 5: Inputs ── */}
            <div className="detail-panel__section surface-card border-variant-subtle">
              <h3 className="section-header">Inputs</h3>
              {loadedDetail.inputs.length === 0 && (
                <p className="detail-panel__placeholder state-tone state-tone--empty state-text">
                  No inputs.
                </p>
              )}
              {loadedDetail.inputs.length > 0 && (
                <ul className="detail-panel__inputs">
                  {loadedDetail.inputs.map((input) => {
                    const prevout = `${input.prev_txid}:${input.prev_vout}`
                    return (
                      <li key={input.vin} className="detail-panel__input-item">
                        <span className="detail-panel__input-vin">vin {input.vin}</span>
                        {input.is_coinbase ? (
                          <span className="detail-panel__input-coinbase">Coinbase</span>
                        ) : (
                          <div className="detail-panel__input-prevout">
                            <span
                              className="detail-panel__input-prevout-text"
                              title={prevout}
                            >
                              {prevout}
                            </span>
                            <button
                              type="button"
                              className="detail-panel__small-copy"
                              onClick={() => void copyTextToClipboard(prevout)}
                              aria-label="Copy prevout"
                            >
                              <CopyIcon />
                            </button>
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>

            {/* ── Section 6: Actions (hidden in audit mode) ── */}
            {!auditMode && (
              <>
                <div className="detail-panel__separator" />
                <div className="detail-panel__section surface-card border-variant-subtle">
                  <h3 className="section-header">Actions</h3>
                  <div className="detail-panel__actions-section">
                    <button
                      type="button"
                      className="control-button detail-panel__action-button"
                      onClick={() => onFocusNode?.(activeTxid)}
                    >
                      Focus on this node
                    </button>
                    <button
                      type="button"
                      className="control-button detail-panel__action-button"
                      onClick={() => onSetAsRoot?.(activeTxid)}
                    >
                      Set as root
                    </button>
                    <button
                      type="button"
                      className="control-button detail-panel__action-button"
                      onClick={() => onResetRoot?.()}
                    >
                      Back to original root
                    </button>
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </aside>
  )
}

export default DetailPanel
