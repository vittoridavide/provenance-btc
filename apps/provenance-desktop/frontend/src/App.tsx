import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import './App.css'

interface ChainInfo {
  chain: string
  blocks: number
  headers: number
  verification_progress: number
}

interface TxOutView {
  vout: number
  value_sat: number
  script_pubkey_hex: string
  script_type: string | null
  address?: string | null
}

interface TxInpView {
  vin: number
  prev_txid: string
  prev_vout: number
  value_sat: number
  script_pubkey_hex: string
  script_type: string | null
  script_sig_hex: string
  witness_items_count: number
  witness_hex: string[]
}

interface TxView {
  txid: string
  version: number
  lock_time: number
  inputs_count: number
  outputs: TxOutView[]
  inputs: TxInpView[]
  weight: number
  vsize: number

  confirmations?: number | null
  blockhash?: string | null
  block_height?: number | null
  block_time?: number | null
}

function App() {
  const [chainInfo, setChainInfo] = useState<ChainInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const [txid, setTxid] = useState('')
  const [txView, setTxView] = useState<TxView | null>(null)
  const [txError, setTxError] = useState<string | null>(null)
  const [txLoading, setTxLoading] = useState(false)

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
          url: import.meta.env.VITE_PROVENANCE_RPC_URL,
          username: import.meta.env.VITE_PROVENANCE_RPC_USER,
          password: import.meta.env.VITE_PROVENANCE_RPC_PASS,
        },
      })

      const status = await invoke<any>('cmd_core_status')

      setChainInfo({
        chain: status.chain,
        blocks: status.blocks,
        headers: status.headers,
        verification_progress: status.verification_progress,
      })

      setError(null)
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }

  const totalInputSat = txView
    ? txView.inputs.reduce((acc, input) => acc + input.value_sat, 0)
    : 0
  const totalOutputSat = txView
    ? txView.outputs.reduce((acc, output) => acc + output.value_sat, 0)
    : 0
  const feeSat = txView ? totalInputSat - totalOutputSat : 0
  const feerateSatVb = txView && txView.vsize > 0 ? Math.round(feeSat / txView.vsize) : 0

  async function fetchTx() {
    const trimmed = txid.trim()

    setTxError(null)
    setTxView(null)

    if (!/^[0-9a-fA-F]{64}$/.test(trimmed)) {
      setTxError('Please enter a valid 64-hex-character txid.')
      return
    }

    setTxLoading(true)
    try {
      const view = await invoke<TxView>('cmd_fetch_tx', { txid: trimmed })
      setTxView(view)
    } catch (err) {
      setTxError(String(err))
    } finally {
      setTxLoading(false)
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
            <span className="value">{(chainInfo.verification_progress * 100).toFixed(2)}%</span>
          </div>
        </div>
      )}

      <div className="section">
        <h2>Fetch Transaction</h2>
        <div className="row">
          <input
            className="text-input"
            value={txid}
            onChange={(e) => setTxid(e.target.value)}
            placeholder="txid (64 hex chars)"
            spellCheck={false}
            autoCapitalize="none"
            autoCorrect="off"
          />
          <button onClick={fetchTx} disabled={txLoading}>
            {txLoading ? 'Fetching…' : 'Fetch'}
          </button>
        </div>

        {txError && (
          <div className="error" style={{ marginTop: '1rem' }}>
            <h3>Tx Fetch Error</h3>
            <p>{txError}</p>
          </div>
        )}

        {txView && (
          <div className="tx-view">

            <div className="info-item">
              <label>Txid:</label>
              <span className="value mono">{txView.txid}</span>
            </div>

            <div className="info-item">
              <label>Version:</label>
              <span className="value">{txView.version}</span>
            </div>

            <div className="info-item">
              <label>Lock time:</label>
              <span className="value">{txView.lock_time}</span>
            </div>

            <div className="info-item">
              <label>Inputs:</label>
              <span className="value">{txView.inputs_count}</span>
            </div>
            <div className="info-item">
              <label>Confirmations:</label>
              <span className="value">{txView.confirmations ?? '—'}</span>
            </div>
            <div className="info-item">
              <label>Block height:</label>
              <span className="value">{txView.block_height ?? '—'}</span>
            </div>
            <div className="info-item">
              <label>Block time:</label>
              <span className="value">
                {txView.block_time ? new Date(txView.block_time * 1000).toLocaleString() : '—'}
              </span>
            </div>
            <div className="info-item">
              <label>Block hash:</label>
              <span className="value mono">{txView.blockhash ?? '—'}</span>
            </div>
            <div className="info-item">
              <label>Weight:</label>
              <span className="value">{txView.weight}</span>
            </div>

            <div className="info-item">
              <label>vsize:</label>
              <span className="value">{txView.vsize}</span>
            </div>
            <div className="info-item">
              <label>Fee:</label>
              <span className="value">{feeSat.toLocaleString()} sat</span>
            </div>
            <div className="info-item">
              <label>Feerate:</label>
              <span className="value">{feerateSatVb} sat/vB</span>
            </div>

            <h3 style={{ marginTop: '1rem' }}>Inputs</h3>
            {txView.inputs.map((o) => (
                <div key={o.vin} className="output">
                  <div className="output-head">
                    <span className="mono">vin {o.vin}</span>
                    <span className="mono">{o.value_sat} sat</span>
                    <span className="mono">{o.script_type ?? 'unknown'}</span>
                  </div>
                  <div className="mono output-script">prevout: {o.prev_txid}:{o.prev_vout}</div>
                  <div className="mono output-script">scriptSig: {o.script_sig_hex || '(empty)'}</div>
                  <div className="mono output-script">witness items: {o.witness_items_count}</div>
                  <div className="mono output-script">
                    witness hex:{' '}
                    {o.witness_hex.length > 0
                      ? o.witness_hex.map((w) => (w.length > 96 ? `${w.slice(0, 96)}…` : w)).join(' | ')
                      : '(none)'}
                  </div>
                  <div className="mono output-script">{o.script_pubkey_hex}</div>
                </div>
            ))}

            <h3 style={{ marginTop: '1rem' }}>Outputs</h3>
            <div className="outputs">
              {txView.outputs.map((o) => (
                <div key={o.vout} className="output">
                  <div className="output-head">
                    <span className="mono">vout {o.vout}</span>
                    <span className="mono">{o.value_sat} sat</span>
                    <span className="mono">{o.script_type ?? 'unknown'}</span>
                    <span className="mono">{o.address ?? 'no address'}</span>
                  </div>
                  <div className="mono output-script">{o.script_pubkey_hex}</div>
                </div>
              ))}
            </div>

          </div>
        )}
      </div>
    </div>
  )
}

export default App
