import { invoke } from '@tauri-apps/api/core'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { GraphInputCapabilities } from '../types/api'

type UseGraphInputCapabilitiesParams = {
  enabled: boolean
  reloadKey?: number
}

type UseGraphInputCapabilitiesResult = {
  capabilities: GraphInputCapabilities
  loading: boolean
  error: string | null
}

const DEFAULT_CAPABILITIES_UNCONFIGURED: GraphInputCapabilities = {
  supported_input_kinds: ['txid', 'outpoint', 'address'],
  address_unavailable_reason: null,
}

const SAFE_FALLBACK_CAPABILITIES: GraphInputCapabilities = {
  supported_input_kinds: ['txid', 'outpoint'],
  address_unavailable_reason: 'unable to verify RPC scantxoutset capability',
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

export function useGraphInputCapabilities({
  enabled,
  reloadKey = 0,
}: UseGraphInputCapabilitiesParams): UseGraphInputCapabilitiesResult {
  const [capabilities, setCapabilities] = useState<GraphInputCapabilities>(
    DEFAULT_CAPABILITIES_UNCONFIGURED,
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestIdRef = useRef(0)

  const reload = useCallback(async () => {
    if (!enabled) {
      requestIdRef.current += 1
      setCapabilities(DEFAULT_CAPABILITIES_UNCONFIGURED)
      setLoading(false)
      setError(null)
      return
    }

    const requestId = ++requestIdRef.current
    setCapabilities(SAFE_FALLBACK_CAPABILITIES)
    setLoading(true)
    setError(null)

    try {
      const response = await invoke<GraphInputCapabilities>('cmd_get_graph_input_capabilities')
      if (requestId !== requestIdRef.current) {
        return
      }
      setCapabilities(response)
      setError(null)
    } catch (invokeError) {
      if (requestId !== requestIdRef.current) {
        return
      }
      const errorMessage = toErrorMessage(invokeError)
      setError(errorMessage)
      setCapabilities({
        ...SAFE_FALLBACK_CAPABILITIES,
        address_unavailable_reason: `${SAFE_FALLBACK_CAPABILITIES.address_unavailable_reason}: ${errorMessage}`,
      })
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false)
      }
    }
  }, [enabled])

  useEffect(() => {
    void reload()

    return () => {
      requestIdRef.current += 1
    }
  }, [reload, reloadKey])

  return { capabilities, loading, error }
}
