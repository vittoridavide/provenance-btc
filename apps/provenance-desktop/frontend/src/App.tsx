import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import './App.css'

interface ChainInfo {
  chain: string;
  blocks: number;
  headers: number;
  verification_progress: number;
}

function App() {
  const [chainInfo, setChainInfo] = useState<ChainInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchChainInfo()
    const interval = setInterval(fetchChainInfo, 10000) // Refresh every 10 seconds
    return () => clearInterval(interval)
  }, [])

  async function fetchChainInfo() {
    try {
      // (temporary) set config once if you don't have a settings screen yet
      await invoke('cmd_set_rpc_config', {
        args: {
          url: 'http://127.0.0.1:8332',
          username: 'vitdav',
          password: 'superpass',
        },
      });

      const status = await invoke<any>('cmd_core_status');

      setChainInfo({
        chain: status.chain,
        blocks: status.blocks,
        headers: status.headers,
        verification_progress: status.verification_progress,
      });

      setError(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }


  return (
    <div className="container">
      <h1>Bitcoin Chain Status</h1>
      
      {loading && <p>Loading...</p>}
      
      {error && (
        <div className="error">
          <h3>Connection Error</h3>
          <p>{error}</p>
          <p className="hint">Make sure Bitcoin Core is running with RPC enabled.</p>
        </div>
      )}
      
      {chainInfo && (
        <div className="chain-info">
          <div className="info-item">
            <label>Network:</label>
            <span className="value chain">{chainInfo.chain}</span>
          </div>
          <div className="info-item">
            <label>Blocks:</label>
            <span className="value">{chainInfo.blocks.toLocaleString()}</span>
          </div>
          <div className="info-item">
            <label>Headers:</label>
            <span className="value">{chainInfo.headers.toLocaleString()}</span>
          </div>
          <div className="info-item">
            <label>Sync Progress:</label>
            <span className="value">
              {(chainInfo.verification_progress * 100).toFixed(2)}%
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
