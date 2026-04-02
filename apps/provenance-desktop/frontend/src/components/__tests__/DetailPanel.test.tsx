import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { invoke } from '@tauri-apps/api/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import DetailPanel from '../DetailPanel'
import { useTransactionDetail } from '../../hooks/useTransactionDetail'
import type { TransactionDetail } from '../../types/api'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

vi.mock('../../hooks/useTransactionDetail', () => ({
  useTransactionDetail: vi.fn(),
}))

const baseDetail: TransactionDetail = {
  txid: 'txid-123',
  hex: '',
  version: 2,
  lock_time: 0,
  weight: 400,
  vsize: 100,
  fee_sat: null,
  feerate_sat_vb: null,
  confirmations: 6,
  blockhash: null,
  block_height: null,
  block_time: null,
  inputs: [],
  outputs: [
    {
      vout: 0,
      value_sat: 150_000,
      script_pubkey_hex: '',
      script_type: 'p2wpkh',
      address: null,
      label: null,
      classification: null,
    },
    {
      vout: 1,
      value_sat: 350_000,
      script_pubkey_hex: '',
      script_type: 'p2tr',
      address: null,
      label: 'old output note',
      classification: {
        category: 'expense',
        context: '',
        metadata: { internal_change: true },
        tax_relevant: false,
      },
    },
  ],
  label: 'old tx label',
  classification: {
    category: 'revenue',
    context: '',
    metadata: {},
    tax_relevant: false,
  },
}

function makeDetail(overrides: Partial<TransactionDetail> = {}): TransactionDetail {
  return {
    ...baseDetail,
    classification: baseDetail.classification ? { ...baseDetail.classification } : null,
    outputs: baseDetail.outputs.map((output) => ({
      ...output,
      classification: output.classification ? { ...output.classification } : null,
    })),
    ...overrides,
  }
}

function mockDetail(detail: TransactionDetail) {
  const reload = vi.fn().mockResolvedValue(undefined)
  vi.mocked(useTransactionDetail).mockReturnValue({
    detail,
    loading: false,
    error: null,
    reload,
  })
  return { reload }
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  cleanup()
})

