import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { invoke } from '@tauri-apps/api/core'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const TXID_A = 'a'.repeat(64)
const TXID_B = 'b'.repeat(64)
const AMBIGUOUS_ADDRESS = 'bc1qambiguous00000000000000000000000000000'
const NO_UTXO_ADDRESS = 'bc1qnoutxo0000000000000000000000000000000'

const graphRefreshSpy = vi.fn()
const detailRefreshSpy = vi.fn()

function reportRequestFor(rootTxid: string) {
  return {
    graph: {
      root_txid: rootTxid,
      traversal_depth: 4,
    },
    report: {
      kind: 'transactions' as const,
      scope: 'current_graph' as const,
    },
  }
}

function MockGraphCanvas({
  input,
  selectedRootTxid,
  onRegisterRefresh,
  onRegisterViewActions,
  onGraphDataChange,
  onGraphSummaryChange,
  onResolutionChange,
  onSelectTxid,
}: {
  input: string
  selectedRootTxid?: string | null
  onRegisterRefresh: (refresh: (() => Promise<void>) | null) => void
  onRegisterViewActions: (actions: null) => void
  onGraphDataChange: (graph: { nodes: unknown[]; edges: unknown[]; summary: unknown } | null) => void
  onGraphSummaryChange: (summary: {
    total_nodes: number
    unclassified_nodes: number
    missing_parent_edges: number
    confirmed_nodes: number
    mempool_nodes: number
    total_outputs: number
    labeled_transactions: number
    labeled_outputs: number
  } | null) => void
  onResolutionChange: (resolution: {
    normalized_input: string
    input_kind: 'txid' | 'address'
    candidate_roots: Array<{ txid: string; vout: number | null; amount_sat: number | null; height: number | null }>
    selected_root_txid: string | null
    requires_selection: boolean
  } | null) => void
  onSelectTxid: (txid: string | null) => void
}) {
  useEffect(() => {
    onRegisterRefresh(async () => {
      graphRefreshSpy()
    })
    onRegisterViewActions(null)
    return () => {
      onRegisterRefresh(null)
    }
  }, [onRegisterRefresh, onRegisterViewActions])

  useEffect(() => {
    const normalizedInput = input.trim()
    if (!normalizedInput) {
      onResolutionChange(null)
      onGraphDataChange(null)
      onGraphSummaryChange(null)
      return
    }

    if (normalizedInput === NO_UTXO_ADDRESS) {
      onResolutionChange(null)
      onGraphDataChange(null)
      onGraphSummaryChange(null)
      return
    }

    if (normalizedInput === AMBIGUOUS_ADDRESS && selectedRootTxid !== TXID_B) {
      onResolutionChange({
        normalized_input: AMBIGUOUS_ADDRESS,
        input_kind: 'address',
        candidate_roots: [
          { txid: TXID_A, vout: 0, amount_sat: 1000, height: 100 },
          { txid: TXID_B, vout: 1, amount_sat: 2000, height: 90 },
        ],
        selected_root_txid: null,
        requires_selection: true,
      })
      onGraphDataChange(null)
      onGraphSummaryChange(null)
      return
    }

    const resolvedRootTxid = normalizedInput === AMBIGUOUS_ADDRESS ? TXID_B : TXID_A
    onResolutionChange({
      normalized_input: normalizedInput,
      input_kind: normalizedInput === AMBIGUOUS_ADDRESS ? 'address' : 'txid',
      candidate_roots: [{ txid: resolvedRootTxid, vout: null, amount_sat: null, height: null }],
      selected_root_txid: resolvedRootTxid,
      requires_selection: false,
    })
    onGraphDataChange({
      nodes: [{ txid: resolvedRootTxid }],
      edges: [],
      summary: {},
    })
    onGraphSummaryChange({
      total_nodes: 1,
      unclassified_nodes: 0,
      missing_parent_edges: 0,
      confirmed_nodes: 1,
      mempool_nodes: 0,
      total_outputs: 2,
      labeled_transactions: 1,
      labeled_outputs: 1,
    })
  }, [input, onGraphDataChange, onGraphSummaryChange, onResolutionChange, selectedRootTxid])

  return (
    <div data-testid="graph-canvas">
      <button type="button" onClick={() => onSelectTxid('selected-txid')}>
        Select tx card
      </button>
      <button type="button" onClick={() => onSelectTxid(null)}>
        Clear tx selection
      </button>
      {input.trim() === NO_UTXO_ADDRESS ? 'no unspent outputs found for address' : null}
    </div>
  )
}

