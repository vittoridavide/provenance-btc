import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog'
import {
  ChevronDown,
  DownloadCloud,
  FileJson2,
  FileSpreadsheet,
  Info,
  UploadCloud,
  X,
} from 'lucide-react'
import { getGraphControlsSnapshot, subscribeGraphControls } from '../../state/graphControls'
import type {
  Bip329ExportResult,
  Bip329ImportApplyResult,
  Bip329ImportConflictPolicy,
  Bip329ImportPreviewLine,
  Bip329ImportPreviewResponse,
  ReportExportRequest,
  ReportFileExportResult,
  ReportKind,
  ReportPreviewRequest,
  ReportPreviewResponse,
  ReportWarning,
} from '../../types/api'
import './ImportExportCenter.css'

type ImportExportTab = 'reports' | 'bip329'

type StatusTone = 'success' | 'error'

type StatusState = {
  tone: StatusTone
  message: string
} | null

type ImportExportCenterProps = {
  isOpen: boolean
  onClose: () => void
  rootTxid: string
  onExportGraphJson: () => Promise<void> | void
  onPreviewReport: (request: ReportPreviewRequest) => Promise<ReportPreviewResponse>
  onExportReport: (request: ReportExportRequest, outputPath: string) => Promise<ReportFileExportResult>
  onPreviewLabelImport: (inputPath: string) => Promise<Bip329ImportPreviewResponse>
  onApplyLabelImport: (
    inputPath: string,
    policy: Bip329ImportConflictPolicy,
  ) => Promise<Bip329ImportApplyResult>
  onPreviewLabelExport: () => Promise<Bip329ExportResult>
  onExportLabels: (outputPath: string) => Promise<string | void>
}

type WarningSummaryItem = {
  key: 'missing_parent' | 'mempool_transaction' | 'unclassified_references' | 'missing_tax_metadata'
  label: string
  count: number
}

type DataPointProps = {
  label: string
  value: string | number
}

const TXID_PATTERN = /^[0-9a-f]{64}$/
const MAX_PREVIEW_SAMPLE_LINES = 5

function DataPoint({ label, value }: DataPointProps) {
  return (
    <div className="import-export-center__data-point">
      <span className="import-export-center__data-label">{label}</span>
      <strong className="import-export-center__data-value">{value}</strong>
    </div>
  )
}

function InfoFooter({ children }: { children: ReactNode }) {
  return (
    <div className="import-export-center__footer">
      <Info size={16} className="import-export-center__footer-icon" aria-hidden="true" />
      <p className="import-export-center__footer-copy">{children}</p>
    </div>
  )
}

function CodeTag({ children }: { children: ReactNode }) {
  return <span className="import-export-center__code-tag">{children}</span>
}

function isValidTxid(value: string): boolean {
  return TXID_PATTERN.test(value)
}

function buildReportRequest(rootTxid: string, traversalDepth: number, kind: ReportKind): ReportPreviewRequest {
  return {
    graph: {
      root_txid: rootTxid,
      traversal_depth: traversalDepth,
    },
    report: {
      kind,
      scope: 'current_graph',
    },
  }
}

