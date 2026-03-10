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
  const onSearchTxid = vi.fn()
  const onOpenImportExport = vi.fn()
  const onOpenRpcSettings = vi.fn()

  const result = render(
    <TopBar
      rootTxid={VALID_TXID}
      onSearchTxid={onSearchTxid}
      onOpenImportExport={onOpenImportExport}
      onOpenRpcSettings={onOpenRpcSettings}
      {...overrides}
    />,
  )

  return {
    ...result,
    onSearchTxid,
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

  it('submits a valid txid on Enter', async () => {
    const { onSearchTxid } = renderTopBar({ rootTxid: '' })
    const user = userEvent.setup()

    await user.type(screen.getByPlaceholderText('txid / outpoint / address'), `${VALID_TXID}{enter}`)

    expect(onSearchTxid).toHaveBeenCalledWith(VALID_TXID)
  })

  it('does not submit an invalid txid', async () => {
    const { onSearchTxid } = renderTopBar({ rootTxid: '' })
    const user = userEvent.setup()

    await user.type(screen.getByPlaceholderText('txid / outpoint / address'), `not-a-txid{enter}`)

    expect(onSearchTxid).not.toHaveBeenCalled()
  })
})