function MockDetailPanel({
  onRegisterRefresh,
  onDeselect,
}: {
  onRegisterRefresh: (refresh: (() => Promise<void>) | null) => void
  onDeselect?: () => void
}) {
  useEffect(() => {
    onRegisterRefresh(async () => {
      detailRefreshSpy()
    })

    return () => {
      onRegisterRefresh(null)
    }
  }, [onRegisterRefresh])

  return (
    <div data-testid="detail-panel">
      <button type="button" onClick={onDeselect}>
        Deselect tx card
      </button>
    </div>
  )
}

function MockDataManagementSidebar(props: {
  rootTxid: string
  onExportReport: (request: ReturnType<typeof reportRequestFor>, outputPath: string) => Promise<unknown>
  onApplyLabelImport: (inputPath: string, policy: 'prefer_local') => Promise<unknown>
  onExportLabels: (outputPath: string) => Promise<unknown>
}) {

  return (
    <div data-testid="data-management-sidebar">
      <div data-testid="resolved-root">{props.rootTxid}</div>
      <button
        type="button"
        onClick={() => void props.onExportReport(reportRequestFor(props.rootTxid), '/tmp/report.csv')}
      >
        Export report
      </button>
      <button
        type="button"
        onClick={() => void props.onApplyLabelImport('/tmp/import.jsonl', 'prefer_local')}
      >
        Apply labels import
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
  default: () => (
    <div data-testid="sidebar" />
  ),
}))

vi.mock('../components/TopBar', () => ({
  default: (props: {
    onOpenRpcSettings: () => void
    onSearchInput: (input: string) => void
    showChangeRootTxButton?: boolean
    onChangeRootTx?: () => void
  }) => (
    <div>
      <button type="button" onClick={props.onOpenRpcSettings}>
        RPC Settings
      </button>
      <button type="button" onClick={() => props.onSearchInput(TXID_A)}>
        Search txid
      </button>
      <button type="button" onClick={() => props.onSearchInput(AMBIGUOUS_ADDRESS)}>
        Search ambiguous address
      </button>
      <button type="button" onClick={() => props.onSearchInput(NO_UTXO_ADDRESS)}>
        Search no-utxo address
      </button>
      {props.showChangeRootTxButton ? (
        <button type="button" onClick={props.onChangeRootTx}>
          Change root tx
        </button>
      ) : null}
    </div>
  ),
}))

vi.mock('../components/GraphCanvas', () => ({
  default: MockGraphCanvas,
}))

vi.mock('../components/RootCandidatePicker', () => ({
  default: (props: {
    isOpen: boolean
    resolution: { candidate_roots: Array<{ txid: string }> }
    onSelectRootTxid: (rootTxid: string) => void
  }) =>
    props.isOpen ? (
      <div data-testid="root-candidate-picker">
        {props.resolution.candidate_roots.map((candidate) => (
          <button
            key={candidate.txid}
            type="button"
            onClick={() => props.onSelectRootTxid(candidate.txid)}
          >
            Choose {candidate.txid}
          </button>
        ))}
      </div>
    ) : null,
}))

vi.mock('../components/DetailPanel', () => ({
  default: MockDetailPanel,
}))