describe('DetailPanel', () => {
  it('renders the right drawer structure for a selected transaction', () => {
    const detail = makeDetail()
    mockDetail(detail)

    render(<DetailPanel selectedTxid={detail.txid} />)

    expect(screen.getByText('Transaction Details')).toBeInTheDocument()
    expect(screen.getByText('Classify and add accounting metadata')).toBeInTheDocument()
    expect(screen.getByText('Output Classification')).toBeInTheDocument()
    expect(screen.getByText('P2WPKH')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save Classification' })).toBeInTheDocument()
  })

  it('shows delete label instead of clear classification in simple mode', () => {
    const detail = makeDetail({ classification: null })
    mockDetail(detail)

    render(<DetailPanel selectedTxid={detail.txid} />)

    expect(screen.getByRole('button', { name: 'Save Label' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete Label' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Clear Classification' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save Classification' })).not.toBeInTheDocument()
  })

  it('shows only classification actions in accounting mode', () => {
    const detail = makeDetail()
    mockDetail(detail)

    render(<DetailPanel selectedTxid={detail.txid} />)

    expect(screen.getByRole('button', { name: 'Save Classification' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Clear Classification' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete Label' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save Label' })).not.toBeInTheDocument()
  })

  it('save classification button is disabled when no classification is selected in accounting mode', async () => {
    const detail = makeDetail({ classification: null })
    mockDetail(detail)

    render(<DetailPanel selectedTxid={detail.txid} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('tab', { name: 'Accounting' }))

    const saveBtn = screen.getByRole('button', { name: 'Save Classification' })
    expect(saveBtn).toBeDisabled()
    expect(invoke).not.toHaveBeenCalled()
  })

  it('syncs graph badge when primary classification selection changes', async () => {
    const detail = makeDetail({ classification: null })
    mockDetail(detail)
    const onGraphClassificationUpdate = vi.fn()
    vi.mocked(invoke).mockResolvedValue(undefined)

    render(
      <DetailPanel
        selectedTxid={detail.txid}
        onGraphClassificationUpdate={onGraphClassificationUpdate}
      />,
    )
    const user = userEvent.setup()

    await user.click(screen.getByRole('tab', { name: 'Accounting' }))
    const txClassificationSelect = screen.getAllByRole('combobox')[0]

    await user.selectOptions(txClassificationSelect, 'expense')

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        'cmd_set_classification',
        expect.objectContaining({
          refType: 'tx',
          refId: detail.txid,
          classification: expect.objectContaining({
            category: 'expense',
          }),
        }),
      )
    })

    await waitFor(() =>
      expect(onGraphClassificationUpdate).toHaveBeenCalledWith({
        txid: detail.txid,
        classificationCategory: 'expense',
        classificationState: 'Complete',
      }),
    )
  })

  it('syncs graph badge when classification is changed back to the original value', async () => {
    const detail = makeDetail()
    mockDetail(detail)
    const onGraphClassificationUpdate = vi.fn()
    vi.mocked(invoke).mockResolvedValue(undefined)

    render(
      <DetailPanel
        selectedTxid={detail.txid}
        onGraphClassificationUpdate={onGraphClassificationUpdate}
      />,
    )
    const user = userEvent.setup()
    const txClassificationSelect = screen.getAllByRole('combobox')[0]

    await user.selectOptions(txClassificationSelect, 'expense')
    await user.selectOptions(txClassificationSelect, 'revenue')

    await waitFor(() => {
      const txClassificationCalls = vi
        .mocked(invoke)
        .mock.calls.filter(
          ([command, payload]) =>
            command === 'cmd_set_classification' &&
            (payload as { refType?: string }).refType === 'tx',
        )

      expect(txClassificationCalls).toHaveLength(2)
      expect(txClassificationCalls[0]?.[1]).toEqual(
        expect.objectContaining({
          refType: 'tx',
          refId: detail.txid,
          classification: expect.objectContaining({ category: 'expense' }),
        }),
      )
      expect(txClassificationCalls[1]?.[1]).toEqual(
        expect.objectContaining({
          refType: 'tx',
          refId: detail.txid,
          classification: expect.objectContaining({ category: 'revenue' }),
        }),
      )
    })

    await waitFor(() => expect(onGraphClassificationUpdate).toHaveBeenCalledTimes(2))
    expect(onGraphClassificationUpdate).toHaveBeenNthCalledWith(1, {
      txid: detail.txid,
      classificationCategory: 'expense',
      classificationState: 'Complete',
    })
    expect(onGraphClassificationUpdate).toHaveBeenNthCalledWith(2, {
      txid: detail.txid,
      classificationCategory: 'revenue',
      classificationState: 'Complete',
    })
  })

  it('saves classification and refreshes detail', async () => {
    const detail = makeDetail({ classification: null })
    const { reload } = mockDetail(detail)
    const onGraphClassificationUpdate = vi.fn()
    vi.mocked(invoke).mockResolvedValue(undefined)

    render(
      <DetailPanel
        selectedTxid={detail.txid}
        onGraphClassificationUpdate={onGraphClassificationUpdate}
      />,
    )
    const user = userEvent.setup()

    await user.click(screen.getByRole('tab', { name: 'Accounting' }))
    const txClassificationSelect = screen.getAllByRole('combobox')[0]

    await user.selectOptions(txClassificationSelect, 'revenue')
    await user.click(screen.getByRole('button', { name: 'Save Classification' }))

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        'cmd_set_classification',
        expect.objectContaining({
          refType: 'tx',
          refId: detail.txid,
          classification: expect.objectContaining({
            category: 'revenue',
          }),
        }),
      )
      expect(invoke).toHaveBeenCalledWith(
        'cmd_set_label',
        expect.objectContaining({
          refType: 'tx',
          refId: detail.txid,
          label: 'Revenue',
        }),
      )
    })

    await waitFor(() =>
      expect(reload).toHaveBeenCalledWith({
        txid: detail.txid,
        throwOnError: true,
      }),
    )

    await waitFor(() =>
      expect(onGraphClassificationUpdate).toHaveBeenCalledWith({
        txid: detail.txid,
        classificationCategory: 'revenue',
        classificationState: 'Complete',
        transactionLabel: 'Revenue',
        labeledOutputsDelta: 0,
        labeledTransactionsDelta: 0,
      }),
    )
  })

  it('pushes the saved simple label into the graph update payload', async () => {
    const detail = makeDetail({ classification: null, label: null })
    mockDetail(detail)
    const onGraphClassificationUpdate = vi.fn()
    vi.mocked(invoke).mockResolvedValue(undefined)

    render(
      <DetailPanel
        selectedTxid={detail.txid}
        onGraphClassificationUpdate={onGraphClassificationUpdate}
      />,
    )
    const user = userEvent.setup()

    const labelTextarea = screen.getByPlaceholderText(
      'Add a note to help identify this transaction...',
    )
    await user.clear(labelTextarea)
    await user.type(labelTextarea, 'client payment')
    await user.click(screen.getByRole('button', { name: 'Save Label' }))

    await waitFor(() =>
      expect(onGraphClassificationUpdate).toHaveBeenCalledWith({
        txid: detail.txid,
        classificationCategory: null,
        classificationState: 'None',
        transactionLabel: 'client payment',
        labeledTransactionsDelta: 1,
      }),
    )
  })

  it('saves a plain text label in simple mode', async () => {
    const detail = makeDetail({ classification: null, label: null })
    const { reload } = mockDetail(detail)
    vi.mocked(invoke).mockResolvedValue(undefined)

    render(<DetailPanel selectedTxid={detail.txid} />)
    const user = userEvent.setup()

    const labelTextarea = screen.getByPlaceholderText(
      'Add a note to help identify this transaction...',
    )
    await user.type(labelTextarea, 'client payment')
    await user.click(screen.getByRole('button', { name: 'Save Label' }))

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        'cmd_set_label',
        expect.objectContaining({
          refType: 'tx',
          refId: detail.txid,
          label: 'client payment',
        }),
      )
    })

    await waitFor(() =>
      expect(reload).toHaveBeenCalledWith({
        txid: detail.txid,
        throwOnError: true,
      }),
    )
  })

  it('clears unsaved classification drafts without clearing output notes', async () => {
    const detail = makeDetail({
      classification: null,
      label: null,
      outputs: baseDetail.outputs.map((output) => ({
        ...output,
        classification: null,
        label: null,
      })),
    })
    const { reload } = mockDetail(detail)
    vi.mocked(invoke).mockResolvedValue(undefined)

    render(<DetailPanel selectedTxid={detail.txid} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('tab', { name: 'Accounting' }))
    await user.click(screen.getByRole('button', { name: 'Show Outputs' }))
    const outputSelect = screen.getAllByRole('combobox')[1] as HTMLSelectElement
    const outputNotesInputs = screen.getAllByPlaceholderText('Output-specific notes...')

    await user.selectOptions(outputSelect, 'expense')
    await user.type(outputNotesInputs[0], 'draft output note')
    await user.click(screen.getByRole('button', { name: 'Clear Classification' }))

    await waitFor(() => expect(outputSelect.value).toBe(''))
    expect(outputNotesInputs[0]).toHaveValue('draft output note')
    expect(invoke).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
  })

  it('clears classifications without deleting labels', async () => {
    const detail = makeDetail()
    const { reload } = mockDetail(detail)
    const onGraphClassificationUpdate = vi.fn()
    vi.mocked(invoke).mockResolvedValue(undefined)

    render(
      <DetailPanel
        selectedTxid={detail.txid}
        onGraphClassificationUpdate={onGraphClassificationUpdate}
      />,
    )
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Show Outputs' }))
    const outputNotesInputs = screen.getAllByPlaceholderText('Output-specific notes...')
    await user.click(screen.getByRole('button', { name: 'Clear Classification' }))

    await waitFor(() => {
      const calls = vi.mocked(invoke).mock.calls
      expect(calls).toEqual(
        expect.arrayContaining([
          [
            'cmd_delete_classification',
            expect.objectContaining({ refType: 'tx', refId: detail.txid }),
          ],
          [
            'cmd_delete_classification',
            expect.objectContaining({ refType: 'output', refId: `${detail.txid}:1` }),
          ],
        ]),
      )
      const deleteLabelCalls = calls.filter(([command]) => command === 'cmd_delete_label')
      expect(deleteLabelCalls).toHaveLength(0)
    })

    await waitFor(() =>
      expect(reload).toHaveBeenCalledWith({
        txid: detail.txid,
        throwOnError: true,
      }),
    )

    expect(screen.getByPlaceholderText('Add a note to help identify this transaction...')).toHaveValue(
      'old tx label',
    )
    expect(outputNotesInputs[1]).toHaveValue('old output note')
    expect(onGraphClassificationUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        txid: detail.txid,
        classificationCategory: null,
        classificationState: 'None',
      }),
    )
  })

  it('deletes only the transaction label without clearing classifications', async () => {
    const detail = makeDetail()
    const { reload } = mockDetail(detail)
    const onGraphClassificationUpdate = vi.fn()
    vi.mocked(invoke).mockResolvedValue(undefined)

    render(
      <DetailPanel
        selectedTxid={detail.txid}
        onGraphClassificationUpdate={onGraphClassificationUpdate}
      />,
    )
    const user = userEvent.setup()

    await user.click(screen.getByRole('tab', { name: 'Simple' }))
    await user.click(screen.getByRole('button', { name: 'Delete Label' }))

    await waitFor(() => {
      const calls = vi.mocked(invoke).mock.calls
      expect(calls).toEqual(
        expect.arrayContaining([
          [
            'cmd_delete_label',
            expect.objectContaining({ refType: 'tx', refId: detail.txid }),
          ],
        ]),
      )

      const deleteClassificationCalls = calls.filter(
        ([command]) => command === 'cmd_delete_classification',
      )
      expect(deleteClassificationCalls).toHaveLength(0)

      const deleteOutputLabelCalls = calls.filter(
        ([command, payload]) =>
          command === 'cmd_delete_label' &&
          (payload as { refType?: string }).refType === 'output',
      )
      expect(deleteOutputLabelCalls).toHaveLength(0)
    })

    await waitFor(() =>
      expect(reload).toHaveBeenCalledWith({
        txid: detail.txid,
        throwOnError: true,
      }),
    )

    await waitFor(() =>
      expect(onGraphClassificationUpdate).toHaveBeenCalledWith({
        txid: detail.txid,
        classificationCategory: 'revenue',
        classificationState: 'Complete',
        transactionLabel: null,
        labeledTransactionsDelta: -1,
      }),
    )
  })

  it('clears output classifications even when transaction classification is missing', async () => {
    const detail = makeDetail({
      classification: null,
      label: null,
    })
    const { reload } = mockDetail(detail)
    vi.mocked(invoke).mockResolvedValue(undefined)

    render(<DetailPanel selectedTxid={detail.txid} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('tab', { name: 'Accounting' }))
    await user.click(screen.getByRole('button', { name: 'Clear Classification' }))

    await waitFor(() => {
      const calls = vi.mocked(invoke).mock.calls
      const txDeleteClassificationCalls = calls.filter(
        ([command, payload]) =>
          command === 'cmd_delete_classification' &&
          (payload as { refType?: string }).refType === 'tx',
      )

      expect(txDeleteClassificationCalls).toHaveLength(0)
      expect(calls).toEqual(
        expect.arrayContaining([
          [
            'cmd_delete_classification',
            expect.objectContaining({ refType: 'output', refId: `${detail.txid}:1` }),
          ],
        ]),
      )
      const deleteLabelCalls = calls.filter(([command]) => command === 'cmd_delete_label')
      expect(deleteLabelCalls).toHaveLength(0)
    })

    await waitFor(() =>
      expect(reload).toHaveBeenCalledWith({
        txid: detail.txid,
        throwOnError: true,
      }),
    )
  })

  it('triggers deselect callback on Escape', async () => {
    const detail = makeDetail()
    mockDetail(detail)
    const onDeselect = vi.fn()

    render(<DetailPanel selectedTxid={detail.txid} onDeselect={onDeselect} />)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))

    await waitFor(() => expect(onDeselect).toHaveBeenCalledTimes(1))
  })
})
