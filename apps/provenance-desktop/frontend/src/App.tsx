import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import './App.css'
import DetailPanel from './components/DetailPanel'
import DataManagementSidebar from './components/DataManagementSidebar'
import GraphCanvas, {
  type GraphCanvasTopBarActions,
  type GraphClassificationUpdate,
} from './components/GraphCanvas'
import RootCandidatePicker from './components/RootCandidatePicker'
import RpcConnectionModal, { type RpcAuthMode } from './components/RpcConnectionModal'
import Sidebar from './components/Sidebar'
import TopBar from './components/TopBar'
import { useGraphInputCapabilities } from './hooks/useGraphInputCapabilities'
import type {
  Bip329ImportApplyResult,
  Bip329ImportConflictPolicy,
  GraphInputCandidateRoot,
  GraphInputResolution,
  GraphSummary,
  ProvenanceGraph,
  ReportExportRequest,
  ReportFileExportResult,
} from './types/api'
const DEFAULT_SEARCH_INPUT = import.meta.env.VITE_PROVENANCE_GRAPH_ROOT_TXID ?? ''
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
      defaultSidebarCollapsed: false,
      defaultDetailCollapsed: true,
    }
  }

  if (viewportWidth <= SIDEBAR_COLLAPSE_MAX_WIDTH) {
    return {
      key: 'narrow',
      compact: true,
      defaultSidebarCollapsed: false,
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
  const [submittedSearchInput, setSubmittedSearchInput] = useState(DEFAULT_SEARCH_INPUT)
  const [selectedRootTxid, setSelectedRootTxid] = useState<string | null>(null)
  const [isRootCandidateModalOpen, setIsRootCandidateModalOpen] = useState(false)
  const [isAddressResolution, setIsAddressResolution] = useState(false)
  const [addressRootCandidates, setAddressRootCandidates] = useState<GraphInputCandidateRoot[]>([])
  const [graphResolution, setGraphResolution] = useState<GraphInputResolution | null>(null)
  const [activeRootTxid, setActiveRootTxid] = useState<string | null>(null)
  const [graphReloadKey, setGraphReloadKey] = useState(0)
  const [graphInputCapabilitiesReloadKey, setGraphInputCapabilitiesReloadKey] = useState(0)
  const [selectedTxid, setSelectedTxid] = useState<string | null>(null)
  const [hasSearched, setHasSearched] = useState(false)
  const [graphData, setGraphData] = useState<ProvenanceGraph | null>(null)
  const [graphSummary, setGraphSummary] = useState<GraphSummary | null>(null)
  const [graphClassificationUpdate, setGraphClassificationUpdate] =
    useState<GraphClassificationUpdate | null>(null)
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
  const { capabilities: graphInputCapabilities, loading: isGraphInputCapabilitiesLoading } =
    useGraphInputCapabilities({
      enabled: isRpcConfigured,
      reloadKey: graphInputCapabilitiesReloadKey,
    })
  const addressInputEnabled = graphInputCapabilities.supported_input_kinds.includes('address')

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

  const handleSearchInput = useCallback((nextInput: string) => {
    if (!isRpcConfigured) {
      setIsRpcModalOpen(true)
      return
    }
    setHasSearched(true)
    setSubmittedSearchInput(nextInput)
    setSelectedRootTxid(null)
    setIsRootCandidateModalOpen(false)
    setIsAddressResolution(false)
    setAddressRootCandidates([])
    setGraphResolution(null)
    setActiveRootTxid(null)
    setSelectedTxid(null)
    setGraphData(null)
    setGraphSummary(null)
    setGraphClassificationUpdate(null)
    setGraphReloadKey((current) => current + 1)
  }, [isRpcConfigured])
  const handleResolutionChange = useCallback((nextResolution: GraphInputResolution | null) => {
    setGraphResolution(nextResolution)
    setActiveRootTxid(nextResolution?.selected_root_txid ?? null)
    const isAddressInput = nextResolution?.input_kind === 'address'
    setIsAddressResolution(isAddressInput)

    if (!nextResolution || !isAddressInput) {
      setAddressRootCandidates([])
      setIsRootCandidateModalOpen(false)
      return
    }

    setAddressRootCandidates((previousCandidates) => {
      const nextCandidates = nextResolution.candidate_roots
      if (nextCandidates.length > 1) return nextCandidates
      if (previousCandidates.length > 1) return previousCandidates
      return nextCandidates
    })

    if (nextResolution.requires_selection) {
      setIsRootCandidateModalOpen(true)
    }
  }, [])
  const handleSelectRootCandidate = useCallback((nextRootTxid: string) => {
    setIsRootCandidateModalOpen(false)
    setSelectedRootTxid(nextRootTxid)
    setActiveRootTxid(null)
    setSelectedTxid(null)
    setGraphData(null)
    setGraphClassificationUpdate(null)
    setGraphReloadKey((current) => current + 1)
  }, [])
  const handleSelectTxid = useCallback((nextSelectedTxid: string | null) => {
    setSelectedTxid(nextSelectedTxid)

    if (nextSelectedTxid && nextSelectedTxid.trim().length > 0) {
      setDetailCollapsed(false)
    }
  }, [])

  const showTransactionDetails = !!selectedTxid
  const showDataManagement = hasSearched && !showTransactionDetails

  const workspaceClassName = useMemo(() => {
    const classNames = ['workspace-row']

    if (workspacePreset.compact) {
      classNames.push('workspace-row--compact')
    }
    if (showTransactionDetails || showDataManagement) {
      classNames.push('workspace-row--right-rail')
    }
  if ((showTransactionDetails || showDataManagement) && detailCollapsed) {
      classNames.push('workspace-row--detail-collapsed')
    }

    return classNames.join(' ')
  }, [
    detailCollapsed,
    showDataManagement,
    showTransactionDetails,
    workspacePreset.compact,
  ])

  const handleToggleSidebar = useCallback(() => {
    setSidebarCollapsed((current) => !current)
  }, [])
  const handleToggleDetail = useCallback(() => {
    setDetailCollapsed((current) => !current)
  }, [])
  const handleGraphDataChange = useCallback((nextGraphData: ProvenanceGraph | null) => {
    setGraphData(nextGraphData)
  }, [])
  const handleGraphClassificationUpdate = useCallback((update: GraphClassificationUpdate) => {
    setGraphClassificationUpdate({ ...update })
  }, [])
  const handleGraphSummaryChange = useCallback((nextGraphSummary: GraphSummary | null) => {
    setGraphSummary(nextGraphSummary)
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
      setSelectedTxid(null)
      setHasSearched(false)
      setGraphData(null)
      setGraphSummary(null)
      setGraphClassificationUpdate(null)
      setIsRootCandidateModalOpen(false)
      setIsAddressResolution(false)
      setAddressRootCandidates([])
      setGraphResolution(null)
      setActiveRootTxid(null)
      setSelectedRootTxid(null)
      setGraphInputCapabilitiesReloadKey((current) => current + 1)
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
  const handleExportLabels = useCallback(async (outputPath: string) => {
    const savedPath = await invoke<string>('cmd_export_labels', {
      args: {
        outputPath,
      },
    })
    return savedPath
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
  const rootCandidateResolution = useMemo<GraphInputResolution | null>(() => {
    if (!isAddressResolution || addressRootCandidates.length === 0) {
      return null
    }

    return {
      normalized_input: graphResolution?.normalized_input ?? submittedSearchInput,
      input_kind: 'address',
      candidate_roots: addressRootCandidates,
      selected_root_txid: selectedRootTxid ?? graphResolution?.selected_root_txid ?? null,
      requires_selection: graphResolution?.requires_selection ?? false,
    }
  }, [
    addressRootCandidates,
    graphResolution,
    isAddressResolution,
    selectedRootTxid,
    submittedSearchInput,
  ])
  const canChangeAddressRootTx = isAddressResolution && addressRootCandidates.length > 1
  return (
    <div className="app-shell">
      <TopBar
        searchInput={submittedSearchInput}
        onSearchInput={handleSearchInput}
        addressInputEnabled={addressInputEnabled}
        addressUnavailableReason={graphInputCapabilities.address_unavailable_reason}
        isInputCapabilitiesLoading={isGraphInputCapabilitiesLoading}
        showChangeRootTxButton={canChangeAddressRootTx}
        onChangeRootTx={() => setIsRootCandidateModalOpen(true)}
        onOpenRpcSettings={() => setIsRpcModalOpen(true)}
      />
      <div className="content-row">
        <Sidebar
          collapsed={sidebarCollapsed}
          selectedTxid={selectedTxid}
          onToggle={handleToggleSidebar}
        />
        <div className="main-area">
          <div className="workspace-scroll">
            {isRpcConfigured ? (
              <div className={workspaceClassName}>
                <div className="graph-workspace-column">
                  {rootCandidateResolution ? (
                    <RootCandidatePicker
                      resolution={rootCandidateResolution}
                      isOpen={isRootCandidateModalOpen}
                      onOpenChange={setIsRootCandidateModalOpen}
                      selectedRootTxid={selectedRootTxid}
                      onSelectRootTxid={handleSelectRootCandidate}
                      loading={false}
                    />
                  ) : null}
                  <GraphCanvas
                    input={submittedSearchInput}
                    addressInputEnabled={addressInputEnabled}
                    selectedRootTxid={selectedRootTxid}
                    reloadKey={graphReloadKey}
                    classificationUpdate={graphClassificationUpdate}
                    selectedTxid={selectedTxid}
                    onSelectTxid={handleSelectTxid}
                    onGraphSummaryChange={handleGraphSummaryChange}
                    onResolutionChange={handleResolutionChange}
                    onGraphDataChange={handleGraphDataChange}
                    onRegisterViewActions={handleRegisterViewActions}
                    onRegisterRefresh={handleRegisterGraphRefresh}
                  />
                </div>
                {showTransactionDetails ? (
                  <DetailPanel
                    selectedTxid={selectedTxid}
                    collapsed={detailCollapsed}
                    onGraphClassificationUpdate={handleGraphClassificationUpdate}
                    onRegisterRefresh={handleRegisterDetailRefresh}
                    onDeselect={() => setSelectedTxid(null)}
                    onToggle={handleToggleDetail}
                  />
                ) : showDataManagement ? (
                  <DataManagementSidebar
                    rootTxid={activeRootTxid ?? ''}
                    graphSummary={graphSummary}
                    graphEdgeCount={graphData?.edges.length ?? 0}
                    collapsed={detailCollapsed}
                    onToggle={handleToggleDetail}
                    onExportReport={handleExportReport}
                    onApplyLabelImport={handleApplyLabelImport}
                    onExportLabels={handleExportLabels}
                  />
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>
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