function summarizeReportWarnings(warnings: ReportWarning[]): WarningSummaryItem[] {
  const counts: Record<WarningSummaryItem['key'], number> = {
    missing_parent: 0,
    mempool_transaction: 0,
    unclassified_references: 0,
    missing_tax_metadata: 0,
  }

  for (const warning of warnings) {
    switch (warning.issue_code) {
      case 'missing_parent':
        counts.missing_parent += 1
        break
      case 'mempool_transaction':
        counts.mempool_transaction += 1
        break
      case 'unclassified_transaction':
      case 'unclassified_output':
        counts.unclassified_references += 1
        break
      case 'missing_tax_metadata':
        counts.missing_tax_metadata += 1
        break
      default: {
        const unreachable: never = warning.issue_code
        throw new Error(`Unhandled issue code: ${unreachable}`)
      }
    }
  }

  const ordered: Array<{ key: WarningSummaryItem['key']; label: string }> = [
    { key: 'missing_parent', label: 'Missing parents' },
    { key: 'mempool_transaction', label: 'Mempool transactions' },
    { key: 'unclassified_references', label: 'Unclassified references' },
    { key: 'missing_tax_metadata', label: 'Missing tax metadata' },
  ]

  return ordered
    .map(({ key, label }) => ({ key, label, count: counts[key] }))
    .filter(({ count }) => count > 0)
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

function conflictPolicyDescription(policy: Bip329ImportConflictPolicy): string {
  switch (policy) {
    case 'prefer_import':
      return 'Unambiguous imported tx/output labels overwrite existing local labels.'
    case 'prefer_local':
      return 'Existing local tx/output labels win; imported origin and extra fields are preserved for round-trip export when possible.'
    case 'only_new':
      return 'Only refs without an existing local tx/output label are applied; conflicting imports are preserved without changing local state.'
    default: {
      const unreachable: never = policy
      throw new Error(`Unhandled conflict policy: ${unreachable}`)
    }
  }
}

function formatPreviewLineReference(line: Bip329ImportPreviewLine): string {
  const parts = [`Line ${line.line_number}`]

  if (line.record_type && line.record_ref) {
    parts.push(`${line.record_type} ${line.record_ref}`)
  } else if (line.record_type) {
    parts.push(line.record_type)
  }

  return parts.join(' · ')
}

function ImportExportCenter({
  isOpen,
  onClose,
  rootTxid,
  onExportGraphJson,
  onPreviewReport,
  onExportReport,
  onPreviewLabelImport,
  onApplyLabelImport,
  onPreviewLabelExport,
  onExportLabels,
}: ImportExportCenterProps) {
  const { depth, canControl, isGraphLoading } = useSyncExternalStore(
    subscribeGraphControls,
    getGraphControlsSnapshot,
    getGraphControlsSnapshot,
  )
  const [activeTab, setActiveTab] = useState<ImportExportTab>('reports')
  const [selectedReportKind, setSelectedReportKind] = useState<ReportKind>('transactions')
  const [reportPreview, setReportPreview] = useState<ReportPreviewResponse | null>(null)
  const [reportExportResult, setReportExportResult] = useState<ReportFileExportResult | null>(null)
  const [reportError, setReportError] = useState<string | null>(null)
  const [isPreviewingReport, setIsPreviewingReport] = useState(false)
  const [isExportingReport, setIsExportingReport] = useState(false)
  const [labelImportPath, setLabelImportPath] = useState<string | null>(null)
  const [labelImportPreview, setLabelImportPreview] = useState<Bip329ImportPreviewResponse | null>(null)
  const [labelImportResult, setLabelImportResult] = useState<Bip329ImportApplyResult | null>(null)
  const [labelExportPreview, setLabelExportPreview] = useState<Bip329ExportResult | null>(null)
  const [labelConflictPolicy, setLabelConflictPolicy] =
    useState<Bip329ImportConflictPolicy>('prefer_import')
  const [isPreviewingLabelImport, setIsPreviewingLabelImport] = useState(false)
  const [isApplyingLabelImport, setIsApplyingLabelImport] = useState(false)
  const [isPreviewingLabelExport, setIsPreviewingLabelExport] = useState(false)
  const [isExportingLabels, setIsExportingLabels] = useState(false)
  const [bipStatus, setBipStatus] = useState<StatusState>(null)
  const normalizedRootTxid = rootTxid.trim().toLowerCase()
  const hasValidRootTxid = isValidTxid(normalizedRootTxid)
  const isBusy =
    isPreviewingReport ||
    isExportingReport ||
    isPreviewingLabelImport ||
    isApplyingLabelImport ||
    isPreviewingLabelExport ||
    isExportingLabels
  const warningSummary = useMemo(
    () => summarizeReportWarnings(reportPreview?.warnings ?? []),
    [reportPreview],
  )
  const invalidPreviewLines = useMemo(
    () =>
      (labelImportPreview?.lines ?? [])
        .filter((line) => line.disposition === 'invalid')
        .slice(0, MAX_PREVIEW_SAMPLE_LINES),
    [labelImportPreview],
  )
  const ambiguousPreviewLines = useMemo(
    () =>
      (labelImportPreview?.lines ?? [])
        .filter((line) => line.disposition === 'ambiguous_supported')
        .slice(0, MAX_PREVIEW_SAMPLE_LINES),
    [labelImportPreview],
  )
  const graphActionDisabled = isGraphLoading || !canControl || isBusy
  const canPreviewReport = hasValidRootTxid && !isGraphLoading && !isBusy
  const canSaveReport = !!reportPreview && reportPreview.manifest.row_count > 0 && !isBusy
  const canApplyLabelImport = !!labelImportPath && !!labelImportPreview && !isBusy
  const canExportLabels = !!labelExportPreview && !isBusy

  useEffect(() => {
    if (!isOpen) return

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !isBusy) {
        onClose()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [isBusy, isOpen, onClose])

  useEffect(() => {
    if (!isOpen) {
      setActiveTab('reports')
      setSelectedReportKind('transactions')
      setReportPreview(null)
      setReportExportResult(null)
      setReportError(null)
      setLabelImportPath(null)
      setLabelImportPreview(null)
      setLabelImportResult(null)
      setLabelExportPreview(null)
      setLabelConflictPolicy('prefer_import')
      setBipStatus(null)
      setIsPreviewingReport(false)
      setIsExportingReport(false)
      setIsPreviewingLabelImport(false)
      setIsApplyingLabelImport(false)
      setIsPreviewingLabelExport(false)
      setIsExportingLabels(false)
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    setReportPreview(null)
    setReportExportResult(null)
    setReportError(null)
  }, [isOpen, selectedReportKind, normalizedRootTxid, depth])

  const refreshLabelExportPreview = useCallback(
    async (options?: { silentError?: boolean }) => {
      setIsPreviewingLabelExport(true)
      try {
        const preview = await onPreviewLabelExport()
        setLabelExportPreview(preview)
        return preview
      } catch (error) {
        setLabelExportPreview(null)
        if (!options?.silentError) {
          setBipStatus({
            tone: 'error',
            message: `Export preview failed: ${toErrorMessage(error)}`,
          })
        }
        return null
      } finally {
        setIsPreviewingLabelExport(false)
      }
    },
    [onPreviewLabelExport],
  )

  useEffect(() => {
    if (!isOpen || activeTab !== 'bip329' || labelExportPreview || isPreviewingLabelExport) return
    void refreshLabelExportPreview({ silentError: true })
  }, [activeTab, isOpen, labelExportPreview, isPreviewingLabelExport, refreshLabelExportPreview])

  async function handlePreviewReport() {
    setReportError(null)
    setReportExportResult(null)

    if (!hasValidRootTxid) {
      setReportPreview(null)
      setReportError('Load a graph by searching a valid root txid first.')
      return
    }

    if (isGraphLoading) {
      setReportPreview(null)
      setReportError('Wait for the graph to finish loading, then preview again.')
      return
    }

    setIsPreviewingReport(true)
    try {
      const request = buildReportRequest(normalizedRootTxid, depth, selectedReportKind)
      const preview = await onPreviewReport(request)
      setReportPreview(preview)
    } catch (error) {
      setReportPreview(null)
      setReportError(`Preview failed: ${toErrorMessage(error)}`)
    } finally {
      setIsPreviewingReport(false)
    }
  }

  async function handleSaveReport() {
    if (!reportPreview || reportPreview.manifest.row_count === 0) return
    setReportError(null)

    const selectedPath = await saveDialog({
      title: `Save ${reportKindLabel(selectedReportKind)} report`,
      defaultPath: reportPreview.manifest.suggested_filename,
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    })

    if (!selectedPath) return

    setIsExportingReport(true)
    try {
      const request = buildReportRequest(normalizedRootTxid, depth, selectedReportKind)
      const result = await onExportReport(request, selectedPath)
      setReportExportResult(result)
    } catch (error) {
      setReportError(`Export failed: ${toErrorMessage(error)}`)
    } finally {
      setIsExportingReport(false)
    }
  }

  async function handleChooseLabelImportFile() {
    setBipStatus(null)
    setLabelImportResult(null)

    const selectedPath = coercePath(
      await openDialog({
        title: 'Choose BIP-329 labels file',
        multiple: false,
        directory: false,
        filters: [
          { name: 'JSON Lines', extensions: ['jsonl', 'ndjson'] },
          { name: 'Text files', extensions: ['txt'] },
        ],
      }),
    )

    if (!selectedPath) return

    setLabelImportPath(selectedPath)
    setLabelImportPreview(null)
    setIsPreviewingLabelImport(true)
    try {
      const preview = await onPreviewLabelImport(selectedPath)
      setLabelImportPreview(preview)
    } catch (error) {
      setBipStatus({
        tone: 'error',
        message: `Import preview failed: ${toErrorMessage(error)}`,
      })
    } finally {
      setIsPreviewingLabelImport(false)
    }
  }

  async function handleApplyImport() {
    if (!labelImportPath || !labelImportPreview) return

    setBipStatus(null)
    setLabelImportResult(null)
    setIsApplyingLabelImport(true)
    try {
      const result = await onApplyLabelImport(labelImportPath, labelConflictPolicy)
      setLabelImportResult(result)
      const preservedCount =
        result.preserved_only + result.ambiguous_supported + result.skipped_unsupported_type
      const invalidSummary =
        result.skipped_invalid > 0 ? ` Skipped ${result.skipped_invalid} invalid lines.` : ''
      setBipStatus({
        tone: 'success',
        message: `Applied ${result.imported} supported labels and preserved ${preservedCount} records.${invalidSummary}`,
      })
      await refreshLabelExportPreview({ silentError: true })
    } catch (error) {
      setBipStatus({
        tone: 'error',
        message: `Import apply failed: ${toErrorMessage(error)}`,
      })
    } finally {
      setIsApplyingLabelImport(false)
    }
  }

  async function handleExportLabels() {
    setBipStatus(null)
    const preview = labelExportPreview ?? (await refreshLabelExportPreview())
    if (!preview) return

    const selectedPath = await saveDialog({
      title: 'Export BIP-329 labels',
      defaultPath: preview.suggested_filename,
      filters: [{ name: 'JSON Lines', extensions: ['jsonl', 'ndjson'] }],
    })

    if (!selectedPath) return

    setIsExportingLabels(true)
    try {
      const savedPath = (await onExportLabels(selectedPath)) ?? selectedPath
      setBipStatus({
        tone: 'success',
        message: `Exported ${preview.record_count} BIP-329 records to ${savedPath}.`,
      })
    } catch (error) {
      setBipStatus({
        tone: 'error',
        message: `Export failed: ${toErrorMessage(error)}`,
      })
    } finally {
      setIsExportingLabels(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="import-export-center" role="dialog" aria-modal="true" aria-labelledby="import-export-title">
      <div
        className="import-export-center__backdrop"
        onClick={() => {
          if (!isBusy) onClose()
        }}
      />
      <section className="import-export-center__sheet">
        <header className="import-export-center__header">
          <div className="import-export-center__header-copy">
            <h2 id="import-export-title" className="import-export-center__title">
              Import / Export
            </h2>
            <p className="import-export-center__subtitle">
              Native desktop workflows for graph reports and BIP-329 label portability.
            </p>
          </div>
          <button
            type="button"
            className="import-export-center__close"
            onClick={onClose}
            disabled={isBusy}
            aria-label="Close"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </header>

        <div className="import-export-center__body">
          <div className="import-export-center__tabs">
            <div className="import-export-center__tab-bar" role="tablist" aria-label="Import Export sections">
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'reports'}
                className={`import-export-center__tab${activeTab === 'reports' ? ' import-export-center__tab--active' : ''}`}
                onClick={() => setActiveTab('reports')}
              >
                <FileSpreadsheet size={16} aria-hidden="true" />
                <span>Reports</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'bip329'}
                className={`import-export-center__tab${activeTab === 'bip329' ? ' import-export-center__tab--active' : ''}`}
                onClick={() => setActiveTab('bip329')}
              >
                <DownloadCloud size={16} aria-hidden="true" />
                <span>BIP-329 Labels</span>
              </button>
            </div>
          </div>

          <div className="import-export-center__content">
            {activeTab === 'reports' ? (
              <section className="import-export-center__section">
                <div className="import-export-center__section-intro">
                  <h3 className="import-export-center__section-title">Reports</h3>
                  <p className="import-export-center__section-copy">
                    Export one CSV at a time from the current graph. Internal notes are not exported.
                  </p>
                </div>

                <div className="import-export-center__grid">
                  <article className="import-export-center__card">
                    <div className="import-export-center__card-header">
                      <div className="import-export-center__icon-box import-export-center__icon-box--reports">
                        <FileSpreadsheet size={20} aria-hidden="true" />
                      </div>
                      <div className="import-export-center__card-title-wrap">
                        <h4 className="import-export-center__card-title">Current graph report</h4>
                        <p className="import-export-center__card-description">Choose a report, preview it, then save it.</p>
                      </div>
                    </div>

                    <div className="import-export-center__field-group">
                      <label className="import-export-center__field">
                        <span className="import-export-center__field-label">Report type</span>
                        <div className="import-export-center__select-wrap">
                          <select
                            className="import-export-center__select"
                            value={selectedReportKind}
                            onChange={(event) => setSelectedReportKind(event.target.value as ReportKind)}
                            disabled={isBusy}
                          >
                            <option value="transactions">Transactions</option>
                            <option value="outputs">Outputs</option>
                            <option value="exceptions">Exceptions</option>
                          </select>
                          <ChevronDown size={16} className="import-export-center__select-icon" aria-hidden="true" />
                        </div>
                      </label>

                      <label className="import-export-center__field">
                        <span className="import-export-center__field-label">Scope</span>
                        <input className="import-export-center__input" value="Current graph" disabled />
                      </label>

                      <div className="import-export-center__path-chip">
                        <span className="import-export-center__path-chip-label">Graph context</span>
                        <span className="import-export-center__path-chip-value">
                          root {normalizedRootTxid || 'not loaded'} · depth {depth}
                        </span>
                      </div>
                    </div>

                    <div className="import-export-center__card-actions">
                      <button
                        type="button"
                        className="import-export-center__button import-export-center__button--primary"
                        onClick={() => void handlePreviewReport()}
                        disabled={!canPreviewReport}
                      >
                        {isPreviewingReport ? 'Previewing…' : 'Preview report'}
                      </button>
                      <button
                        type="button"
                        className="import-export-center__button import-export-center__button--secondary"
                        onClick={() => void handleSaveReport()}
                        disabled={!canSaveReport}
                      >
                        {isExportingReport ? 'Saving…' : 'Save CSV'}
                      </button>
                    </div>

                    {reportPreview ? (
                      <>
                        <div className="import-export-center__data-points">
                          <DataPoint label="Rows" value={reportPreview.manifest.row_count} />
                          <DataPoint label="Warnings" value={reportPreview.warnings.length} />
                          <DataPoint label="Filename" value={reportPreview.manifest.suggested_filename} />
                        </div>

                        {warningSummary.length > 0 ? (
                          <div className="import-export-center__warning-stack">
                            {warningSummary.map((item) => (
                              <div key={item.key} className="import-export-center__warning-pill">
                                <span>{item.label}</span>
                                <strong className="import-export-center__warning-count">{item.count}</strong>
                              </div>
                            ))}
                          </div>
                        ) : null}

                        {reportPreview.manifest.row_count === 0 ? (
                          <InfoFooter>
                            This preview contains zero rows. Save is disabled until data is available.
                          </InfoFooter>
                        ) : null}
                      </>
                    ) : null}

                    <InfoFooter>
                      {hasValidRootTxid
                        ? `Scope is limited to the current graph for root ${normalizedRootTxid} at depth ${depth}.`
                        : 'Load a valid graph first to preview or save a report.'}
                    </InfoFooter>

                    {reportError ? (
                      <p className="import-export-center__status import-export-center__status--error">
                        {reportError}
                      </p>
                    ) : null}

                    {reportExportResult ? (
                      <p className="import-export-center__status import-export-center__status--success">
                        Saved {reportKindLabel(reportExportResult.manifest.report_kind)} report to{' '}
                        {reportExportResult.output_path} ({reportExportResult.manifest.row_count} rows, schema v
                        {reportExportResult.manifest.schema_version}).
                      </p>
                    ) : null}
                  </article>

                  <article className="import-export-center__card">
                    <div className="import-export-center__card-header">
                      <div className="import-export-center__icon-box import-export-center__icon-box--reports">
                        <FileJson2 size={20} aria-hidden="true" />
                      </div>
                      <div className="import-export-center__card-title-wrap">
                        <h4 className="import-export-center__card-title">Export graph JSON</h4>
                        <p className="import-export-center__card-description">
                          Download the current graph as a raw JSON snapshot.
                        </p>
                      </div>
                    </div>

                    <div className="import-export-center__card-actions">
                      <button
                        type="button"
                        className="import-export-center__button import-export-center__button--primary"
                        onClick={() => void onExportGraphJson()}
                        disabled={graphActionDisabled}
                      >
                        Export graph JSON
                      </button>
                    </div>

                    <InfoFooter>
                      Exports the in-memory graph for the current root txid as a browser download.
                    </InfoFooter>
                  </article>
                </div>
              </section>
            ) : (
              <section className="import-export-center__section">
                <div className="import-export-center__section-intro import-export-center__section-intro--wide">
                  <h3 className="import-export-center__section-title">BIP-329 Labels</h3>
                  <p className="import-export-center__section-copy">
                    BIP-329 is for wallet label portability. Provenance currently applies only <CodeTag>tx</CodeTag>{' '}
                    and <CodeTag>output</CodeTag> labels as editable local state. Other record types are preserved
                    for round-trip export when possible, and ambiguous supported records are never applied
                    silently.
                  </p>
                </div>

                <div className="import-export-center__grid">
                  <article className="import-export-center__card">
                    <div className="import-export-center__card-header">
                      <div className="import-export-center__icon-box import-export-center__icon-box--import">
                        <UploadCloud size={20} aria-hidden="true" />
                      </div>
                      <div className="import-export-center__card-title-wrap">
                        <h4 className="import-export-center__card-title">Import labels</h4>
                        <p className="import-export-center__card-description">
                          Choose a file, preview the import, then explicitly apply it.
                        </p>
                      </div>
                    </div>

                    <div className="import-export-center__card-actions">
                      <button
                        type="button"
                        className="import-export-center__button import-export-center__button--primary"
                        onClick={() => void handleChooseLabelImportFile()}
                        disabled={isBusy}
                      >
                        {isPreviewingLabelImport ? 'Previewing…' : 'Choose file to preview'}
                      </button>
                      <button
                        type="button"
                        className="import-export-center__button import-export-center__button--secondary"
                        onClick={() => void handleApplyImport()}
                        disabled={!canApplyLabelImport}
                      >
                        {isApplyingLabelImport ? 'Applying…' : 'Apply import'}
                      </button>
                    </div>

                    <div className="import-export-center__path-chip">
                      <span className="import-export-center__path-chip-label">Selected file</span>
                      <span className="import-export-center__path-chip-value">
                        {labelImportPath ?? 'No file selected yet.'}
                      </span>
                    </div>

                    {labelImportPreview ? (
                      <>
                        <div className="import-export-center__data-points">
                          <DataPoint label="Total lines" value={labelImportPreview.total_lines} />
                          <DataPoint label="Apply locally" value={labelImportPreview.apply_supported} />
                          <DataPoint
                            label="Preserve only"
                            value={labelImportPreview.preserve_only + labelImportPreview.ignored_unsupported}
                          />
                          <DataPoint label="Ambiguous" value={labelImportPreview.ambiguous_supported} />
                          <DataPoint label="Invalid" value={labelImportPreview.invalid} />
                        </div>

                        <label className="import-export-center__field">
                          <span className="import-export-center__field-label">Conflict policy</span>
                          <div className="import-export-center__select-wrap">
                            <select
                              className="import-export-center__select"
                              value={labelConflictPolicy}
                              onChange={(event) =>
                                setLabelConflictPolicy(event.target.value as Bip329ImportConflictPolicy)
                              }
                              disabled={isBusy}
                            >
                              <option value="prefer_import">prefer_import</option>
                              <option value="prefer_local">prefer_local</option>
                              <option value="only_new">only_new</option>
                            </select>
                            <ChevronDown size={16} className="import-export-center__select-icon" aria-hidden="true" />
                          </div>
                        </label>

                        <InfoFooter>{conflictPolicyDescription(labelConflictPolicy)}</InfoFooter>

                        {ambiguousPreviewLines.length > 0 ? (
                          <div className="import-export-center__sample-group">
                            <h5 className="import-export-center__sample-title">Ambiguous supported records</h5>
                            <ul className="import-export-center__sample-list">
                              {ambiguousPreviewLines.map((line) => (
                                <li key={`ambiguous-${line.line_number}`} className="import-export-center__sample-item">
                                  <strong className="import-export-center__sample-ref">
                                    {formatPreviewLineReference(line)}
                                  </strong>
                                  <span className="import-export-center__sample-copy">
                                    {line.message ?? 'Multiple supported records collapse to the same local reference.'}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : null}

                        {invalidPreviewLines.length > 0 ? (
                          <div className="import-export-center__sample-group">
                            <h5 className="import-export-center__sample-title">Sample invalid lines</h5>
                            <ul className="import-export-center__sample-list">
                              {invalidPreviewLines.map((line) => (
                                <li key={`invalid-${line.line_number}`} className="import-export-center__sample-item">
                                  <strong className="import-export-center__sample-ref">
                                    {formatPreviewLineReference(line)}
                                  </strong>
                                  <span className="import-export-center__sample-copy">
                                    {line.message ?? 'Invalid BIP-329 record.'}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                      </>
                    ) : (
                      <InfoFooter>
                        Import always previews before apply.
                      </InfoFooter>
                    )}

                    {labelImportResult?.errors.length ? (
                      <div className="import-export-center__sample-group">
                        <h5 className="import-export-center__sample-title">Apply errors</h5>
                        <ul className="import-export-center__sample-list">
                          {labelImportResult.errors.slice(0, MAX_PREVIEW_SAMPLE_LINES).map((error) => (
                            <li key={`apply-error-${error.line_number}`} className="import-export-center__sample-item">
                              <strong className="import-export-center__sample-ref">Line {error.line_number}</strong>
                              <span className="import-export-center__sample-copy">{error.message}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </article>

                  <article className="import-export-center__card">
                    <div className="import-export-center__card-header">
                      <div className="import-export-center__icon-box import-export-center__icon-box--export">
                        <DownloadCloud size={20} aria-hidden="true" />
                      </div>
                      <div className="import-export-center__card-title-wrap">
                        <h4 className="import-export-center__card-title">Export labels</h4>
                        <p className="import-export-center__card-description">
                          Export supported labels and preserved records as JSONL.
                        </p>
                      </div>
                    </div>

                    <div className="import-export-center__card-actions">
                      <button
                        type="button"
                        className="import-export-center__button import-export-center__button--secondary"
                        onClick={() => void refreshLabelExportPreview()}
                        disabled={isBusy}
                      >
                        {isPreviewingLabelExport ? 'Refreshing…' : 'Refresh export counts'}
                      </button>
                      <button
                        type="button"
                        className="import-export-center__button import-export-center__button--primary"
                        onClick={() => void handleExportLabels()}
                        disabled={!canExportLabels}
                      >
                        {isExportingLabels ? 'Exporting…' : 'Export labels'}
                      </button>
                    </div>

                    {labelExportPreview ? (
                      <>
                        <div className="import-export-center__data-points import-export-center__data-points--push">
                          <DataPoint label="Records" value={labelExportPreview.record_count} />
                          <DataPoint label="Supported labels" value={labelExportPreview.supported_label_count} />
                          <DataPoint label="Preserved records" value={labelExportPreview.preserved_record_count} />
                          <DataPoint label="Filename" value={labelExportPreview.suggested_filename} />
                        </div>
                      </>
                    ) : (
                      <InfoFooter>Label export remains available without a loaded graph.</InfoFooter>
                    )}
                  </article>
                </div>

                {bipStatus ? (
                  <p
                    className={`import-export-center__status ${
                      bipStatus.tone === 'success'
                        ? 'import-export-center__status--success'
                        : 'import-export-center__status--error'
                    }`}
                  >
                    {bipStatus.message}
                  </p>
                ) : null}
              </section>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}

export default ImportExportCenter
