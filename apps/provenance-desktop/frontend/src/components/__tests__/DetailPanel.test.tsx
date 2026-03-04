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
      script_type: null,
      address: null,
      label: null,
      classification: null,
    },
    {
      vout: 1,
      value_sat: 350_000,
      script_pubkey_hex: '',
      script_type: null,
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
    expect(screen.getByRole('button', { name: 'Save Classification' })).toBeInTheDocument()
  })

  it('validates that classification is required on save', async () => {
    const detail = makeDetail({ classification: null })
    mockDetail(detail)

    render(<DetailPanel selectedTxid={detail.txid} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Save Classification' }))

    expect(screen.getAllByText('Please select a classification').length).toBeGreaterThan(0)
    expect(invoke).not.toHaveBeenCalled()
  })

  it('syncs graph badge when primary classification selection changes', async () => {
    const detail = makeDetail({ classification: null })
    mockDetail(detail)
    const onGraphRefresh = vi.fn().mockResolvedValue(undefined)
    vi.mocked(invoke).mockResolvedValue(undefined)

    render(<DetailPanel selectedTxid={detail.txid} onGraphRefresh={onGraphRefresh} />)
    const user = userEvent.setup()
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

    await waitFor(() => expect(onGraphRefresh).toHaveBeenCalledTimes(1))
  })

  it('saves classification and refreshes detail', async () => {
    const detail = makeDetail({ classification: null })
    const { reload } = mockDetail(detail)
    vi.mocked(invoke).mockResolvedValue(undefined)

    render(<DetailPanel selectedTxid={detail.txid} />)
    const user = userEvent.setup()
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
    })

    await waitFor(() =>
      expect(reload).toHaveBeenCalledWith({
        txid: detail.txid,
        throwOnError: true,
      }),
    )
  })

  it('clears tx and output labels/classifications when confirmed', async () => {
    const detail = makeDetail()
    const { reload } = mockDetail(detail)
    vi.mocked(invoke).mockResolvedValue(undefined)
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(<DetailPanel selectedTxid={detail.txid} />)
    const user = userEvent.setup()

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
            'cmd_delete_label',
            expect.objectContaining({ refType: 'tx', refId: detail.txid }),
          ],
          [
            'cmd_delete_classification',
            expect.objectContaining({ refType: 'output', refId: `${detail.txid}:1` }),
          ],
          [
            'cmd_delete_label',
            expect.objectContaining({ refType: 'output', refId: `${detail.txid}:1` }),
          ],
        ]),
      )
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
