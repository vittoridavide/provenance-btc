import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import AlertBanner from './components/AlertBanner'
import DetailPanel from './components/DetailPanel'
import GraphCanvas from './components/GraphCanvas'
import Sidebar from './components/Sidebar'
import TopBar from './components/TopBar'
import {invoke} from "@tauri-apps/api/core";
import type { GraphSummary, ProvenanceSetup } from './types/api.ts'
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
  const [graphSummary, setGraphSummary] = useState<GraphSummary | null>(null)
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
            password: import.meta.env.VITE_PROVENANCE_RPC_PASS
          }
        })
    }, []);

  const handleRootTxidSubmit = useCallback((nextRootTxid: string) => {
    setRootTxid(nextRootTxid)
    setSelectedTxid(null)
    setGraphSummary(null)
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

    if (sidebarCollapsed) {
      classNames.push('workspace-row--sidebar-collapsed')
    }

    if (detailCollapsed) {
      classNames.push('workspace-row--detail-collapsed')
    }

    return classNames.join(' ')
  }, [detailCollapsed, sidebarCollapsed, workspacePreset.compact])

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
  const unclassifiedNodeCount = graphSummary?.unclassified_nodes ?? 0

  return (
    <div className="app-shell">
      <TopBar
        rootTxid={rootTxid}
        onSubmitRootTxid={handleRootTxidSubmit}
        showPanelToggles={showPanelToggles}
        sidebarCollapsed={sidebarCollapsed}
        detailCollapsed={detailCollapsed}
        onToggleSidebar={handleToggleSidebar}
        onToggleDetail={handleToggleDetail}
      />
      <AlertBanner visible={unclassifiedNodeCount > 0} unclassifiedCount={unclassifiedNodeCount} />
      <div className="workspace-scroll">
        <div className={workspaceClassName}>
          <Sidebar collapsed={sidebarCollapsed} selectedTxid={selectedTxid} />
          <GraphCanvas
            rootTxid={rootTxid}
            reloadKey={graphReloadKey}
            selectedTxid={selectedTxid}
            onSelectTxid={handleSelectTxid}
            onGraphSummaryChange={handleGraphSummaryChange}
            onRegisterRefresh={handleRegisterGraphRefresh}
          />
          <DetailPanel
            selectedTxid={selectedTxid}
            collapsed={detailCollapsed}
            onGraphRefresh={handleGraphRefresh}
          />
        </div>
      </div>
    </div>
  )
}

export default App
