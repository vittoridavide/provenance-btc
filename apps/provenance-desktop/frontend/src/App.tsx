import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import './App.css'
import DetailPanel from './components/DetailPanel'
import GraphCanvas, { type GraphCanvasTopBarActions } from './components/GraphCanvas'
import ImportExportCenter from './components/import-export/ImportExportCenter'
import RpcConnectionModal, { type RpcAuthMode } from './components/RpcConnectionModal'
import Sidebar from './components/Sidebar'
import TopBar from './components/TopBar'
import type {
  Bip329ExportResult,
  Bip329ImportApplyResult,
  Bip329ImportConflictPolicy,
  Bip329ImportPreviewResponse,
  ProvenanceGraph,
  ReportExportRequest,
  ReportFileExportResult,
  ReportPreviewRequest,
  ReportPreviewResponse,
} from './types/api'
const DEFAULT_ROOT_TXID = import.meta.env.VITE_PROVENANCE_GRAPH_ROOT_TXID ?? ''
const COMPACT_LAYOUT_MAX_WIDTH = 1400
const SIDEBAR_COLLAPSE_MAX_WIDTH = 1200
const DETAIL_COLLAPSE_MAX_WIDTH = 1024

type WorkspacePreset = {
  key: 'wide' | 'compact' | 'narrow' | 'tight'
  compact: boolean
  defaultSidebarCollapsed: boolean
  defaultDetailCollapsed: boolean
}

function parseRpcUrl(value: string): URL | null {
  const candidate = value.trim()
  if (!candidate) return null

  try {
    return new URL(candidate)
  } catch {
    try {
      return new URL(`http://${candidate}`)
    } catch {
      return null
    }
  }
}

function isLoopbackIpv4(hostname: string): boolean {
  const octets = hostname.split('.')
  if (octets.length !== 4) return false

  const parsed = octets.map((part) => Number.parseInt(part, 10))
  if (parsed.some((part) => Number.isNaN(part) || part < 0 || part > 255)) return false

  return parsed[0] === 127
}

function isLocalOrLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase().replace(/\.$/, '')
  if (!normalized) return false

  if (normalized === 'localhost' || normalized === '::1' || normalized === '[::1]') {
    return true
  }

  if (normalized === '0.0.0.0') {
    return true
  }

  return isLoopbackIpv4(normalized)
}

