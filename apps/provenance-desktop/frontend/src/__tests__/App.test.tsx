import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { invoke } from '@tauri-apps/api/core'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const REPORT_REQUEST = {
  graph: {
    root_txid: 'a'.repeat(64),
    traversal_depth: 4,
  },
  report: {
    kind: 'transactions' as const,
    scope: 'current_graph' as const,
  },
}

const graphRefreshSpy = vi.fn()
const detailRefreshSpy = vi.fn()

function MockGraphCanvas({
  onRegisterRefresh,
  onRegisterViewActions,
  onGraphDataChange,
}: {
  onRegisterRefresh: (refresh: (() => Promise<void>) | null) => void
  onRegisterViewActions: (actions: null) => void
  onGraphDataChange: (graph: null) => void
}) {
  useEffect(() => {
    onRegisterRefresh(async () => {
      graphRefreshSpy()
    })
    onRegisterViewActions(null)
    onGraphDataChange(null)

    return () => {
      onRegisterRefresh(null)
    }
  }, [onGraphDataChange, onRegisterRefresh, onRegisterViewActions])

  return <div data-testid="graph-canvas" />
}

function MockDetailPanel({
  onRegisterRefresh,
}: {
  onRegisterRefresh: (refresh: (() => Promise<void>) | null) => void
}) {
  useEffect(() => {
    onRegisterRefresh(async () => {
      detailRefreshSpy()
    })

    return () => {
      onRegisterRefresh(null)
    }
  }, [onRegisterRefresh])

  return <div data-testid="detail-panel" />
}

function MockImportExportCenter(props: {
  isOpen: boolean
  onPreviewReport: (request: typeof REPORT_REQUEST) => Promise<unknown>
  onExportReport: (request: typeof REPORT_REQUEST, outputPath: string) => Promise<unknown>
  onPreviewLabelImport: (inputPath: string) => Promise<unknown>
  onApplyLabelImport: (inputPath: string, policy: 'prefer_local') => Promise<unknown>
  onPreviewLabelExport: () => Promise<unknown>
  onExportLabels: (outputPath: string) => Promise<unknown>
}) {
  if (!props.isOpen) return null

  return (
    <div>
      <button type="button" onClick={() => void props.onPreviewReport(REPORT_REQUEST)}>
        Preview report
      </button>
      <button
        type="button"
        onClick={() => void props.onExportReport(REPORT_REQUEST, '/tmp/report.csv')}
      >
        Export report
      </button>
      <button
        type="button"
        onClick={() => void props.onPreviewLabelImport('/tmp/import.jsonl')}
      >
        Preview labels import
      </button>
      <button
        type="button"
        onClick={() => void props.onApplyLabelImport('/tmp/import.jsonl', 'prefer_local')}
      >
        Apply labels import
      </button>
      <button type="button" onClick={() => void props.onPreviewLabelExport()}>
        Preview labels export
      </button>
      <button type="button" onClick={() => void props.onExportLabels('/tmp/export.jsonl')}>
        Export labels
      </button>
    </div>
  )
}

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

vi.mock('../components/Sidebar', () => ({
  default: () => <div data-testid="sidebar" />,
}))

vi.mock('../components/TopBar', () => ({
  default: (props: { onOpenImportExport: () => void }) => (
    <button type="button" onClick={props.onOpenImportExport}>
      Open Import Export
    </button>
  ),
}))

vi.mock('../components/GraphCanvas', () => ({
  default: MockGraphCanvas,
}))

vi.mock('../components/DetailPanel', () => ({
  default: MockDetailPanel,
}))

vi.mock('../components/import-export/ImportExportCenter', () => ({
  default: MockImportExportCenter,
}))

import App from '../App'
async function connectRpc(user: ReturnType<typeof userEvent.setup>) {
  await waitFor(() =>
    expect(screen.getByLabelText('RPC URL')).toHaveValue('http://127.0.0.1:8332'),
  )
  await user.click(screen.getByRole('button', { name: 'Connect' }))
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith('cmd_set_rpc_config', {
      args: {
        url: 'http://127.0.0.1:8332',
        authMode: 'none',
        username: null,
        password: null,
      },
    }),
  )
  await waitFor(() => expect(screen.queryByText('Connect Bitcoin RPC')).not.toBeInTheDocument())
}

