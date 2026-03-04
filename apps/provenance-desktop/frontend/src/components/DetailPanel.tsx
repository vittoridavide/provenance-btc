import { invoke } from '@tauri-apps/api/core'
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { useTransactionDetail } from '../hooks/useTransactionDetail'
import {
  getGraphControlsSnapshot,
  subscribeGraphControls,
} from '../state/graphControls'
import type { Classification, RefType, TransactionDetail, TxOutput } from '../types/api'

type DetailPanelProps = {
  selectedTxid: string | null
  collapsed?: boolean
  onGraphRefresh?: () => Promise<void>
  onDeselect?: () => void
}

type DetailPanelState = 'loading' | 'load-error' | 'loaded'
type DetailStatus = 'confirmed' | 'mempool' | 'unknown'
type ToastTone = 'success' | 'error' | 'info'

type InlineToast = {
  tone: ToastTone
  title: string
  description?: string
}

type OutputDraft = {
  classification: string
  internalChange: boolean
  notes: string
}

const UNKNOWN_VALUE = 'N/A'
const INLINE_TOAST_TIMEOUT_MS = 3000
const INFO_PLACEHOLDER = '—'

const CLASSIFICATION_OPTIONS: Array<{ value: string; label: string }> = [
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

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return 'Unknown error'
  }
}

function toDisplayTxid(txid: string | null | undefined): string {
  const normalized = (txid ?? '').trim()
  return normalized.length > 0 ? normalized : UNKNOWN_VALUE
}

function asMetadataRecord(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return {}
}

function readMetadataString(metadata: Record<string, unknown>, key: string): string {
  const value = metadata[key]
  return typeof value === 'string' ? value : ''
}

function readMetadataBoolean(metadata: Record<string, unknown>, key: string): boolean {
  const value = metadata[key]
  return typeof value === 'boolean' ? value : false
}

function formatAuditDate(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(value * 1000)
    if (Number.isFinite(date.getTime())) return date.toLocaleString()
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.length === 0) return UNKNOWN_VALUE
    const numeric = Number(trimmed)
    if (Number.isFinite(numeric) && /^\d+(\.\d+)?$/.test(trimmed)) {
      const date = new Date(numeric * 1000)
      if (Number.isFinite(date.getTime())) return date.toLocaleString()
    }
    const parsedDate = new Date(trimmed)
    if (Number.isFinite(parsedDate.getTime())) return parsedDate.toLocaleString()
    return trimmed
  }

  return UNKNOWN_VALUE
}

function formatBlockTime(value: number | null | undefined): string {
  if (value == null) return INFO_PLACEHOLDER
  const date = new Date(value * 1000)
  if (!Number.isFinite(date.getTime())) return INFO_PLACEHOLDER
  return date.toLocaleString()
}

function statusBadgeLabel(status: DetailStatus, confirmations: number | null | undefined): string {
  if (status === 'confirmed') {
    if (confirmations == null || !Number.isFinite(confirmations)) return 'Confirmed'
    return `Confirmed · ${confirmations} conf`
  }
  if (status === 'mempool') return 'In Mempool'
  return 'Missing'
}

function formatBtc(valueSat: number): string {
  const valueBtc = valueSat / 100_000_000
  return `${valueBtc.toFixed(8).replace(/\.?0+$/, '')} BTC`
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
  } finally {
    document.body.removeChild(textarea)
  }
}

