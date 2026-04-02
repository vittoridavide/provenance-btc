import { useCallback, useState, useSyncExternalStore } from 'react'
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog'
import {
  Database,
  Download,
  FileSpreadsheet,
  Info,
  Tag,
  Upload,
} from 'lucide-react'
import { getGraphControlsSnapshot, subscribeGraphControls } from '../state/graphControls'
import type {
  Bip329ImportApplyResult,
  Bip329ImportConflictPolicy,
  GraphSummary,
  ReportExportRequest,
  ReportFileExportResult,
  ReportKind,
} from '../types/api'
import './DataManagementSidebar.css'

type DataManagementSidebarProps = {
  rootTxid: string
  graphSummary: GraphSummary | null
  graphEdgeCount: number
  collapsed?: boolean
  onToggle?: () => void
  onExportReport: (
    request: ReportExportRequest,
    outputPath: string,
  ) => Promise<ReportFileExportResult>
  onApplyLabelImport: (
    inputPath: string,
    policy: Bip329ImportConflictPolicy,
  ) => Promise<Bip329ImportApplyResult>
  onExportLabels: (outputPath: string) => Promise<string | void>
}

function CollapseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path
        d="M5 3l4 4-4 4"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

const TXID_PATTERN = /^[0-9a-f]{64}$/

