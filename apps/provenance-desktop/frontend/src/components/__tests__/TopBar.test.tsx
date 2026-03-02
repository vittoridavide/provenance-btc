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
  depth: 10,
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
  const onFitView = vi.fn()
  const onResetLayout = vi.fn()
  const onExportGraphJson = vi.fn()
  const onExportLabels = vi.fn()
  const onImportLabels = vi.fn().mockResolvedValue(undefined)
  const onToggleSidebar = vi.fn()
  const onToggleDetail = vi.fn()

  const result = render(
    <TopBar
      rootTxid={VALID_TXID}
      onSearchTxid={onSearchTxid}
      onFitView={onFitView}
      onResetLayout={onResetLayout}
      onExportGraphJson={onExportGraphJson}
      onExportLabels={onExportLabels}
      onImportLabels={onImportLabels}
      showPanelToggles={true}
      sidebarCollapsed={false}
      detailCollapsed={false}
      onToggleSidebar={onToggleSidebar}
      onToggleDetail={onToggleDetail}
      {...overrides}
    />,
  )

  return {
    ...result,
    onSearchTxid,
    onFitView,
    onResetLayout,
    onExportGraphJson,
    onExportLabels,
    onImportLabels,
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
    const { container, onFitView, onResetLayout, onExportGraphJson, onExportLabels, onImportLabels } =
      renderTopBar()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Fit to view' }))
    await user.click(screen.getByRole('button', { name: 'Reset layout' }))
    await user.click(screen.getByRole('button', { name: 'Export graph JSON' }))
    await user.click(screen.getByRole('button', { name: 'Export labels' }))

    const fileInput = container.querySelector('input[type="file"]')
    expect(fileInput).toBeInstanceOf(HTMLInputElement)
    await user.upload(fileInput as HTMLInputElement, new File(['{}'], 'labels.jsonl'))

    expect(onFitView).toHaveBeenCalledTimes(1)
    expect(onResetLayout).toHaveBeenCalledTimes(1)
    expect(onExportGraphJson).toHaveBeenCalledTimes(1)
    expect(onExportLabels).toHaveBeenCalledTimes(1)
    expect(onImportLabels).toHaveBeenCalledTimes(1)
  })

  it('disables graph-dependent actions when graph state is unavailable', () => {
    setGraphSnapshot({
      canControl: false,
      nodeCount: 0,
      isGraphLoading: false,
    })

    renderTopBar()

    expect(screen.getByRole('button', { name: 'Fit to view' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Reset layout' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Export graph JSON' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Export labels' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Import labels' })).toBeDisabled()
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
