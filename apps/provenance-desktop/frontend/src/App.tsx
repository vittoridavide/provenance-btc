import './App.css'
import AlertBanner from './components/AlertBanner'
import DetailPanel from './components/DetailPanel'
import GraphCanvas from './components/GraphCanvas'
import Sidebar from './components/Sidebar'
import TopBar from './components/TopBar'

function App() {

  return (
    <div className="app-shell">
      <TopBar />
      <AlertBanner visible={false} message="Alert Banner" />
      <div className="workspace-row">
        <Sidebar />
        <GraphCanvas />
        <DetailPanel />
      </div>
    </div>
  )
}

export default App
