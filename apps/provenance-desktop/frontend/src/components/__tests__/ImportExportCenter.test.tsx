import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog'
import type { ComponentProps } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ImportExportCenter from '../import-export/ImportExportCenter'
import { setGraphControlsSnapshot, type GraphControlsSnapshot } from '../../state/graphControls'
import type {
  Bip329ExportResult,
  Bip329ImportApplyResult,
  Bip329ImportPreviewResponse,
  ReportFileExportResult,
  ReportPreviewResponse,
} from '../../types/api'

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(),
  save: vi.fn(),
}))

const VALID_TXID = 'a'.repeat(64)
const DEFAULT_GRAPH_CONTROLS_SNAPSHOT: GraphControlsSnapshot = {
  auditMode: false,
  colorByCategory: false,
  showTransactions: 'all',
  depth: 10,
  showOnlyPathsToSelected: false,
  hideUnrelatedBranches: false,
  layoutMode: 'lr',
  canControl: true,
  nodeCount: 1,
  isGraphLoading: false,
  graphError: null,
}

const REPORT_PREVIEW: ReportPreviewResponse = {
  manifest: {
    report_kind: 'transactions',
    report_scope: 'current_graph',
    schema_version: 1,
    row_count: 2,
    columns: ['txid'],
    suggested_filename: 'transactions.csv',
  },
  warnings: [],
}

const REPORT_EXPORT_RESULT: ReportFileExportResult = {
  output_path: '/tmp/transactions.csv',
  manifest: REPORT_PREVIEW.manifest,
  warnings: [],
}

const LABEL_IMPORT_PREVIEW: Bip329ImportPreviewResponse = {
  total_lines: 4,
  apply_supported: 1,
  preserve_only: 1,
  ambiguous_supported: 1,
  invalid: 1,
  ignored_unsupported: 0,
  lines: [
    {
      line_number: 1,
      disposition: 'apply_supported',
      record_type: 'tx',
      record_ref: VALID_TXID,
      origin: null,
      message: null,
    },
    {
      line_number: 2,
      disposition: 'ambiguous_supported',
      record_type: 'tx',
      record_ref: VALID_TXID,
      origin: 'wallet-b',
      message: 'multiple supported records collapse to the same local reference',
    },
    {
      line_number: 3,
      disposition: 'preserve_only',
      record_type: 'addr',
      record_ref: '1BoatSLRHtKNngkdXEeobR76b53LETtpyT',
      origin: 'wallet-a',
      message: null,
    },
    {
      line_number: 4,
      disposition: 'invalid',
      record_type: null,
      record_ref: null,
      origin: null,
      message: 'json parse error on line 4',
    },
  ],
}

const LABEL_IMPORT_RESULT: Bip329ImportApplyResult = {
  total_lines: 4,
  imported: 1,
  preserved_only: 1,
  ambiguous_supported: 1,
  skipped_unsupported_type: 0,
  skipped_invalid: 1,
  errors: [
    {
      line_number: 4,
      message: 'json parse error on line 4',
    },
  ],
}

const LABEL_EXPORT_PREVIEW: Bip329ExportResult = {
  suggested_filename: 'provenance-bip329-labels.jsonl',
  record_count: 3,
  supported_label_count: 1,
  preserved_record_count: 2,
  jsonl_contents: '',
}

function setGraphSnapshot(patch: Partial<GraphControlsSnapshot> = {}) {
  setGraphControlsSnapshot({
    ...DEFAULT_GRAPH_CONTROLS_SNAPSHOT,
    ...patch,
  })
}

type ImportExportCenterOverrides = Partial<ComponentProps<typeof ImportExportCenter>>

function renderCenter(overrides: ImportExportCenterOverrides = {}) {
  const onClose = vi.fn()
  const onPreviewReport = vi.fn().mockResolvedValue(REPORT_PREVIEW)
  const onExportReport = vi.fn().mockResolvedValue(REPORT_EXPORT_RESULT)
  const onPreviewLabelImport = vi.fn().mockResolvedValue(LABEL_IMPORT_PREVIEW)
  const onApplyLabelImport = vi.fn().mockResolvedValue(LABEL_IMPORT_RESULT)
  const onPreviewLabelExport = vi.fn().mockResolvedValue(LABEL_EXPORT_PREVIEW)
  const onExportLabels = vi.fn().mockResolvedValue('/tmp/export.jsonl')

  const result = render(
    <ImportExportCenter
      isOpen
      onClose={onClose}
      rootTxid={VALID_TXID}
      onPreviewReport={onPreviewReport}
      onExportReport={onExportReport}
      onPreviewLabelImport={onPreviewLabelImport}
      onApplyLabelImport={onApplyLabelImport}
      onPreviewLabelExport={onPreviewLabelExport}
      onExportLabels={onExportLabels}
      {...overrides}
    />,
  )

  return {
    ...result,
    onClose,
    onPreviewReport,
    onExportReport,
    onPreviewLabelImport,
    onApplyLabelImport,
    onPreviewLabelExport,
    onExportLabels,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  setGraphSnapshot()
})