function SaveIcon() {
  return (
    <svg className="detail-panel__icon-inline" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3 2.5h8l2 2V13a1 1 0 01-1 1H4a1 1 0 01-1-1V2.5z"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <path d="M5 2.5h5v3H5z" stroke="currentColor" strokeWidth="1.2" />
      <path d="M5.2 10.2h5.6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

function XIcon() {
  return (
    <svg className="detail-panel__icon-inline" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M4 4l8 8M12 4l-8 8"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  )
}

function CopyIcon() {
  return (
    <svg className="detail-panel__icon-inline detail-panel__icon-inline--copy" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="5" y="5" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M11 5V3.5A1.5 1.5 0 009.5 2h-6A1.5 1.5 0 002 3.5v6A1.5 1.5 0 003.5 11H5"
        stroke="currentColor"
        strokeWidth="1.4"
      />
    </svg>
  )
}

function TagIcon() {
  return (
    <svg className="detail-panel__title-icon" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M10.2 2.6H4.4a1.8 1.8 0 00-1.8 1.8v5.8c0 .5.2.9.5 1.3l5.9 5.9c.7.7 1.9.7 2.6 0l5-5a1.8 1.8 0 000-2.6l-5.9-5.9a1.8 1.8 0 00-1.3-.5z"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <circle cx="6.2" cy="6.2" r="1.2" fill="currentColor" />
    </svg>
  )
}

function AlertCircleIcon() {
  return (
    <svg className="detail-panel__icon-inline" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6.2" stroke="currentColor" strokeWidth="1.2" />
      <path d="M8 4.7v4.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <circle cx="8" cy="11.5" r="0.85" fill="currentColor" />
    </svg>
  )
}

function ShieldIcon() {
  return (
    <svg className="detail-panel__icon-inline" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 1.8l4.8 1.7v4.2c0 3.1-2 5.9-4.8 6.9-2.8-1-4.8-3.8-4.8-6.9V3.5L8 1.8z"
        stroke="currentColor"
        strokeWidth="1.2"
      />
    </svg>
  )
}

function ChevronDownIcon() {
  return (
    <svg className="detail-panel__icon-inline detail-panel__icon-inline--chevron" viewBox="0 0 12 12" fill="none" aria-hidden="true">
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

function ChevronUpIcon() {
  return (
    <svg className="detail-panel__icon-inline detail-panel__icon-inline--chevron" viewBox="0 0 12 12" fill="none" aria-hidden="true">
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

function CircleStatusIcon() {
  return <span className="detail-panel__status-circle" aria-hidden="true" />
}

function initialOutputDraft(output: TxOutput): OutputDraft {
  const metadata = asMetadataRecord(output.classification?.metadata)
  return {
    classification: output.classification?.category?.trim() ?? '',
    internalChange: readMetadataBoolean(metadata, 'internal_change'),
    notes: output.label?.trim() ?? '',
  }
}

function createOutputDraftMap(detail: TransactionDetail): Record<number, OutputDraft> {
  const entries = detail.outputs.map((output) => [output.vout, initialOutputDraft(output)] as const)
  return Object.fromEntries(entries)
}

function DetailPanel({ selectedTxid, collapsed = false, onGraphRefresh, onDeselect }: DetailPanelProps) {
  const auditMode = useSyncExternalStore(
    subscribeGraphControls,
    getAuditModeSnapshot,
    getAuditModeSnapshot,
  )
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

  const classificationId = useId()
  const taxRelevantId = useId()
  const counterpartyId = useId()
  const invoiceId = useId()
  const glCategoryId = useId()
  const notesId = useId()

  const [classificationCategory, setClassificationCategory] = useState('')
  const [classificationTaxRelevant, setClassificationTaxRelevant] = useState(false)
  const [counterparty, setCounterparty] = useState('')
  const [invoiceReferenceId, setInvoiceReferenceId] = useState('')
  const [glCategory, setGlCategory] = useState('')
  const [notes, setNotes] = useState('')
  const [outputDrafts, setOutputDrafts] = useState<Record<number, OutputDraft>>({})
  const [accountingMetadataExpanded, setAccountingMetadataExpanded] = useState(false)
  const [outputsExpanded, setOutputsExpanded] = useState(false)

  const [isSaving, setIsSaving] = useState(false)
  const [isClearing, setIsClearing] = useState(false)
  const [isSyncingPrimaryClassification, setIsSyncingPrimaryClassification] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [classificationMissing, setClassificationMissing] = useState(false)
  const [toast, setToast] = useState<InlineToast | null>(null)

  const activeTxidRef = useRef(activeTxid)
  const formRef = useRef<HTMLDivElement | null>(null)
  const primaryClassificationSyncRequestRef = useRef(0)

  useEffect(() => {
    activeTxidRef.current = activeTxid
  }, [activeTxid])

  useEffect(() => {
    if (!loadedDetail) {
      setClassificationCategory('')
      setClassificationTaxRelevant(false)
      setCounterparty('')
      setInvoiceReferenceId('')
      setGlCategory('')
      setNotes('')
      setOutputDrafts({})
      setAccountingMetadataExpanded(false)
      setOutputsExpanded(false)
      setFormError(null)
      setClassificationMissing(false)
      setToast(null)
      return
    }

    const metadata = asMetadataRecord(loadedDetail.classification?.metadata)
    setClassificationCategory(loadedDetail.classification?.category ?? '')
    setClassificationTaxRelevant(loadedDetail.classification?.tax_relevant ?? false)
    setCounterparty(readMetadataString(metadata, 'counterparty'))
    setInvoiceReferenceId(
      readMetadataString(metadata, 'invoice_id') ||
        readMetadataString(metadata, 'external_ref') ||
        readMetadataString(metadata, 'invoice_reference_id'),
    )
    setGlCategory(readMetadataString(metadata, 'gl_category'))
    setNotes(readMetadataString(metadata, 'notes') || loadedDetail.classification?.context || '')
    setOutputDrafts(createOutputDraftMap(loadedDetail))
    setAccountingMetadataExpanded(false)
    setFormError(null)
    setClassificationMissing(false)
    setToast(null)
  }, [loadedDetail])

  useEffect(() => {
    if (!toast) return
    const timeoutId = window.setTimeout(() => setToast(null), INLINE_TOAST_TIMEOUT_MS)
    return () => window.clearTimeout(timeoutId)
  }, [toast])

  const hasTxClassification = loadedDetail?.classification != null
  const hasTxLabel = (loadedDetail?.label ?? '').trim().length > 0
  const hasOutputClassification =
    loadedDetail?.outputs.some((output) => output.classification != null) ?? false
  const hasOutputLabel =
    loadedDetail?.outputs.some((output) => (output.label ?? '').trim().length > 0) ?? false
  const hasClearableData =
    hasTxClassification || hasTxLabel || hasOutputClassification || hasOutputLabel
  const hasDraftTxMetadata =
    classificationCategory.trim().length > 0 ||
    classificationTaxRelevant ||
    counterparty.trim().length > 0 ||
    invoiceReferenceId.trim().length > 0 ||
    glCategory.trim().length > 0 ||
    notes.trim().length > 0
  const hasDraftOutputMetadata =
    loadedDetail?.outputs.some((output) => {
      const draft = outputDrafts[output.vout] ?? initialOutputDraft(output)
      return (
        draft.classification.trim().length > 0 ||
        draft.internalChange ||
        draft.notes.trim().length > 0
      )
    }) ?? false
  const canClearClassification = hasClearableData || hasDraftTxMetadata || hasDraftOutputMetadata

  const displayTxid = toDisplayTxid(loadedDetail?.txid ?? activeTxid)
  const hasCopyableTxid = displayTxid !== UNKNOWN_VALUE

  const txClassificationOptions = useMemo(() => {
    if (
      classificationCategory.trim().length > 0 &&
      !CLASSIFICATION_OPTIONS.some((option) => option.value === classificationCategory.trim())
    ) {
      return [
        ...CLASSIFICATION_OPTIONS,
        {
          value: classificationCategory.trim(),
          label: classificationCategory.trim(),
        },
      ]
    }
    return CLASSIFICATION_OPTIONS
  }, [classificationCategory])

  const auditMetadata = asMetadataRecord(loadedDetail?.classification?.metadata)
  const auditCreated = formatAuditDate(auditMetadata.created_at)
  const auditUpdated = formatAuditDate(auditMetadata.updated_at)
  const auditSource = readMetadataString(auditMetadata, 'source') || 'Manual'
  const auditCreatedBy = readMetadataString(auditMetadata, 'created_by')

  const updateOutputDraft = useCallback((vout: number, patch: Partial<OutputDraft>) => {
    setOutputDrafts((current) => {
      const previous = current[vout] ?? {
        classification: '',
        internalChange: false,
        notes: '',
      }
      return {
        ...current,
        [vout]: {
          ...previous,
          ...patch,
        },
      }
    })
  }, [])

  const refreshAfterMutation = useCallback(async () => {
    await reload({ txid: activeTxidRef.current, throwOnError: true })
    if (onGraphRefresh) {
      await onGraphRefresh()
    }
  }, [onGraphRefresh, reload])

  const syncPrimaryClassificationBadge = useCallback(
    async (nextCategory: string) => {
      if (!loadedDetail) return
      const normalizedCategory = nextCategory.trim()
      if (!normalizedCategory) return

      const existingCategory = loadedDetail.classification?.category?.trim() ?? ''
      if (normalizedCategory === existingCategory) return

      const requestId = primaryClassificationSyncRequestRef.current + 1
      primaryClassificationSyncRequestRef.current = requestId
      setIsSyncingPrimaryClassification(true)

      const txMetadata: Record<string, unknown> = {}
      if (counterparty.trim()) txMetadata.counterparty = counterparty.trim()
      if (invoiceReferenceId.trim()) txMetadata.invoice_id = invoiceReferenceId.trim()
      if (glCategory.trim()) txMetadata.gl_category = glCategory.trim()
      if (notes.trim()) txMetadata.notes = notes.trim()

      const payload: Classification = {
        category: normalizedCategory,
        context: '',
        metadata: txMetadata,
        tax_relevant: classificationTaxRelevant,
      }

      try {
        await invoke('cmd_set_classification', {
          refType: 'tx' as RefType,
          refId: loadedDetail.txid,
          classification: payload,
        })

        if (requestId !== primaryClassificationSyncRequestRef.current) return
        if (onGraphRefresh) {
          await onGraphRefresh()
        }
      } catch (syncError) {
        if (requestId !== primaryClassificationSyncRequestRef.current) return
        setFormError(`Failed to update node badge: ${toErrorMessage(syncError)}`)
      } finally {
        if (requestId === primaryClassificationSyncRequestRef.current) {
          setIsSyncingPrimaryClassification(false)
        }
      }
    },
    [
      classificationTaxRelevant,
      counterparty,
      glCategory,
      invoiceReferenceId,
      loadedDetail,
      notes,
      onGraphRefresh,
    ],
  )

  const handleSaveClassification = useCallback(async () => {
    if (!loadedDetail) return
    if (isSaving || isClearing || isSyncingPrimaryClassification) return

    const category = classificationCategory.trim()
    if (!category) {
      setClassificationMissing(true)
      setFormError('Please select a classification')
      setToast({
        tone: 'error',
        title: 'Please select a classification',
      })
      return
    }

    setClassificationMissing(false)
    setFormError(null)
    setToast(null)
    setIsSaving(true)

    try {
      const txMetadata: Record<string, unknown> = {}
      if (counterparty.trim()) txMetadata.counterparty = counterparty.trim()
      if (invoiceReferenceId.trim()) txMetadata.invoice_id = invoiceReferenceId.trim()
      if (glCategory.trim()) txMetadata.gl_category = glCategory.trim()
      if (notes.trim()) txMetadata.notes = notes.trim()

      const txPayload: Classification = {
        category,
        context: '',
        metadata: txMetadata,
        tax_relevant: classificationTaxRelevant,
      }

      await invoke('cmd_set_classification', {
        refType: 'tx' as RefType,
        refId: loadedDetail.txid,
        classification: txPayload,
      })

      const outputMutations: Promise<unknown>[] = []
      for (const output of loadedDetail.outputs) {
        const refId = `${loadedDetail.txid}:${output.vout}`
        const existingCategory = output.classification?.category?.trim() ?? ''
        const existingMetadata = asMetadataRecord(output.classification?.metadata)
        const existingInternalChange = readMetadataBoolean(existingMetadata, 'internal_change')
        const existingNotes = output.label?.trim() ?? ''

        const draft = outputDrafts[output.vout] ?? initialOutputDraft(output)
        const nextCategory = draft.classification.trim()
        const nextInternalChange = draft.internalChange
        const nextNotes = draft.notes.trim()

        if (nextCategory.length === 0) {
          if (existingCategory.length > 0) {
            outputMutations.push(
              invoke('cmd_delete_classification', {
                refType: 'output' as RefType,
                refId,
              }),
            )
          }
        } else if (
          nextCategory !== existingCategory ||
          nextInternalChange !== existingInternalChange
        ) {
          const outputPayload: Classification = {
            category: nextCategory,
            context: '',
            metadata: {
              internal_change: nextInternalChange,
            },
            tax_relevant: false,
          }

          outputMutations.push(
            invoke('cmd_set_classification', {
              refType: 'output' as RefType,
              refId,
              classification: outputPayload,
            }),
          )
        }

        if (nextNotes.length === 0) {
          if (existingNotes.length > 0) {
            outputMutations.push(
              invoke('cmd_delete_label', {
                refType: 'output' as RefType,
                refId,
              }),
            )
          }
        } else if (nextNotes !== existingNotes) {
          outputMutations.push(
            invoke('cmd_set_label', {
              refType: 'output' as RefType,
              refId,
              label: nextNotes,
            }),
          )
        }
      }

      await Promise.all(outputMutations)
      await refreshAfterMutation()
      setToast({
        tone: 'success',
        title: 'Classification saved',
        description: 'Transaction label has been updated',
      })
    } catch (mutationError) {
      const message = `Failed to save classification: ${toErrorMessage(mutationError)}`
      setFormError(message)
      setToast({
        tone: 'error',
        title: 'Failed to save classification',
      })
    } finally {
      setIsSaving(false)
    }
  }, [
    classificationCategory,
    classificationTaxRelevant,
    counterparty,
    glCategory,
    invoiceReferenceId,
    isClearing,
    isSaving,
    isSyncingPrimaryClassification,
    loadedDetail,
    notes,
    outputDrafts,
    refreshAfterMutation,
  ])

  const handleClearClassification = useCallback(async () => {
    if (
      !loadedDetail ||
      !canClearClassification ||
      isSaving ||
      isClearing ||
      isSyncingPrimaryClassification
    ) {
      return
    }

    setFormError(null)
    setToast(null)
    setIsClearing(true)

    try {
      const mutations: Promise<unknown>[] = []
      if (loadedDetail.classification) {
        mutations.push(
          invoke('cmd_delete_classification', {
            refType: 'tx' as RefType,
            refId: loadedDetail.txid,
          }),
        )
      }

      if ((loadedDetail.label ?? '').trim().length > 0) {
        mutations.push(
          invoke('cmd_delete_label', {
            refType: 'tx' as RefType,
            refId: loadedDetail.txid,
          }),
        )
      }

      for (const output of loadedDetail.outputs) {
        const refId = `${loadedDetail.txid}:${output.vout}`

        if (output.classification) {
          mutations.push(
            invoke('cmd_delete_classification', {
              refType: 'output' as RefType,
              refId,
            }),
          )
        }

        if ((output.label ?? '').trim().length > 0) {
          mutations.push(
            invoke('cmd_delete_label', {
              refType: 'output' as RefType,
              refId,
            }),
          )
        }
      }

      if (mutations.length > 0) {
        await Promise.all(mutations)
      }

      setClassificationCategory('')
      setClassificationTaxRelevant(false)
      setCounterparty('')
      setInvoiceReferenceId('')
      setGlCategory('')
      setNotes('')
      setOutputDrafts(
        Object.fromEntries(
          loadedDetail.outputs.map((output) => [
            output.vout,
            {
              classification: '',
              internalChange: false,
              notes: '',
            },
          ]),
        ),
      )
      setClassificationMissing(false)
      await refreshAfterMutation()
      setToast({
        tone: 'success',
        title: 'Classification cleared',
      })
    } catch (mutationError) {
      setFormError(`Failed to clear classification: ${toErrorMessage(mutationError)}`)
      setToast({
        tone: 'error',
        title: 'Failed to clear classification',
      })
    } finally {
      setIsClearing(false)
    }
  }, [
    canClearClassification,
    isClearing,
    isSaving,
    isSyncingPrimaryClassification,
    loadedDetail,
    refreshAfterMutation,
  ])

  useEffect(() => {
    if (!hasSelection || collapsed) return

    function handleWindowKeydown(event: KeyboardEvent) {
      const key = event.key.toLowerCase()
      if ((event.metaKey || event.ctrlKey) && key === 's') {
        event.preventDefault()
        void handleSaveClassification()
        return
      }

      if (event.key === 'Escape') {
        event.preventDefault()
        onDeselect?.()
      }
    }

    window.addEventListener('keydown', handleWindowKeydown)
    return () => window.removeEventListener('keydown', handleWindowKeydown)
  }, [collapsed, handleSaveClassification, hasSelection, onDeselect])

  const handleFormKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) return

    const target = event.target
    if (
      !(target instanceof HTMLInputElement) &&
      !(target instanceof HTMLSelectElement)
    ) {
      return
    }

    if (target instanceof HTMLInputElement && target.type === 'checkbox') return
    event.preventDefault()

    const formElement = formRef.current
    if (!formElement) return

    const focusableElements = Array.from(
      formElement.querySelectorAll<HTMLElement>(
        'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])',
      ),
    ).filter((element) => element.tabIndex !== -1)

    const currentIndex = focusableElements.indexOf(target)
    if (currentIndex < 0) return
    const next = focusableElements[currentIndex + 1]
    next?.focus()
  }, [])

  const statusBadgeClass = `detail-panel__status-badge detail-panel__status-badge--${detailStatus}`
  const toastClass = toast ? `detail-panel__toast detail-panel__toast--${toast.tone}` : 'detail-panel__toast'

  if (!hasSelection) {
    return null
  }

  if (collapsed) {
    return (
      <aside className="detail-panel detail-panel--collapsed surface-panel" aria-label="Transaction details">
        <div className="detail-panel__collapsed-label">Details</div>
      </aside>
    )
  }

  return (
    <aside className="detail-panel detail-panel--drawer" aria-label="Transaction details">
      <div
        className="detail-panel__scroll-area"
        role="form"
        aria-labelledby="detail-panel-title"
        onKeyDown={handleFormKeyDown}
        ref={formRef}
      >
        <header className="detail-panel__header">
          <div className="detail-panel__header-row">
            <div className="detail-panel__title-icon-wrap">
              <TagIcon />
            </div>
            <div className="detail-panel__title-wrap">
              <h2 id="detail-panel-title" className="detail-panel__title">
                Transaction Details
              </h2>
              <p className="detail-panel__subtitle">Classify and add accounting metadata</p>
            </div>
          </div>

          <div className="detail-panel__txid-box">
            <code className="detail-panel__txid-text" title={displayTxid}>
              {displayTxid}
            </code>
            <button
              type="button"
              className="detail-panel__txid-copy"
              disabled={!hasCopyableTxid}
              aria-label="Copy transaction ID"
              onClick={() => {
                if (!hasCopyableTxid) return
                void copyTextToClipboard(displayTxid).then(() =>
                  setToast({ tone: 'info', title: 'Transaction ID copied' }),
                )
              }}
            >
              <CopyIcon />
            </button>
          </div>

          <div className="detail-panel__status-row">
            <span className={statusBadgeClass}>
              {detailStatus === 'unknown' ? <AlertCircleIcon /> : <CircleStatusIcon />}
              {statusBadgeLabel(detailStatus, loadedDetail?.confirmations)}
            </span>
          </div>
        </header>


        {state === 'loading' && (
          <section className="detail-panel__section">
            <p className="detail-panel__loading">Loading transaction details…</p>
          </section>
        )}

        {state === 'load-error' && (
          <section className="detail-panel__section">
            <div className="detail-panel__error">{loadError ?? 'Unknown error'}</div>
          </section>
        )}

        {state === 'loaded' && loadedDetail && (
          <>
            <section className="detail-panel__section detail-panel__section--transaction-info">
              <h3 className="detail-panel__section-title">Transaction Info</h3>
              <div className="detail-panel__audit-card">
                <div className="detail-panel__audit-row">
                  <span>Block Height:</span>
                  <span className="detail-panel__audit-value">
                    {loadedDetail.block_height ?? INFO_PLACEHOLDER}
                  </span>
                </div>
                <div className="detail-panel__audit-row">
                  <span>Time:</span>
                  <span>{formatBlockTime(loadedDetail.block_time)}</span>
                </div>
                <div className="detail-panel__audit-row">
                  <span>vsize:</span>
                  <span className="detail-panel__audit-value">{loadedDetail.vsize} vB</span>
                </div>
                <div className="detail-panel__audit-row">
                  <span>Weight:</span>
                  <span className="detail-panel__audit-value">{loadedDetail.weight} WU</span>
                </div>
                <div className="detail-panel__audit-row">
                  <span>Version:</span>
                  <span className="detail-panel__audit-value">{loadedDetail.version}</span>
                </div>
              </div>
            </section>

            <div className="detail-panel__separator" />
            <section className="detail-panel__section">
              <label className="detail-panel__field" htmlFor={classificationId}>
                <span className="detail-panel__field-label">
                  Classification <span className="detail-panel__required-star"> *</span>
                </span>
                <select
                  id={classificationId}
                  className={`detail-panel__select${classificationMissing ? ' detail-panel__select--error' : ''}`}
                  value={classificationCategory}
                  aria-invalid={classificationMissing}
                  onChange={(event) => {
                    const nextValue = event.target.value
                    setClassificationCategory(nextValue)
                    if (classificationMissing) setClassificationMissing(false)
                    if (formError) setFormError(null)
                    void syncPrimaryClassificationBadge(nextValue)
                  }}
                >
                  <option value="">Select classification...</option>
                  {txClassificationOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <button
                type="button"
                className="detail-panel__expand-button"
                aria-expanded={accountingMetadataExpanded}
                onClick={() => setAccountingMetadataExpanded((current) => !current)}
              >
                {accountingMetadataExpanded ? <ChevronUpIcon /> : <ChevronDownIcon />}
                <span>Accounting Metadata</span>
              </button>

              {accountingMetadataExpanded && (
                <div className="detail-panel__metadata-fields">
                  <div className="detail-panel__tax-card">
                    <label className="detail-panel__tax-label" htmlFor={taxRelevantId}>
                      <AlertCircleIcon />
                      <span>Tax relevant information</span>
                    </label>
                    <button
                      id={taxRelevantId}
                      type="button"
                      role="switch"
                      aria-checked={classificationTaxRelevant}
                      className={`detail-panel__switch${classificationTaxRelevant ? ' detail-panel__switch--on detail-panel__switch--tax' : ''}`}
                      onClick={() => {
                        setClassificationTaxRelevant((current) => !current)
                        if (formError) setFormError(null)
                      }}
                    >
                      <span className="detail-panel__switch-thumb" />
                    </button>
                  </div>

                  <label className="detail-panel__field" htmlFor={counterpartyId}>
                    <span className="detail-panel__field-label">Counterparty</span>
                    <input
                      id={counterpartyId}
                      className="detail-panel__input"
                      value={counterparty}
                      placeholder="e.g., Acme Corp, Client Name"
                      onChange={(event) => {
                        setCounterparty(event.target.value)
                        if (formError) setFormError(null)
                      }}
                    />
                    <span className="detail-panel__helper">
                      Entity or person involved in this transaction
                    </span>
                  </label>

                  <label className="detail-panel__field" htmlFor={invoiceId}>
                    <span className="detail-panel__field-label">Ref ID</span>
                    <input
                      id={invoiceId}
                      className="detail-panel__input"
                      value={invoiceReferenceId}
                      placeholder="INV-2024-001"
                      onChange={(event) => {
                        setInvoiceReferenceId(event.target.value)
                        if (formError) setFormError(null)
                      }}
                    />
                    <span className="detail-panel__helper">
                      Optional reference for your accounting system
                    </span>
                  </label>

                  <label className="detail-panel__field" htmlFor={glCategoryId}>
                    <span className="detail-panel__field-label">GL Category</span>
                    <input
                      id={glCategoryId}
                      className="detail-panel__input"
                      value={glCategory}
                      placeholder="e.g., 4000, Sales:Product, COGS"
                      onChange={(event) => {
                        setGlCategory(event.target.value)
                        if (formError) setFormError(null)
                      }}
                    />
                    <span className="detail-panel__helper">General ledger account code or category</span>
                  </label>

                  <label className="detail-panel__field" htmlFor={notesId}>
                    <span className="detail-panel__field-label">Notes</span>
                    <textarea
                      id={notesId}
                      className="detail-panel__textarea"
                      rows={3}
                      value={notes}
                      placeholder="Add internal notes or context..."
                      onChange={(event) => {
                        setNotes(event.target.value)
                        if (formError) setFormError(null)
                      }}
                    />
                    <span className="detail-panel__helper">Internal notes for your records (not exported)</span>
                  </label>
                </div>
              )}
            </section>

            <div className="detail-panel__separator" />

            <section className="detail-panel__section detail-panel__section--outputs">
              <div className="detail-panel__section-head">
                <h3 className="detail-panel__section-title">Output Classification</h3>
                <span className="detail-panel__count-badge">
                  {loadedDetail.outputs.length} outputs
                </span>
              </div>
              <p className="detail-panel__description">
                Classify individual outputs for detailed UTXO tracking.
              </p>
              <button
                type="button"
                className="detail-panel__expand-button"
                aria-expanded={outputsExpanded}
                onClick={() => setOutputsExpanded((current) => !current)}
              >
                {outputsExpanded ? <ChevronUpIcon /> : <ChevronDownIcon />}
                <span>{outputsExpanded ? 'Hide Outputs' : 'Show Outputs'}</span>
              </button>

              <div className={`detail-panel__outputs-wrap${outputsExpanded ? ' detail-panel__outputs-wrap--expanded' : ''}`}>
                <div className="detail-panel__outputs-list">
                  {loadedDetail.outputs.length === 0 && (
                    <p className="detail-panel__empty-state">No outputs available.</p>
                  )}

                  {loadedDetail.outputs.map((output) => {
                    const draft = outputDrafts[output.vout] ?? initialOutputDraft(output)
                    const selectId = `output-classification-${output.vout}`
                    const switchId = `output-change-${output.vout}`
                    const notesInputId = `output-notes-${output.vout}`

                    const outputOptions = [
                      { value: '', label: 'Same as Transaction' },
                      ...CLASSIFICATION_OPTIONS,
                    ]

                    return (
                      <article key={output.vout} className="detail-panel__output-card">
                        <div className="detail-panel__output-header">
                          <div className="detail-panel__output-heading">
                            <span className="detail-panel__output-title">Output {output.vout}</span>
                            {output.script_type && (
                              <span className="detail-panel__output-class-badge">
                                {output.script_type.toUpperCase()}
                              </span>
                            )}
                          </div>
                          <span className="detail-panel__output-value">{formatBtc(output.value_sat)}</span>
                        </div>

                        <label htmlFor={selectId} className="detail-panel__output-field">
                          <span className="detail-panel__output-field-label">Classification</span>
                          <select
                            id={selectId}
                            className="detail-panel__output-select"
                            value={draft.classification}
                            onChange={(event) =>
                              updateOutputDraft(output.vout, { classification: event.target.value })
                            }
                          >
                            {outputOptions.map((option) => (
                              <option key={`${output.vout}-${option.value || 'inherit'}`} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </label>

                        <div className="detail-panel__output-switch-row">
                          <label htmlFor={switchId} className="detail-panel__output-switch-label">
                            Internal change output
                          </label>
                          <button
                            id={switchId}
                            type="button"
                            role="switch"
                            aria-checked={draft.internalChange}
                            className={`detail-panel__switch detail-panel__switch--compact${draft.internalChange ? ' detail-panel__switch--on' : ''}`}
                            onClick={() =>
                              updateOutputDraft(output.vout, { internalChange: !draft.internalChange })
                            }
                          >
                            <span className="detail-panel__switch-thumb" />
                          </button>
                        </div>

                        <label htmlFor={notesInputId} className="detail-panel__output-field">
                          <input
                            id={notesInputId}
                            className="detail-panel__output-notes"
                            value={draft.notes}
                            placeholder="Output-specific notes..."
                            onChange={(event) =>
                              updateOutputDraft(output.vout, { notes: event.target.value })
                            }
                          />
                        </label>
                      </article>
                    )
                  })}
                </div>
              </div>
            </section>

            {auditMode && (
              <>
                <div className="detail-panel__separator" />
                <section className="detail-panel__section detail-panel__section--audit">
                  <div className="detail-panel__audit-title">
                    <ShieldIcon />
                    <h3 className="detail-panel__section-title">Audit Trail</h3>
                  </div>
                  <div className="detail-panel__audit-card">
                    <div className="detail-panel__audit-row">
                      <span>Created:</span>
                      <span className="detail-panel__audit-value">{auditCreated}</span>
                    </div>
                    <div className="detail-panel__audit-row">
                      <span>Last modified:</span>
                      <span className="detail-panel__audit-value">{auditUpdated}</span>
                    </div>
                    <div className="detail-panel__audit-row">
                      <span>Source:</span>
                      <span>{auditSource}</span>
                    </div>
                    {auditCreatedBy && (
                      <div className="detail-panel__audit-row">
                        <span>Created by:</span>
                        <span>{auditCreatedBy}</span>
                      </div>
                    )}
                  </div>
                </section>
              </>
            )}
          </>
        )}

      </div>

      <footer className="detail-panel__footer">
        {formError && <p className="detail-panel__error-text">{formError}</p>}

        {toast && (
          <div className={toastClass} role="status" aria-live="polite">
            <span>{toast.title}</span>
            {toast.description && <small>{toast.description}</small>}
          </div>
        )}

        <div className="detail-panel__footer-actions">
          <button
            type="button"
            className="detail-panel__save-button"
            disabled={isSaving || isClearing || isSyncingPrimaryClassification}
            onClick={() => void handleSaveClassification()}
          >
            {isSaving || isSyncingPrimaryClassification ? (
              <>
                <span className="spinner spinner--sm" aria-hidden="true" />
                <span>{isSaving ? 'Saving…' : 'Updating…'}</span>
              </>
            ) : (
              <>
                <SaveIcon />
                <span>Save Classification</span>
              </>
            )}
          </button>

          {canClearClassification && (
            <button
              type="button"
              className="detail-panel__clear-button"
              disabled={isSaving || isClearing || isSyncingPrimaryClassification}
              onClick={() => void handleClearClassification()}
            >
              {isClearing ? (
                <>
                  <span className="spinner spinner--sm" aria-hidden="true" />
                  <span>Clearing…</span>
                </>
              ) : (
                <>
                  <XIcon />
                  <span>Clear Classification</span>
                </>
              )}
            </button>
          )}
        </div>
      </footer>
    </aside>
  )
}

export default DetailPanel