function requiresPublicEndpointAcknowledgement(url: string, authMode: RpcAuthMode): boolean {
  if (authMode !== 'none') return false

  const parsedUrl = parseRpcUrl(url)
  if (!parsedUrl) return false

  return !isLocalOrLoopbackHostname(parsedUrl.hostname)
}
type RpcConfigPrefill = {
  schemaVersion: number
  url: string
  authMode: RpcAuthMode
  username: string | null
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

function formatFileTimestamp(date = new Date()): string {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  const hours = `${date.getHours()}`.padStart(2, '0')
  const minutes = `${date.getMinutes()}`.padStart(2, '0')
  const seconds = `${date.getSeconds()}`.padStart(2, '0')
  return `${year}${month}${day}-${hours}${minutes}${seconds}`
}

function downloadTextFile(fileName: string, contents: string, mimeType: string): void {
  if (typeof document === 'undefined') {
    return
  }

  const fileBlob = new Blob([contents], { type: mimeType })
  const objectUrl = URL.createObjectURL(fileBlob)
  const downloadLink = document.createElement('a')
  downloadLink.href = objectUrl
  downloadLink.download = fileName
  document.body.appendChild(downloadLink)
  downloadLink.click()
  document.body.removeChild(downloadLink)
  URL.revokeObjectURL(objectUrl)
}

function getViewportWidth(): number {
  if (typeof window === 'undefined') {
    return 1600
  }

  return window.innerWidth
}

function resolveWorkspacePreset(viewportWidth: number): WorkspacePreset {
  if (viewportWidth <= DETAIL_COLLAPSE_MAX_WIDTH) {
    return {
      key: 'tight',
      compact: true,
      defaultSidebarCollapsed: true,
      defaultDetailCollapsed: true,
    }
  }

  if (viewportWidth <= SIDEBAR_COLLAPSE_MAX_WIDTH) {
    return {
      key: 'narrow',
      compact: true,
      defaultSidebarCollapsed: true,
      defaultDetailCollapsed: false,
    }
  }

  if (viewportWidth <= COMPACT_LAYOUT_MAX_WIDTH) {
    return {
      key: 'compact',
      compact: true,
      defaultSidebarCollapsed: false,
      defaultDetailCollapsed: false,
    }
  }

  return {
    key: 'wide',
    compact: false,
    defaultSidebarCollapsed: false,
    defaultDetailCollapsed: false,
  }
}

function App() {
  const [workspacePreset, setWorkspacePreset] = useState<WorkspacePreset>(() =>
    resolveWorkspacePreset(getViewportWidth()),
  )
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    workspacePreset.defaultSidebarCollapsed,
  )
  const [detailCollapsed, setDetailCollapsed] = useState(workspacePreset.defaultDetailCollapsed)
  const [rootTxid, setRootTxid] = useState(DEFAULT_ROOT_TXID)
  const [graphReloadKey, setGraphReloadKey] = useState(0)
  const [selectedTxid, setSelectedTxid] = useState<string | null>(null)
  const [graphData, setGraphData] = useState<ProvenanceGraph | null>(null)
  const [isImportExportOpen, setIsImportExportOpen] = useState(false)
  const graphViewActionsRef = useRef<GraphCanvasTopBarActions | null>(null)
  const graphRefreshRef = useRef<(() => Promise<void>) | null>(null)
  const detailRefreshRef = useRef<(() => Promise<void>) | null>(null)
  const [isRpcConfigured, setIsRpcConfigured] = useState(false)
  const [isRpcModalOpen, setIsRpcModalOpen] = useState(true)
  const [rpcUrl, setRpcUrl] = useState('')
  const [rpcAuthMode, setRpcAuthMode] = useState<RpcAuthMode>('none')
  const [rpcUsername, setRpcUsername] = useState('')
  const [rpcPassword, setRpcPassword] = useState('')
  const [publicEndpointAcknowledged, setPublicEndpointAcknowledged] = useState(false)
  const [isRpcConnecting, setIsRpcConnecting] = useState(false)
  const [rpcConnectionError, setRpcConnectionError] = useState<string | null>(null)
  const [rpcConnectionSuccess, setRpcConnectionSuccess] = useState<string | null>(null)

  useEffect(() => {
    function handleResize() {
      setWorkspacePreset((currentPreset) => {
        const nextPreset = resolveWorkspacePreset(getViewportWidth())
        if (nextPreset.key === currentPreset.key) return currentPreset
        setSidebarCollapsed((current) => current || nextPreset.defaultSidebarCollapsed)
        setDetailCollapsed((current) => current || nextPreset.defaultDetailCollapsed)
        return nextPreset
      })
    }

    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('resize', handleResize)
    }
  }, [])

  useEffect(() => {
    let isSubscribed = true

    async function loadRpcConfigPrefill() {
      try {
        const prefill = await invoke<RpcConfigPrefill>('cmd_get_rpc_config_prefill')
        if (!isSubscribed) return
        setRpcUrl(prefill.url ?? '')
        setRpcAuthMode(prefill.authMode === 'userpass' ? 'userpass' : 'none')
        setRpcUsername(prefill.username ?? '')
        setRpcPassword('')
        setPublicEndpointAcknowledged(false)
      } catch (error) {
        if (!isSubscribed) return
        setRpcConnectionError(`Failed to load saved RPC configuration: ${toErrorMessage(error)}`)
      }
    }

    void loadRpcConfigPrefill()
    return () => {
      isSubscribed = false
    }
  }, [])

  const handleSearchTxid = useCallback((nextRootTxid: string) => {
    if (!isRpcConfigured) {
      setIsRpcModalOpen(true)
      return
    }

    setRootTxid(nextRootTxid)
    setSelectedTxid(null)
    setGraphReloadKey((current) => current + 1)
  }, [isRpcConfigured])
  const handleSelectTxid = useCallback((nextSelectedTxid: string | null) => {
    setSelectedTxid(nextSelectedTxid)

    if (nextSelectedTxid && nextSelectedTxid.trim().length > 0) {
      setDetailCollapsed(false)
    }
  }, [])

  const workspaceClassName = useMemo(() => {
    const classNames = ['workspace-row']

    if (workspacePreset.compact) {
      classNames.push('workspace-row--compact')
    }

    if (!selectedTxid) {
      classNames.push('workspace-row--no-detail')
    } else if (detailCollapsed) {
      classNames.push('workspace-row--detail-collapsed')
    }

    return classNames.join(' ')
  }, [detailCollapsed, selectedTxid, workspacePreset.compact])

  const handleToggleSidebar = useCallback(() => {
    setSidebarCollapsed((current) => !current)
  }, [])
  const handleToggleDetail = useCallback(() => {
    setDetailCollapsed((current) => !current)
  }, [])
  const handleGraphDataChange = useCallback((nextGraphData: ProvenanceGraph | null) => {
    setGraphData(nextGraphData)
  }, [])
  const handleRegisterViewActions = useCallback((actions: GraphCanvasTopBarActions | null) => {
    graphViewActionsRef.current = actions
  }, [])
  const handleRegisterGraphRefresh = useCallback((refresh: (() => Promise<void>) | null) => {
    graphRefreshRef.current = refresh
  }, [])
  const handleRegisterDetailRefresh = useCallback((refresh: (() => Promise<void>) | null) => {
    detailRefreshRef.current = refresh
  }, [])
  const handleGraphRefresh = useCallback(async () => {
    if (graphRefreshRef.current) {
      await graphRefreshRef.current()
      return
    }

    setGraphReloadKey((current) => current + 1)
  }, [])
  const handleWorkspaceRefresh = useCallback(async () => {
    await handleGraphRefresh()
    if (detailRefreshRef.current) {
      await detailRefreshRef.current()
    }
  }, [handleGraphRefresh])
  const handleRpcConnect = useCallback(async () => {
    const normalizedUrl = rpcUrl.trim()
    if (!normalizedUrl) {
      setRpcConnectionError('RPC URL is required.')
      return
    }
    if (
      requiresPublicEndpointAcknowledgement(normalizedUrl, rpcAuthMode) &&
      !publicEndpointAcknowledged
    ) {
      setRpcConnectionError(
        'Acknowledge the privacy warning before connecting to a non-local unauthenticated RPC endpoint.',
      )
      return
    }

    setIsRpcConnecting(true)
    setRpcConnectionError(null)
    setRpcConnectionSuccess(null)

    try {
      await invoke('cmd_set_rpc_config', {
        args: {
          url: normalizedUrl,
          authMode: rpcAuthMode,
          username: rpcAuthMode === 'userpass' ? rpcUsername.trim() : null,
          password: rpcAuthMode === 'userpass' ? rpcPassword : null,
        },
      })

      setIsRpcConfigured(true)
      setIsImportExportOpen(false)
      setSelectedTxid(null)
      setGraphData(null)
      setRpcConnectionSuccess('Connected successfully.')
      setIsRpcModalOpen(false)
      try {
        await handleWorkspaceRefresh()
      } catch {
        // Intentionally ignore refresh failures here: RPC connection already succeeded.
      }
    } catch (error) {
      setRpcConnectionError(toErrorMessage(error))
    } finally {
      setIsRpcConnecting(false)
    }
  }, [
    handleWorkspaceRefresh,
    publicEndpointAcknowledged,
    rpcAuthMode,
    rpcPassword,
    rpcUrl,
    rpcUsername,
  ])
  const handleExportGraphJson = useCallback(async () => {
    if (!graphData || graphData.nodes.length === 0) {
      return
    }

    try {
      const graphJson = await invoke<string>('cmd_export_graph_json', {
        graph: graphData,
      })
      const exportTxid = rootTxid.trim() || 'graph'
      const fileName = `provenance-graph-${exportTxid}-${formatFileTimestamp()}.json`
      downloadTextFile(fileName, graphJson, 'application/json')
    } catch {
      // Intentionally ignore export failures to keep graph workflow non-blocking.
    }
  }, [graphData, rootTxid])
  const handlePreviewLabelExport = useCallback(async () => {
    return await invoke<Bip329ExportResult>('cmd_preview_labels_export')
  }, [])
  const handleExportLabels = useCallback(async (outputPath: string) => {
    const savedPath = await invoke<string>('cmd_export_labels', {
      args: {
        outputPath,
      },
    })
    return savedPath
  }, [])
  const handlePreviewLabelImport = useCallback(async (inputPath: string) => {
    return await invoke<Bip329ImportPreviewResponse>('cmd_preview_labels_import', {
      args: { inputPath },
    })
  }, [])
  const handleApplyLabelImport = useCallback(
    async (inputPath: string, policy: Bip329ImportConflictPolicy) => {
      const result = await invoke<Bip329ImportApplyResult>('cmd_apply_labels_import', {
        args: { inputPath, policy },
      })
      await handleWorkspaceRefresh()
      return result
    },
    [handleWorkspaceRefresh],
  )
  const handlePreviewReport = useCallback(async (request: ReportPreviewRequest) => {
    return await invoke<ReportPreviewResponse>('cmd_preview_report', {
      args: request,
    })
  }, [])
  const handleExportReport = useCallback(
    async (request: ReportExportRequest, outputPath: string) => {
      return await invoke<ReportFileExportResult>('cmd_export_report', {
        args: {
          request,
          outputPath,
        },
      })
    },
    [],
  )
  return (
    <div className="app-shell">
      <TopBar
        rootTxid={rootTxid}
        onSearchTxid={handleSearchTxid}
        onExportGraphJson={handleExportGraphJson}
        onOpenImportExport={() => {
          if (!isRpcConfigured) {
            setIsRpcModalOpen(true)
            return
          }
          setIsImportExportOpen(true)
        }}
        onOpenRpcSettings={() => setIsRpcModalOpen(true)}
      />
      <div className="content-row">
        <Sidebar collapsed={sidebarCollapsed} selectedTxid={selectedTxid} onToggle={handleToggleSidebar} />
        <div className="main-area">
          <div className="workspace-scroll">
            {isRpcConfigured ? (
              <div className={workspaceClassName}>
                <GraphCanvas
                  rootTxid={rootTxid}
                  reloadKey={graphReloadKey}
                  selectedTxid={selectedTxid}
                  onSelectTxid={handleSelectTxid}
                  onGraphDataChange={handleGraphDataChange}
                  onRegisterViewActions={handleRegisterViewActions}
                  onRegisterRefresh={handleRegisterGraphRefresh}
                />
                <DetailPanel
                  selectedTxid={selectedTxid}
                  collapsed={detailCollapsed}
                  onGraphRefresh={handleGraphRefresh}
                  onRegisterRefresh={handleRegisterDetailRefresh}
                  onDeselect={() => setSelectedTxid(null)}
                  onToggle={handleToggleDetail}
                />
              </div>
            ) : null}
          </div>
        </div>
      </div>
      <ImportExportCenter
        isOpen={isImportExportOpen && isRpcConfigured}
        onClose={() => setIsImportExportOpen(false)}
        rootTxid={rootTxid}
        onPreviewReport={handlePreviewReport}
        onExportReport={handleExportReport}
        onPreviewLabelImport={handlePreviewLabelImport}
        onApplyLabelImport={handleApplyLabelImport}
        onPreviewLabelExport={handlePreviewLabelExport}
        onExportLabels={handleExportLabels}
      />
      <RpcConnectionModal
        isOpen={isRpcModalOpen}
        url={rpcUrl}
        authMode={rpcAuthMode}
        username={rpcUsername}
        password={rpcPassword}
        publicEndpointAcknowledged={publicEndpointAcknowledged}
        isConnecting={isRpcConnecting}
        errorMessage={rpcConnectionError}
        successMessage={rpcConnectionSuccess}
        onUrlChange={(value) => {
          setRpcUrl(value)
          setPublicEndpointAcknowledged(false)
          setRpcConnectionError(null)
          setRpcConnectionSuccess(null)
        }}
        onAuthModeChange={(value) => {
          setRpcAuthMode(value)
          if (value === 'none') {
            setRpcPassword('')
          }
          setPublicEndpointAcknowledged(false)
          setRpcConnectionError(null)
          setRpcConnectionSuccess(null)
        }}
        onUsernameChange={(value) => {
          setRpcUsername(value)
          setRpcConnectionError(null)
          setRpcConnectionSuccess(null)
        }}
        onPasswordChange={(value) => {
          setRpcPassword(value)
          setRpcConnectionError(null)
          setRpcConnectionSuccess(null)
        }}
        onPublicEndpointAcknowledgedChange={setPublicEndpointAcknowledged}
        onConnect={handleRpcConnect}
        onClose={() => {
          if (!isRpcConfigured) {
            setRpcConnectionError('RPC connection is required before continuing.')
            return
          }
          setIsRpcModalOpen(false)
        }}
      />
    </div>
  )
}

export default App
