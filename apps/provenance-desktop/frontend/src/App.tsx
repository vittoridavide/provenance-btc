import { useCallback, useState } from 'react'
import './App.css'
import AlertBanner from './components/AlertBanner'
import DetailPanel from './components/DetailPanel'
import GraphCanvas from './components/GraphCanvas'
import Sidebar from './components/Sidebar'
import TopBar from './components/TopBar'
const DEFAULT_ROOT_TXID = import.meta.env.VITE_PROVENANCE_GRAPH_ROOT_TXID ?? ''

function App() {
  const [rootTxid, setRootTxid] = useState(DEFAULT_ROOT_TXID)
  const [graphReloadKey, setGraphReloadKey] = useState(0)
  const [selectedTxid, setSelectedTxid] = useState<string | null>(null)
  const handleRootTxidSubmit = useCallback((nextRootTxid: string) => {
    setRootTxid(nextRootTxid)
    setSelectedTxid(null)
    setGraphReloadKey((current) => current + 1)
  }, [])

  return (
    <div className="app-shell">
      <TopBar rootTxid={rootTxid} onSubmitRootTxid={handleRootTxidSubmit} />
      <AlertBanner visible={false} message="Alert Banner" />
      <div className="workspace-row">
        <Sidebar />
        <GraphCanvas
          rootTxid={rootTxid}
          reloadKey={graphReloadKey}
          selectedTxid={selectedTxid}
          onSelectTxid={setSelectedTxid}
        />
        <DetailPanel selectedTxid={selectedTxid} />
      </div>
    </div>
  )
}

export default App