vi.mock('../components/DataManagementSidebar', () => ({
  default: MockDataManagementSidebar,
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
      case 'cmd_get_graph_input_capabilities':
        return Promise.resolve({
          supported_input_kinds: ['txid', 'outpoint', 'address'],
          address_unavailable_reason: null,
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

describe('App input-driven flow', () => {
  it('shows RPC setup modal on startup and blocks dismiss before first successful connection', async () => {
    const user = userEvent.setup()
    render(<App />)

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('cmd_get_rpc_config_prefill'))
    expect(screen.getByText('Connect Bitcoin RPC')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.getByText('RPC connection is required before continuing.')).toBeInTheDocument()
    expect(screen.getByText('Connect Bitcoin RPC')).toBeInTheDocument()
    expect(screen.queryByTestId('graph-canvas')).not.toBeInTheDocument()
  })

  it('routes txid search directly to a resolved root txid for report export', async () => {
    const user = userEvent.setup()
    render(<App />)
    await connectRpc(user)

    await user.click(screen.getByRole('button', { name: 'Search txid' }))
    await screen.findByTestId('data-management-sidebar')
    await user.click(screen.getByRole('button', { name: 'Export report' }))

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('cmd_export_report', {
        args: {
          request: reportRequestFor(TXID_A),
          outputPath: '/tmp/report.csv',
        },
      }),
    )
    expect(screen.getByTestId('resolved-root')).toHaveTextContent(TXID_A)
  })

  it('supports ambiguous address resolution via candidate picker before loading reports', async () => {
    const user = userEvent.setup()
    render(<App />)
    await connectRpc(user)

    await user.click(screen.getByRole('button', { name: 'Search ambiguous address' }))

    expect(await screen.findByTestId('root-candidate-picker')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: `Choose ${TXID_B}` }))
    await waitFor(() =>
      expect(screen.queryByTestId('root-candidate-picker')).not.toBeInTheDocument(),
    )
    await screen.findByTestId('data-management-sidebar')
    await user.click(screen.getByRole('button', { name: 'Export report' }))

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('cmd_export_report', {
        args: {
          request: reportRequestFor(TXID_B),
          outputPath: '/tmp/report.csv',
        },
      }),
    )
    expect(screen.getByTestId('resolved-root')).toHaveTextContent(TXID_B)
  })

  it('reopens the root candidate picker from top bar after selecting an address root', async () => {
    const user = userEvent.setup()
    render(<App />)
    await connectRpc(user)

    await user.click(screen.getByRole('button', { name: 'Search ambiguous address' }))
    expect(await screen.findByTestId('root-candidate-picker')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: `Choose ${TXID_B}` }))
    await waitFor(() =>
      expect(screen.queryByTestId('root-candidate-picker')).not.toBeInTheDocument(),
    )

    await user.click(screen.getByRole('button', { name: 'Change root tx' }))
    expect(await screen.findByTestId('root-candidate-picker')).toBeInTheDocument()
  })

  it('shows a user-visible no-UTXO address error state', async () => {
    const user = userEvent.setup()
    render(<App />)
    await connectRpc(user)

    await user.click(screen.getByRole('button', { name: 'Search no-utxo address' }))

    expect(await screen.findByText(/no unspent outputs found for address/i)).toBeInTheDocument()
  })

  it('refreshes graph and detail state after applying a BIP-329 import', async () => {
    const user = userEvent.setup()
    render(<App />)
    await connectRpc(user)
    await user.click(screen.getByRole('button', { name: 'Search txid' }))
    await screen.findByTestId('data-management-sidebar')
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
    expect(detailRefreshSpy).toHaveBeenCalledTimes(0)
  })

  it('shows data management after search, hides it on tx selection, and restores it on deselect', async () => {
    const user = userEvent.setup()
    render(<App />)
    await connectRpc(user)

    await user.click(screen.getByRole('button', { name: 'Search txid' }))
    expect(await screen.findByTestId('data-management-sidebar')).toBeInTheDocument()
    expect(screen.queryByTestId('detail-panel')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Select tx card' }))
    expect(await screen.findByTestId('detail-panel')).toBeInTheDocument()
    expect(screen.queryByTestId('data-management-sidebar')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Deselect tx card' }))
    expect(await screen.findByTestId('data-management-sidebar')).toBeInTheDocument()
    expect(screen.queryByTestId('detail-panel')).not.toBeInTheDocument()
  })
})
