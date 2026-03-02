import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import './App.css'
import DetailPanel from './components/DetailPanel'
import GraphCanvas, { type GraphCanvasTopBarActions } from './components/GraphCanvas'
import Sidebar from './components/Sidebar'
import TopBar from './components/TopBar'
import type { GraphSummary, ImportSummary, ProvenanceGraph, ProvenanceSetup } from './types/api'
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
  const [graphSummary, setGraphSummary] = useState<GraphSummary | null>(null)
  const graphViewActionsRef = useRef<GraphCanvasTopBarActions | null>(null)
  const graphRefreshRef = useRef<(() => Promise<void>) | null>(null)

  useEffect(() => {
    function handleResize() {
      setWorkspacePreset((currentPreset) => {
        const nextPreset = resolveWorkspacePreset(getViewportWidth())
        if (nextPreset.key === currentPreset.key) return currentPreset
        setSidebarCollapsed(nextPreset.defaultSidebarCollapsed)
        setDetailCollapsed(nextPreset.defaultDetailCollapsed)
        return nextPreset
      })
    }

    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('resize', handleResize)
    }
  }, [])

  useEffect(() => {
    void invoke<ProvenanceSetup>('cmd_set_rpc_config', {
      args: {
        url: import.meta.env.VITE_PROVENANCE_RPC_URL,
        username: import.meta.env.VITE_PROVENANCE_RPC_USER,
        password: import.meta.env.VITE_PROVENANCE_RPC_PASS,
      },
    })
  }, [])

  const handleSearchTxid = useCallback((nextRootTxid: string) => {
    setRootTxid(nextRootTxid)
    setSelectedTxid(null)
    setGraphReloadKey((current) => current + 1)
  }, [])
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

  const showPanelToggles = workspacePreset.compact || sidebarCollapsed || detailCollapsed
  const handleToggleSidebar = useCallback(() => {
    setSidebarCollapsed((current) => !current)
  }, [])
  const handleToggleDetail = useCallback(() => {
    setDetailCollapsed((current) => !current)
  }, [])
  const handleGraphSummaryChange = useCallback((nextGraphSummary: GraphSummary | null) => {
    setGraphSummary(nextGraphSummary)
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
  const handleGraphRefresh = useCallback(async () => {
    if (graphRefreshRef.current) {
      await graphRefreshRef.current()
      return
    }

    setGraphReloadKey((current) => current + 1)
  }, [])
  const handleFitView = useCallback(() => {
    graphViewActionsRef.current?.fitView()
  }, [])
  const handleFocusNode = useCallback((_txid: string) => {
    // Focus the viewport on the selected node — for now uses full-graph fit
    graphViewActionsRef.current?.fitView()
  }, [])
  const handleResetToDefaultRoot = useCallback(() => {
    handleSearchTxid(DEFAULT_ROOT_TXID)
  }, [handleSearchTxid])
  const handleResetLayout = useCallback(() => {
    graphViewActionsRef.current?.resetLayout()
  }, [])
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
    } catch (error) {
      console.error(`Failed to export graph JSON: ${toErrorMessage(error)}`)
    }
  }, [graphData, rootTxid])
  const handleExportLabels = useCallback(async () => {
    try {
      const labelsJsonl = await invoke<string>('cmd_export_labels')
      const fileName = `provenance-labels-${formatFileTimestamp()}.jsonl`
      downloadTextFile(fileName, labelsJsonl, 'application/x-ndjson')
    } catch (error) {
      console.error(`Failed to export labels: ${toErrorMessage(error)}`)
    }
  }, [])
  const handleImportLabels = useCallback(
    async (file: File) => {
      try {
        const jsonl = await file.text()
        await invoke<ImportSummary>('cmd_import_labels', { jsonl })
        await handleGraphRefresh()
      } catch (error) {
        console.error(`Failed to import labels: ${toErrorMessage(error)}`)
      }
    },
    [handleGraphRefresh],
  )
  return (
    <div className="app-shell">
      <TopBar
        rootTxid={rootTxid}
        onSearchTxid={handleSearchTxid}
        onFitView={handleFitView}
        onResetLayout={handleResetLayout}
        onExportGraphJson={handleExportGraphJson}
        onExportLabels={handleExportLabels}
        onImportLabels={handleImportLabels}
        showPanelToggles={showPanelToggles}
        sidebarCollapsed={sidebarCollapsed}
        detailCollapsed={detailCollapsed}
        onToggleSidebar={handleToggleSidebar}
        onToggleDetail={handleToggleDetail}
      />
      <div className="content-row">
        <Sidebar collapsed={sidebarCollapsed} selectedTxid={selectedTxid} />
        <div className="main-area">
          <div className={workspaceClassName}>
            <GraphCanvas
              rootTxid={rootTxid}
              reloadKey={graphReloadKey}
              selectedTxid={selectedTxid}
              onSelectTxid={handleSelectTxid}
              onGraphSummaryChange={handleGraphSummaryChange}
              onGraphDataChange={handleGraphDataChange}
              onRegisterViewActions={handleRegisterViewActions}
              onRegisterRefresh={handleRegisterGraphRefresh}
            />
            <DetailPanel
              selectedTxid={selectedTxid}
              collapsed={detailCollapsed}
              onGraphRefresh={handleGraphRefresh}
              onSetAsRoot={handleSearchTxid}
              onResetRoot={handleResetToDefaultRoot}
              onFocusNode={handleFocusNode}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

export default App