function isValidTxid(value: string): boolean {
  return TXID_PATTERN.test(value)
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

function coercePath(value: string | string[] | null): string | null {
  if (typeof value === 'string') return value
  return null
}

function formatFileTimestamp(date = new Date()): string {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  const hours = `${date.getHours()}`.padStart(2, '0')
  const minutes = `${date.getMinutes()}`.padStart(2, '0')
  const seconds = `${date.getSeconds()}`.padStart(2, '0')
  return `${year}${month}${day}-${hours}${minutes}${seconds}`
}

function reportKindLabel(kind: ReportKind): string {
  switch (kind) {
    case 'transactions':
      return 'Transactions'
    case 'outputs':
      return 'Outputs'
    case 'exceptions':
      return 'Exceptions'
    default: {
      const unreachable: never = kind
      throw new Error(`Unhandled report kind: ${unreachable}`)
    }
  }
}

function DataManagementSidebar({
  rootTxid,
  graphSummary,
  graphEdgeCount,
  collapsed = false,
  onToggle,
  onExportReport,
  onApplyLabelImport,
  onExportLabels,
}: DataManagementSidebarProps) {
  const { depth, canControl, isGraphLoading } = useSyncExternalStore(
    subscribeGraphControls,
    getGraphControlsSnapshot,
    getGraphControlsSnapshot,
  )

  const [isImporting, setIsImporting] = useState(false)
  const [isExportingLabels, setIsExportingLabels] = useState(false)
  const [isExportingCsv, setIsExportingCsv] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)

  const normalizedRootTxid = rootTxid.trim().toLowerCase()
  const hasValidRootTxid = isValidTxid(normalizedRootTxid)
  const isBusy = isImporting || isExportingLabels || isExportingCsv
  const graphActionDisabled = isGraphLoading || !canControl || isBusy
  const canExportCsv = hasValidRootTxid && !graphActionDisabled
  const labelCount = graphSummary?.labeled_transactions ?? 0
  const outputLabelCount = graphSummary?.labeled_outputs ?? 0
  const classifiedCount = graphSummary
    ? graphSummary.total_nodes - graphSummary.unclassified_nodes
    : 0
  const hasAnyLabels = (labelCount + outputLabelCount) > 0

  const handleImportLabels = useCallback(async () => {
    setImportError(null)

    const selectedPath = coercePath(
      await openDialog({
        title: 'Choose BIP-329 JSONL labels file',
        multiple: false,
        directory: false,
        filters: [{ name: 'JSON Lines', extensions: ['jsonl', 'ndjson'] }],
      }),
    )

    if (!selectedPath) return

    setIsImporting(true)
    try {
      await onApplyLabelImport(selectedPath, 'prefer_import')
    } catch (error) {
      setImportError(toErrorMessage(error))
    } finally {
      setIsImporting(false)
    }
  }, [onApplyLabelImport])

  const handleExportLabels = useCallback(async () => {
    const defaultName = `provenance-bip329-labels-${formatFileTimestamp()}.jsonl`
    const selectedPath = await saveDialog({
      title: 'Export BIP-329 labels',
      defaultPath: defaultName,
      filters: [{ name: 'JSON Lines', extensions: ['jsonl', 'ndjson'] }],
    })

    if (!selectedPath) return

    setIsExportingLabels(true)
    try {
      await onExportLabels(selectedPath)
    } catch {
      // native save dialog already provides path context to the user
    } finally {
      setIsExportingLabels(false)
    }
  }, [onExportLabels])

  const handleExportCsv = useCallback(
    async (kind: 'transactions' | 'outputs') => {
      if (!hasValidRootTxid) return

      const txidShort = normalizedRootTxid.slice(0, 8)
      const defaultName = `provenance-${kind}-${txidShort}-${formatFileTimestamp()}.csv`
      const selectedPath = await saveDialog({
        title: `Save ${reportKindLabel(kind)} report`,
        defaultPath: defaultName,
        filters: [{ name: 'CSV', extensions: ['csv'] }],
      })

      if (!selectedPath) return

      setIsExportingCsv(true)
      try {
        const request: ReportExportRequest = {
          graph: { root_txid: normalizedRootTxid, traversal_depth: depth },
          report: { kind, scope: 'current_graph' },
        }
        await onExportReport(request, selectedPath)
      } catch {
        // native save dialog already provides path context to the user
      } finally {
        setIsExportingCsv(false)
      }
    },
    [depth, hasValidRootTxid, normalizedRootTxid, onExportReport],
  )

  if (collapsed) {
    return (
      <aside
        className="data-management-panel data-management-panel--collapsed"
        aria-label="Data management"
        onClick={onToggle}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') onToggle?.()
        }}
      >
        <div className="data-management-panel__collapsed-label">Data</div>
      </aside>
    )
  }

  return (
    <aside className="data-management-panel" aria-label="Data management">
      <div className="dm-sidebar__scroll">
        <div className="dm-sidebar__content">

          {/* ── Header ── */}
          <div className="dm-header">
            <div className="dm-header__icon-container">
              <Database size={24} aria-hidden="true" className="dm-header__icon" />
            </div>
            <div className="dm-header__text">
              <h2 className="dm-header__title">Data Management</h2>
              <p className="dm-header__subtitle">Import and export transaction labels and data</p>
            </div>
            {onToggle && (
              <button
                type="button"
                className="dm-collapse-button"
                onClick={onToggle}
                aria-label="Collapse data management"
              >
                <CollapseIcon />
              </button>
            )}
          </div>

          <hr className="dm-separator" />

          {/* ── Graph Summary ── */}
          {graphSummary ? (
            <div className="dm-summary-card">
              <div className="dm-summary-card__header">
                <Info size={16} aria-hidden="true" className="dm-summary-card__icon" />
                <span className="dm-summary-card__title">Graph Summary</span>
              </div>
                <div className="dm-summary-card__stats">
                  <div className="dm-summary-card__stat-row">
                    <span className="dm-summary-card__stat-label">Transactions:</span>
                    <span className="dm-summary-card__stat-value">{graphSummary.total_nodes}</span>
                  </div>
                  <div className="dm-summary-card__stat-row">
                    <span className="dm-summary-card__stat-label">Connections:</span>
                    <span className="dm-summary-card__stat-value">{graphEdgeCount}</span>
                  </div>
                  <div className="dm-summary-card__stat-row">
                    <span className="dm-summary-card__stat-label">Classified:</span>
                    <span className="dm-summary-card__stat-value">{classifiedCount} / {graphSummary.total_nodes}</span>
                  </div>
                  <div className="dm-summary-card__stat-row">
                    <span className="dm-summary-card__stat-label">Labeled transactions:</span>
                    <span className="dm-summary-card__stat-value">{graphSummary.labeled_transactions}</span>
                  </div>
                  <div className="dm-summary-card__stat-row">
                    <span className="dm-summary-card__stat-label">Labeled outputs:</span>
                    <span className="dm-summary-card__stat-value">{graphSummary.labeled_outputs}</span>
                  </div>
                </div>
            </div>
          ) : null}

          <hr className="dm-separator" />

          {/* ── Import Labels ── */}
          <section className="dm-section">
            <div className="dm-section__header">
              <Upload size={16} aria-hidden="true" className="dm-section__icon" />
              <h3 className="dm-section__title">Import Labels</h3>
            </div>
            <p className="dm-section__description">
              Import BIP-329 label files to annotate transactions and outputs.
            </p>
            {importError ? (
              <div className="dm-error-banner" role="alert" aria-live="polite">
                <p className="dm-error-banner__title">Import failed</p>
                <p className="dm-error-banner__message">{importError}</p>
              </div>
            ) : null}
            <button
              type="button"
              className="dm-button dm-button--full-width dm-button--centered"
              onClick={() => void handleImportLabels()}
              disabled={isBusy}
            >
              <Upload size={16} aria-hidden="true" />
              <span>{isImporting ? 'Importing…' : 'Choose file to import'}</span>
            </button>
            <div className="dm-info-banner">
              <p className="dm-info-banner__text">
                <strong>Supported:</strong> BIP-329 JSONL format (.jsonl, .ndjson)
              </p>
            </div>
          </section>

          <hr className="dm-separator" />

          {/* ── Export Labels ── */}
          <section className="dm-section">
            <div className="dm-section__header">
              <Tag size={16} aria-hidden="true" className="dm-section__icon" />
              <h3 className="dm-section__title">Export Labels</h3>
            </div>
            <p className="dm-section__description">
              {graphSummary
                ? `Export labels for the current graph (${graphSummary.total_nodes} transaction${graphSummary.total_nodes === 1 ? '' : 's'}) as BIP-329 JSONL.`
                : 'Export all transaction and output labels as BIP-329 JSONL.'}
            </p>
            <div className="dm-button-group">
              <button
                type="button"
                className="dm-button dm-button--full-width dm-button--left"
              onClick={() => void handleExportLabels()}
              disabled={!hasAnyLabels || isBusy}
              aria-label={
                !hasAnyLabels
                  ? 'Export labels (no labels to export)'
                  : isExportingLabels
                    ? 'Exporting labels'
                    : 'Export BIP-329 labels'
              }
              >
                <Tag size={16} aria-hidden="true" className="dm-icon--purple" />
                <div className="dm-button__text-container">
                  <span className="dm-button__primary-text">
                    {isExportingLabels ? 'Exporting…' : 'BIP-329 Format'}
                  </span>
                  <span className="dm-button__secondary-text">Standard Bitcoin wallet label format</span>
                </div>
              </button>
            </div>
          </section>

          <hr className="dm-separator" />

          {/* ── Export CSV ── */}
          <section className="dm-section">
            <div className="dm-section__header">
              <Download size={16} aria-hidden="true" className="dm-section__icon" />
              <h3 className="dm-section__title">Export CSV</h3>
            </div>
            <p className="dm-section__description">
              Export graph data as CSV files for the current graph context.
            </p>
            <div className="dm-button-group">
              <button
                type="button"
                className="dm-button dm-button--full-width dm-button--left"
                onClick={() => void handleExportCsv('transactions')}
                disabled={!canExportCsv}
              >
                <FileSpreadsheet size={16} aria-hidden="true" className="dm-icon--green" />
                <div className="dm-button__text-container">
                  <span className="dm-button__primary-text">Transactions CSV</span>
                  <span className="dm-button__secondary-text">Transaction-level data with classifications</span>
                </div>
              </button>
              <button
                type="button"
                className="dm-button dm-button--full-width dm-button--left"
              onClick={() => void handleExportCsv('outputs')}
                disabled={!canExportCsv}
                aria-label="Outputs CSV"
              >
                <FileSpreadsheet size={16} aria-hidden="true" className="dm-icon--green" />
                <div className="dm-button__text-container">
                  <span className="dm-button__primary-text">Outputs CSV</span>
                  <span className="dm-button__secondary-text">UTXO-level detail with output classifications</span>
                </div>
              </button>
            </div>
            {!hasValidRootTxid ? (
              <div className="dm-info-banner">
                <p className="dm-info-banner__text">
                  Resolve a root txid from your search input first.
                </p>
              </div>
            ) : null}
          </section>

        </div>
      </div>
    </aside>
  )
}

export default DataManagementSidebar
