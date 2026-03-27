import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog'
import type { ComponentProps } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import DataManagementSidebar from '../DataManagementSidebar'
import { setGraphControlsSnapshot, type GraphControlsSnapshot } from '../../state/graphControls'
import type { GraphSummary, ReportFileExportResult } from '../../types/api'

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(),
  save: vi.fn(),
}))

const VALID_TXID = 'a'.repeat(64)
const DEFAULT_GRAPH_CONTROLS_SNAPSHOT: GraphControlsSnapshot = {
  auditMode: false,
  colorByCategory: false,
  showTransactions: 'all',
  depth: 3,
  showOnlyPathsToSelected: false,
  hideUnrelatedBranches: false,
  layoutMode: 'lr',
  canControl: true,
  nodeCount: 1,
  isGraphLoading: false,
  graphError: null,
}

const SUMMARY: GraphSummary = {
  total_nodes: 10,
  unclassified_nodes: 2,
  missing_parent_edges: 0,
  confirmed_nodes: 8,
  mempool_nodes: 2,
  total_outputs: 20,
  labeled_transactions: 4,
  labeled_outputs: 7,
}

const REPORT_EXPORT_RESULT: ReportFileExportResult = {
  output_path: '/tmp/transactions.csv',
  manifest: {
    report_kind: 'transactions',
    report_scope: 'current_graph',
    schema_version: 1,
    row_count: 3,
    columns: ['txid'],
    suggested_filename: 'transactions.csv',
  },
  warnings: [],
}

function setGraphSnapshot(patch: Partial<GraphControlsSnapshot> = {}) {
  setGraphControlsSnapshot({
    ...DEFAULT_GRAPH_CONTROLS_SNAPSHOT,
    ...patch,
  })
}

type SidebarOverrides = Partial<ComponentProps<typeof DataManagementSidebar>>

function renderSidebar(overrides: SidebarOverrides = {}) {
  const onExportReport = vi.fn().mockResolvedValue(REPORT_EXPORT_RESULT)
  const onApplyLabelImport = vi.fn().mockResolvedValue({
    total_lines: 2,
    imported: 1,
    preserved_only: 1,
    ambiguous_supported: 0,
    skipped_unsupported_type: 0,
    skipped_invalid: 0,
    errors: [],
  })
  const onExportLabels = vi.fn().mockResolvedValue('/tmp/export.jsonl')

  const result = render(
    <DataManagementSidebar
      rootTxid={VALID_TXID}
      graphSummary={SUMMARY}
      graphEdgeCount={8}
      onExportReport={onExportReport}
      onApplyLabelImport={onApplyLabelImport}
      onExportLabels={onExportLabels}
      {...overrides}
    />,
  )

  return {
    ...result,
    onExportReport,
    onApplyLabelImport,
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

describe('DataManagementSidebar', () => {
  it('exports transactions CSV with graph context and selected output path', async () => {
    vi.mocked(saveDialog).mockResolvedValue('/tmp/transactions.csv')
    const { onExportReport } = renderSidebar()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: /Transactions CSV/i }))

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
  })

  it('shows import errors inline for BIP-329 import', async () => {
    vi.mocked(openDialog).mockResolvedValue('/tmp/broken.jsonl')
    const user = userEvent.setup()
    renderSidebar({
      onApplyLabelImport: vi.fn().mockRejectedValue(new Error('invalid jsonl file')),
    })

    await user.click(screen.getByRole('button', { name: /Choose file to import/i }))

    expect(await screen.findByText(/invalid jsonl file/i)).toBeInTheDocument()
  })

  it('disables CSV export actions when root txid is not resolved', () => {
    renderSidebar({ rootTxid: '' })

    expect(screen.getByRole('button', { name: /Transactions CSV/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Outputs CSV/i })).toBeDisabled()
    expect(screen.getByText(/Resolve a root txid from your search input first/i)).toBeInTheDocument()
  })

  it('exports BIP-329 labels via native save path', async () => {
    vi.mocked(saveDialog).mockResolvedValue('/tmp/export.jsonl')
    const { onExportLabels } = renderSidebar()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Export BIP-329 labels' }))

    await waitFor(() => expect(onExportLabels).toHaveBeenCalledWith('/tmp/export.jsonl'))
  })
})