afterEach(() => {
  cleanup()
})

describe('ImportExportCenter', () => {
  it('previews and exports a report through the native save dialog', async () => {
    vi.mocked(saveDialog).mockResolvedValue('/tmp/transactions.csv')
    const { onExportReport, onPreviewReport } = renderCenter()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Preview report' }))

    await waitFor(() =>
      expect(onPreviewReport).toHaveBeenCalledWith({
        graph: {
          root_txid: VALID_TXID,
          traversal_depth: DEFAULT_GRAPH_CONTROLS_SNAPSHOT.depth,
        },
        report: {
          kind: 'transactions',
          scope: 'current_graph',
        },
      }),
    )

    await user.click(screen.getByRole('button', { name: 'Save CSV' }))

    await waitFor(() =>
      expect(onExportReport).toHaveBeenCalledWith(
        {
          graph: {
            root_txid: VALID_TXID,
            traversal_depth: DEFAULT_GRAPH_CONTROLS_SNAPSHOT.depth,
          },
          report: {
            kind: 'transactions',
            scope: 'current_graph',
          },
        },
        '/tmp/transactions.csv',
      ),
    )
    expect(screen.getByText(/Saved Transactions report to \/tmp\/transactions\.csv/i)).toBeInTheDocument()
  })

  it('keeps CSV save disabled when the report preview is empty', async () => {
    const zeroRowPreview: ReportPreviewResponse = {
      ...REPORT_PREVIEW,
      manifest: {
        ...REPORT_PREVIEW.manifest,
        row_count: 0,
      },
    }
    const { onExportReport } = renderCenter({
      onPreviewReport: vi.fn().mockResolvedValue(zeroRowPreview),
    })
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Preview report' }))

    await screen.findByText(/This preview contains zero rows/i)
    expect(screen.getByRole('button', { name: 'Save CSV' })).toBeDisabled()
    expect(onExportReport).not.toHaveBeenCalled()
  })

  it('shows report preview failures inline', async () => {
    const user = userEvent.setup()
    renderCenter({
      onPreviewReport: vi.fn().mockRejectedValue(new Error('preview exploded')),
    })

    await user.click(screen.getByRole('button', { name: 'Preview report' }))

    expect(await screen.findByText(/Preview failed: preview exploded/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save CSV' })).toBeDisabled()
  })
  it('requires preview before applying a BIP-329 import and forwards the selected conflict policy', async () => {
    vi.mocked(openDialog).mockResolvedValue('/tmp/import.jsonl')
    const { onApplyLabelImport, onPreviewLabelExport, onPreviewLabelImport } = renderCenter()
    const user = userEvent.setup()

    await user.click(screen.getByRole('tab', { name: 'BIP-329 Labels' }))

    await waitFor(() => expect(onPreviewLabelExport).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('button', { name: 'Apply import' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Choose file to preview' }))

    await waitFor(() => expect(onPreviewLabelImport).toHaveBeenCalledWith('/tmp/import.jsonl'))
    expect(screen.getByText('Ambiguous supported records')).toBeInTheDocument()
    expect(screen.getByText('Sample invalid lines')).toBeInTheDocument()

    await user.selectOptions(screen.getByRole('combobox', { name: 'Conflict policy' }), 'prefer_local')
    await user.click(screen.getByRole('button', { name: 'Apply import' }))

    await waitFor(() =>
      expect(onApplyLabelImport).toHaveBeenCalledWith('/tmp/import.jsonl', 'prefer_local'),
    )
    expect(screen.getByText(/Applied 1 supported labels and preserved 2 records/i)).toBeInTheDocument()
  })

  it('loads export counts for BIP-329 labels and exports through the native save dialog', async () => {
    vi.mocked(saveDialog).mockResolvedValue('/tmp/export.jsonl')
    const { onExportLabels, onPreviewLabelExport } = renderCenter()
    const user = userEvent.setup()

    await user.click(screen.getByRole('tab', { name: 'BIP-329 Labels' }))

    await waitFor(() => expect(onPreviewLabelExport).toHaveBeenCalledTimes(1))
    expect(screen.getByText('Supported labels')).toBeInTheDocument()
    expect(screen.getByText('Preserved records')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Export labels' }))

    await waitFor(() => expect(onExportLabels).toHaveBeenCalledWith('/tmp/export.jsonl'))
    expect(screen.getByText(/Exported 3 BIP-329 records to \/tmp\/export.jsonl/i)).toBeInTheDocument()
  })

  it('shows BIP-329 import preview errors and keeps apply disabled', async () => {
    vi.mocked(openDialog).mockResolvedValue('/tmp/broken.jsonl')
    const user = userEvent.setup()
    renderCenter({
      onPreviewLabelImport: vi.fn().mockRejectedValue(new Error('invalid jsonl file')),
    })

    await user.click(screen.getByRole('tab', { name: 'BIP-329 Labels' }))
    await user.click(screen.getByRole('button', { name: 'Choose file to preview' }))

    expect(await screen.findByText(/Import preview failed: invalid jsonl file/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Apply import' })).toBeDisabled()
  })
})
