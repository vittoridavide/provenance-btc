import { invoke } from '@tauri-apps/api/core'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { TransactionDetail } from '../types/api'

type UseTransactionDetailResult = {
  detail: TransactionDetail | null
  loading: boolean
  error: string | null
  reload: (request?: TransactionDetailReloadRequest) => Promise<void>
}
type TransactionDetailReloadRequest = {
  txid?: string
  throwOnError?: boolean
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error

  try {
    return JSON.stringify(error)
  } catch {
    return 'Unknown error'
  }
}

export function useTransactionDetail(
  txid: string | null | undefined,
): UseTransactionDetailResult {
  const [detail, setDetail] = useState<TransactionDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestIdRef = useRef(0)
  const normalizedTxid = (txid ?? '').trim()

  const reload = useCallback(async (request?: TransactionDetailReloadRequest) => {
    const nextTxid = (request?.txid ?? normalizedTxid).trim()

    if (!nextTxid) {
      requestIdRef.current += 1
      setLoading(false)
      setError(null)
      setDetail(null)
      return
    }

    const requestId = ++requestIdRef.current
    setLoading(true)
    setError(null)
    setDetail(null)

    try {
      console.info('[provenance-ui] cmd_get_tx_detail:start', {
        txid: nextTxid,
      })
      const txDetail = await invoke<TransactionDetail>('cmd_get_tx_detail', {
        txid: nextTxid,
      })

      if (requestId !== requestIdRef.current) {
        return
      }
      console.info('[provenance-ui] cmd_get_tx_detail:success', {
        txid: nextTxid,
      })

      setDetail(txDetail)
    } catch (invokeError) {
      if (requestId !== requestIdRef.current) {
        return
      }
      const errorMessage = toErrorMessage(invokeError)
      console.error(
        `[provenance-ui] cmd_get_tx_detail:error txid=${nextTxid} error=${errorMessage}`,
      )
      console.error('[provenance-ui] cmd_get_tx_detail:error', {
        txid: nextTxid,
        error: errorMessage,
      })

      setDetail(null)
      setError(errorMessage)
      if (request?.throwOnError) {
        throw invokeError
      }
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false)
      }
    }
  }, [normalizedTxid])

  useEffect(() => {
    void reload()

    return () => {
      requestIdRef.current += 1
    }
  }, [reload])

  return { detail, loading, error, reload }
}
