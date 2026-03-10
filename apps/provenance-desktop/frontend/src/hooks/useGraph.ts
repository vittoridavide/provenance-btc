import { invoke } from '@tauri-apps/api/core'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GraphBuildOptions, ProvenanceGraph } from '../types/api'

const DEFAULT_DEPTH = 10
const DEFAULT_OPTIONS: GraphBuildOptions = {}

type UseGraphParams = {
  rootTxid: string
  depth?: number
  options?: GraphBuildOptions
  reloadKey?: number
}
type GraphReloadRequest = {
  rootTxid?: string
  depth?: number
  options?: GraphBuildOptions
  throwOnError?: boolean
}

type UseGraphResult = {
  graph: ProvenanceGraph | null
  loading: boolean
  error: string | null
  reload: (request?: GraphReloadRequest) => Promise<void>
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

export function useGraph({
  rootTxid,
  depth = DEFAULT_DEPTH,
  options,
  reloadKey = 0,
}: UseGraphParams): UseGraphResult {
  const [graph, setGraph] = useState<ProvenanceGraph | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestIdRef = useRef(0)
  const resolvedOptions = options ?? DEFAULT_OPTIONS
  const trimmedRootTxid = rootTxid.trim()

  const optionsKey = useMemo(() => {
    try {
      return JSON.stringify(resolvedOptions)
    } catch {
      return '{}'
    }
  }, [resolvedOptions])

  const reload = useCallback(async (request?: GraphReloadRequest) => {
    void reloadKey
    const nextRootTxid = (request?.rootTxid ?? trimmedRootTxid).trim()
    const nextDepth = request?.depth ?? depth
    const nextOptionsKey = (() => {
      if (!request?.options) {
        return optionsKey
      }

      try {
        return JSON.stringify(request.options)
      } catch {
        return '{}'
      }
    })()

    if (!nextRootTxid) {
      requestIdRef.current += 1
      setLoading(false)
      setError(null)
      setGraph(null)
      return
    }

    const requestId = ++requestIdRef.current
    setLoading(true)
    setError(null)

    try {
      const parsedOptions = JSON.parse(nextOptionsKey) as GraphBuildOptions
      console.info('[provenance-ui] cmd_build_graph:start', {
        rootTxid: nextRootTxid,
        depth: nextDepth,
        options: parsedOptions,
      })
      const graphPayload = await invoke<ProvenanceGraph>('cmd_build_graph', {
        rootTxid: nextRootTxid,
        depth: nextDepth,
        options: parsedOptions,
        _options: parsedOptions,
      })

      if (requestId !== requestIdRef.current) {
        return
      }
      console.info('[provenance-ui] cmd_build_graph:success', {
        rootTxid: nextRootTxid,
        depth: nextDepth,
      })

      setGraph(graphPayload)
    } catch (invokeError) {
      if (requestId !== requestIdRef.current) {
        return
      }
      const errorMessage = toErrorMessage(invokeError)
      console.error(
        `[provenance-ui] cmd_build_graph:error rootTxid=${nextRootTxid} depth=${nextDepth} error=${errorMessage}`,
      )
      console.error('[provenance-ui] cmd_build_graph:error', {
        rootTxid: nextRootTxid,
        depth: nextDepth,
        error: errorMessage,
      })
      setError(errorMessage)
      if (request?.throwOnError) {
        throw invokeError
      }
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false)
      }
    }
  }, [depth, optionsKey, reloadKey, trimmedRootTxid])

  useEffect(() => {
    void reload()

    return () => {
      requestIdRef.current += 1
    }
  }, [reload])

  return { graph, loading, error, reload }
}
