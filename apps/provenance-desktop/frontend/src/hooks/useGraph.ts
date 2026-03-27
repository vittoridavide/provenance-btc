import { invoke } from '@tauri-apps/api/core'
import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  GraphInputBuildResponse,
  GraphInputResolution,
  ProvenanceGraph,
} from '../types/api'

const DEFAULT_DEPTH = 3

type UseGraphParams = {
  input: string
  depth?: number
  selectedRootTxid?: string | null
  reloadKey?: number
}
type GraphReloadRequest = {
  input?: string
  depth?: number
  selectedRootTxid?: string | null
  throwOnError?: boolean
}

type UseGraphResult = {
  graph: ProvenanceGraph | null
  resolution: GraphInputResolution | null
  loading: boolean
  error: string | null
  reload: (request?: GraphReloadRequest) => Promise<void>
  updateGraph: (
    updater: (currentGraph: ProvenanceGraph | null) => ProvenanceGraph | null,
  ) => void
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
  input,
  depth = DEFAULT_DEPTH,
  selectedRootTxid = null,
  reloadKey = 0,
}: UseGraphParams): UseGraphResult {
  const [graph, setGraph] = useState<ProvenanceGraph | null>(null)
  const [resolution, setResolution] = useState<GraphInputResolution | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestIdRef = useRef(0)
  const trimmedInput = input.trim()

  const reload = useCallback(async (request?: GraphReloadRequest) => {
    void reloadKey
    const nextInput = (request?.input ?? trimmedInput).trim()
    const nextDepth = request?.depth ?? depth
    const nextSelectedRootTxid = (request?.selectedRootTxid ?? selectedRootTxid)?.trim() ?? null

    if (!nextInput) {
      requestIdRef.current += 1
      setLoading(false)
      setError(null)
      setGraph(null)
      setResolution(null)
      return
    }

    const requestId = ++requestIdRef.current
    setLoading(true)
    setError(null)

    try {
      console.info('[provenance-ui] cmd_build_graph_from_input:start', {
        input: nextInput,
        depth: nextDepth,
        selectedRootTxid: nextSelectedRootTxid,
      })
      const response = await invoke<GraphInputBuildResponse>('cmd_build_graph_from_input', {
        args: {
          input: nextInput,
          depth: nextDepth,
          selectedRootTxid: nextSelectedRootTxid,
        },
      })

      if (requestId !== requestIdRef.current) {
        return
      }
      console.info('[provenance-ui] cmd_build_graph_from_input:success', {
        input: nextInput,
        depth: nextDepth,
        requiresSelection: response.resolution.requires_selection,
      })

      setResolution(response.resolution)
      setGraph(response.graph ?? null)
    } catch (invokeError) {
      if (requestId !== requestIdRef.current) {
        return
      }
      const errorMessage = toErrorMessage(invokeError)
      console.error(
        `[provenance-ui] cmd_build_graph_from_input:error input=${nextInput} depth=${nextDepth} selectedRootTxid=${nextSelectedRootTxid} error=${errorMessage}`,
      )
      console.error('[provenance-ui] cmd_build_graph_from_input:error', {
        input: nextInput,
        depth: nextDepth,
        selectedRootTxid: nextSelectedRootTxid,
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
  }, [depth, reloadKey, selectedRootTxid, trimmedInput])

  const updateGraph = useCallback(
    (updater: (currentGraph: ProvenanceGraph | null) => ProvenanceGraph | null) => {
      setGraph((currentGraph) => updater(currentGraph))
    },
    [],
  )

  useEffect(() => {
    void reload()

    return () => {
      requestIdRef.current += 1
    }
  }, [reload])

  return { graph, resolution, loading, error, reload, updateGraph }
}
