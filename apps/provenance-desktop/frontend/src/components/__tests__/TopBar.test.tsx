import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TopBar from '../TopBar'
import { setGraphControlsSnapshot, type GraphControlsSnapshot } from '../../state/graphControls'

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

function setGraphSnapshot(patch: Partial<GraphControlsSnapshot> = {}) {
  setGraphControlsSnapshot({
    ...DEFAULT_GRAPH_CONTROLS_SNAPSHOT,
    ...patch,
  })
}

type TopBarTestPropsOverrides = Partial<ComponentProps<typeof TopBar>>

function renderTopBar(overrides: TopBarTestPropsOverrides = {}) {
  const onSearchInput = vi.fn()
  const onOpenImportExport = vi.fn()
  const onOpenRpcSettings = vi.fn()

  const result = render(
    <TopBar
      searchInput={VALID_TXID}
      onSearchInput={onSearchInput}
      onOpenImportExport={onOpenImportExport}
      onOpenRpcSettings={onOpenRpcSettings}
      {...overrides}
    />,
  )

  return {
    ...result,
    onSearchInput,
    onOpenImportExport,
    onOpenRpcSettings,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  setGraphSnapshot()
})
afterEach(() => {
  cleanup()
})

describe('TopBar', () => {
  it('wires top-bar action buttons to explicit callbacks', async () => {
    const { onOpenImportExport, onOpenRpcSettings } = renderTopBar()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Import / Export' }))
    await user.click(screen.getByRole('button', { name: 'RPC Settings' }))

    expect(onOpenImportExport).toHaveBeenCalledTimes(1)
    expect(onOpenRpcSettings).toHaveBeenCalledTimes(1)
  })

  it('submits a txid on Enter', async () => {
    const { onSearchInput } = renderTopBar({ searchInput: '' })
    const user = userEvent.setup()

    await user.type(screen.getByPlaceholderText('txid / outpoint / address'), `${VALID_TXID}{enter}`)
    expect(onSearchInput).toHaveBeenCalledWith(VALID_TXID)
  })

  it('submits a non-txid address input', async () => {
    const { onSearchInput } = renderTopBar({ searchInput: '' })
    const user = userEvent.setup()
    const address = 'bc1q8v7x0m4xfl6w6aw9f4f2z6qs2kg8y4mddt7h4x'

    await user.type(screen.getByPlaceholderText('txid / outpoint / address'), `${address}{enter}`)

    expect(onSearchInput).toHaveBeenCalledWith(address)
  })

  it('submits an outpoint input', async () => {
    const { onSearchInput } = renderTopBar({ searchInput: '' })
    const user = userEvent.setup()
    const outpoint = `${VALID_TXID}:1`

    await user.type(screen.getByPlaceholderText('txid / outpoint / address'), `${outpoint}{enter}`)

    expect(onSearchInput).toHaveBeenCalledWith(outpoint)
  })

  it('uses txid/outpoint placeholder when address input is unsupported', () => {
    renderTopBar({
      searchInput: '',
      addressInputEnabled: false,
      addressUnavailableReason: 'RPC backend does not support scantxoutset',
    })

    expect(screen.getByPlaceholderText('txid / outpoint')).toBeInTheDocument()
  })

  it('still submits address input when address input is unsupported', async () => {
    const { onSearchInput } = renderTopBar({
      searchInput: '',
      addressInputEnabled: false,
    })
    const user = userEvent.setup()
    const address = 'bc1q8v7x0m4xfl6w6aw9f4f2z6qs2kg8y4mddt7h4x'

    await user.type(screen.getByPlaceholderText('txid / outpoint'), `${address}{enter}`)
    expect(onSearchInput).toHaveBeenCalledWith(address)
  })

  it('still submits txid when address input is unsupported', async () => {
    const { onSearchInput } = renderTopBar({
      searchInput: '',
      addressInputEnabled: false,
    })
    const user = userEvent.setup()

    await user.type(screen.getByPlaceholderText('txid / outpoint'), `${VALID_TXID}{enter}`)

    expect(onSearchInput).toHaveBeenCalledWith(VALID_TXID)
  })

  it('does not submit empty input', async () => {
    const { onSearchInput } = renderTopBar({ searchInput: '' })
    const user = userEvent.setup()

    await user.type(screen.getByPlaceholderText('txid / outpoint / address'), `   {enter}`)

    expect(onSearchInput).not.toHaveBeenCalled()
  })
})