beforeEach(() => {
  vi.clearAllMocks()
  graphRefreshSpy.mockReset()
  detailRefreshSpy.mockReset()
  vi.mocked(invoke).mockImplementation((command) => {
    switch (command) {
      case 'cmd_get_rpc_config_prefill':
        return Promise.resolve({
          schemaVersion: 1,
          url: 'http://127.0.0.1:8332',
          authMode: 'none',
          username: null,
        })
      case 'cmd_set_rpc_config':
        return Promise.resolve(undefined)
      case 'cmd_preview_report':
        return Promise.resolve({
          manifest: {
            report_kind: 'transactions',
            report_scope: 'current_graph',
            schema_version: 1,
            row_count: 2,
            columns: ['txid'],
            suggested_filename: 'transactions.csv',
          },
          warnings: [],
        })
      case 'cmd_export_report':
        return Promise.resolve({
          output_path: '/tmp/report.csv',
          manifest: {
            report_kind: 'transactions',
            report_scope: 'current_graph',
            schema_version: 1,
            row_count: 2,
            columns: ['txid'],
            suggested_filename: 'transactions.csv',
          },
          warnings: [],
        })
      case 'cmd_preview_labels_import':
        return Promise.resolve({
          total_lines: 1,
          apply_supported: 1,
          preserve_only: 0,
          ambiguous_supported: 0,
          invalid: 0,
          ignored_unsupported: 0,
          lines: [],
        })
      case 'cmd_apply_labels_import':
        return Promise.resolve({
          total_lines: 1,
          imported: 1,
          preserved_only: 0,
          ambiguous_supported: 0,
          skipped_unsupported_type: 0,
          skipped_invalid: 0,
          errors: [],
        })
      case 'cmd_preview_labels_export':
        return Promise.resolve({
          suggested_filename: 'provenance-bip329-labels.jsonl',
          record_count: 1,
          supported_label_count: 1,
          preserved_record_count: 0,
          jsonl_contents: '',
        })
      case 'cmd_export_labels':
        return Promise.resolve('/tmp/export.jsonl')
      default:
        return Promise.resolve(undefined)
    }
  })
})

afterEach(() => {
  cleanup()
})

describe('App import/export wiring', () => {
  it('requires modal-first RPC connection before graph workflows run', async () => {
    const user = userEvent.setup()
    render(<App />)

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('cmd_get_rpc_config_prefill'))
    expect(invoke).not.toHaveBeenCalledWith(
      'cmd_set_rpc_config',
      expect.objectContaining({ args: expect.any(Object) }),
    )
    expect(screen.queryByTestId('graph-canvas')).not.toBeInTheDocument()

    await connectRpc(user)

    expect(screen.getByTestId('graph-canvas')).toBeInTheDocument()
  })
  it('routes desktop import/export actions through the expected Tauri commands', async () => {
    const user = userEvent.setup()
    render(<App />)
    await connectRpc(user)

    await user.click(screen.getByRole('button', { name: 'Open Import Export' }))
    await user.click(screen.getByRole('button', { name: 'Preview report' }))
    await user.click(screen.getByRole('button', { name: 'Export report' }))
    await user.click(screen.getByRole('button', { name: 'Preview labels import' }))
    await user.click(screen.getByRole('button', { name: 'Preview labels export' }))
    await user.click(screen.getByRole('button', { name: 'Export labels' }))

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('cmd_preview_report', {
        args: REPORT_REQUEST,
      }),
    )
    expect(invoke).toHaveBeenCalledWith('cmd_export_report', {
      args: {
        request: REPORT_REQUEST,
        outputPath: '/tmp/report.csv',
      },
    })
    expect(invoke).toHaveBeenCalledWith('cmd_preview_labels_import', {
      args: {
        inputPath: '/tmp/import.jsonl',
      },
    })
    expect(invoke).toHaveBeenCalledWith('cmd_preview_labels_export')
    expect(invoke).toHaveBeenCalledWith('cmd_export_labels', {
      args: {
        outputPath: '/tmp/export.jsonl',
      },
    })
  })

  it('refreshes graph and detail state after applying a BIP-329 import', async () => {
    const user = userEvent.setup()
    render(<App />)
    await connectRpc(user)

    await user.click(screen.getByRole('button', { name: 'Open Import Export' }))
    await user.click(screen.getByRole('button', { name: 'Apply labels import' }))

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('cmd_apply_labels_import', {
        args: {
          inputPath: '/tmp/import.jsonl',
          policy: 'prefer_local',
        },
      }),
    )
    await waitFor(() => expect(graphRefreshSpy).toHaveBeenCalledTimes(1))
    expect(detailRefreshSpy).toHaveBeenCalledTimes(1)
  })
})
