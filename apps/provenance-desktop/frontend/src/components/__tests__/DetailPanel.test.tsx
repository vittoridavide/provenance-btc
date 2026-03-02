import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { invoke } from '@tauri-apps/api/core'
import { vi } from 'vitest'
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
  confirmations: 1,
  blockhash: null,
  block_height: null,
  block_time: null,
  inputs: [],
  outputs: [],
  label: 'Existing label',
  classification: {
    category: '',
    context: '',
    metadata: {},
    tax_relevant: false,
  },
}

function makeDetail(overrides: Partial<TransactionDetail> = {}): TransactionDetail {
  return {
    ...baseDetail,
    classification: baseDetail.classification ? { ...baseDetail.classification } : null,
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

describe('DetailPanel', () => {
  it('shows the unclassified warning when classification is missing', () => {
    const detail = makeDetail({ classification: null })
    mockDetail(detail)

    render(<DetailPanel selectedTxid={detail.txid} />)

    expect(screen.getByText('Unclassified Transaction')).toBeInTheDocument()
  })

  it('hides the unclassified warning when classification exists', () => {
    const detail = makeDetail({
      classification: {
        category: 'revenue',
        context: '',
        metadata: {},
        tax_relevant: false,
      },
    })
    mockDetail(detail)

    render(<DetailPanel selectedTxid={detail.txid} />)

    expect(screen.queryByText('Unclassified Transaction')).not.toBeInTheDocument()
  })

  it('validates metadata JSON syntax before saving classification', async () => {
    const detail = makeDetail({ classification: null })
    mockDetail(detail)
    vi.mocked(invoke).mockResolvedValue(undefined)

    render(<DetailPanel selectedTxid={detail.txid} />)
    const user = userEvent.setup()

    await user.selectOptions(
      screen.getByLabelText('Primary Classification'),
      'revenue',
    )
    const metadataField = screen.getByPlaceholderText('{"invoice": "INV-1001"}')
    await user.clear(metadataField)
    await user.type(metadataField, '{invalid')
    await user.click(
      screen.getByRole('button', { name: 'Save Classification' }),
    )

    expect(
      await screen.findByText(/Metadata is not valid JSON/i),
    ).toBeInTheDocument()
    expect(invoke).not.toHaveBeenCalled()
  })

  it('requires metadata to be a JSON object', async () => {
    const detail = makeDetail({ classification: null })
    mockDetail(detail)
    vi.mocked(invoke).mockResolvedValue(undefined)

    render(<DetailPanel selectedTxid={detail.txid} />)
    const user = userEvent.setup()

    await user.selectOptions(
      screen.getByLabelText('Primary Classification'),
      'expense',
    )
    const metadataField = screen.getByPlaceholderText('{"invoice": "INV-1001"}')
    await user.clear(metadataField)
    await user.type(metadataField, '[]')
    await user.click(
      screen.getByRole('button', { name: 'Save Classification' }),
    )

    expect(
      await screen.findByText('Metadata must be a JSON object.'),
    ).toBeInTheDocument()
    expect(invoke).not.toHaveBeenCalled()
  })

  it('saves labels and refreshes after update', async () => {
    const detail = makeDetail({ label: 'Old label' })
    const { reload } = mockDetail(detail)
    const onGraphRefresh = vi.fn().mockResolvedValue(undefined)
    vi.mocked(invoke).mockResolvedValue(undefined)

    render(
      <DetailPanel
        selectedTxid={detail.txid}
        onGraphRefresh={onGraphRefresh}
      />,
    )
    const user = userEvent.setup()
    const labelInput = screen.getByLabelText('BIP-329 Label')

    await user.clear(labelInput)
    await user.type(labelInput, 'New label')
    await user.click(screen.getByRole('button', { name: 'Save Label' }))

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('cmd_set_label', {
        refType: 'tx',
        refId: detail.txid,
        label: 'New label',
      })
    })
    await waitFor(() =>
      expect(reload).toHaveBeenCalledWith({
        txid: detail.txid,
        throwOnError: true,
      }),
    )
    await waitFor(() => expect(onGraphRefresh).toHaveBeenCalled())
  })

  it('deletes labels and refreshes after update', async () => {
    const detail = makeDetail({ label: 'Old label' })
    const { reload } = mockDetail(detail)
    vi.mocked(invoke).mockResolvedValue(undefined)

    render(<DetailPanel selectedTxid={detail.txid} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Delete Label' }))

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('cmd_delete_label', {
        refType: 'tx',
        refId: detail.txid,
      })
    })
    await waitFor(() =>
      expect(reload).toHaveBeenCalledWith({
        txid: detail.txid,
        throwOnError: true,
      }),
    )
  })
})
