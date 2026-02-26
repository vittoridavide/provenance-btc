import { useTransactionDetail } from '../hooks/useTransactionDetail'

type DetailPanelProps = {
  selectedTxid: string | null
}

function toReadableStatus(confirmations: number | null): string {
  if (confirmations === null) return 'unknown'
  return confirmations > 0 ? 'confirmed' : 'mempool'
}

function formatTimestamp(unixTimestamp: number | null): string {
  if (!unixTimestamp) return '—'
  return new Date(unixTimestamp * 1000).toLocaleString()
}

function shortTxid(txid: string): string {
  if (txid.length <= 16) return txid
  return `${txid.slice(0, 8)}...${txid.slice(-8)}`
}

function DetailPanel({ selectedTxid }: DetailPanelProps) {
  const { detail, loading, error } = useTransactionDetail(selectedTxid)
  const hasSelection = selectedTxid !== null && selectedTxid.trim().length > 0
  const activeTxid = selectedTxid ?? ''

  return (
    <aside className="detail-panel panel">
      <div className="detail-panel__content">
        <h2 className="detail-panel__title">Transaction Details</h2>

        {!hasSelection && (
          <p className="detail-panel__placeholder">
            Select a transaction node to inspect details.
          </p>
        )}

        {hasSelection && loading && (
          <p className="detail-panel__status">
            <span className="spinner spinner--sm" aria-hidden="true" />
            <span>Loading {shortTxid(activeTxid)}…</span>
          </p>
        )}

        {hasSelection && !loading && error && (
          <div className="detail-panel__error">
            <strong>Failed to load transaction</strong>
            <span>{error}</span>
          </div>
        )}

        {hasSelection && !loading && !error && !detail && (
          <p className="detail-panel__placeholder">No detail data returned for this transaction.</p>
        )}

        {hasSelection && !error && detail && (
          <>
            <div className="detail-panel__section">
              <div className="detail-panel__kv">
                <span>Txid</span>
                <code>{detail.txid}</code>
              </div>
              <div className="detail-panel__kv">
                <span>Status</span>
                <span>{toReadableStatus(detail.confirmations)}</span>
              </div>
              <div className="detail-panel__kv">
                <span>Confirmations</span>
                <span>{detail.confirmations ?? '—'}</span>
              </div>
              <div className="detail-panel__kv">
                <span>Block Height</span>
                <span>{detail.block_height ?? '—'}</span>
              </div>
              <div className="detail-panel__kv">
                <span>Block Time</span>
                <span>{formatTimestamp(detail.block_time)}</span>
              </div>
              <div className="detail-panel__kv">
                <span>Block Hash</span>
                <code>{detail.blockhash ?? '—'}</code>
              </div>
            </div>

            <div className="detail-panel__section">
              <div className="detail-panel__kv">
                <span>Version</span>
                <span>{detail.version}</span>
              </div>
              <div className="detail-panel__kv">
                <span>Weight</span>
                <span>{detail.weight}</span>
              </div>
              <div className="detail-panel__kv">
                <span>vsize</span>
                <span>{detail.vsize}</span>
              </div>
              <div className="detail-panel__kv">
                <span>Inputs</span>
                <span>{detail.inputs.length}</span>
              </div>
              <div className="detail-panel__kv">
                <span>Outputs</span>
                <span>{detail.outputs.length}</span>
              </div>
            </div>

            <div className="detail-panel__section">
              <h3>Input snippet</h3>
              {detail.inputs.length === 0 && <p className="detail-panel__placeholder">No inputs.</p>}
              {detail.inputs.slice(0, 3).map((input) => (
                <div key={`${input.vin}-${input.prev_txid}-${input.prev_vout}`} className="detail-panel__line">
                  <span>vin {input.vin}</span>
                  <code>
                    {shortTxid(input.prev_txid)}:{input.prev_vout}
                  </code>
                </div>
              ))}
              {detail.inputs.length > 3 && (
                <p className="detail-panel__placeholder">+{detail.inputs.length - 3} more inputs</p>
              )}
            </div>

            <div className="detail-panel__section">
              <h3>Output snippet</h3>
              {detail.outputs.length === 0 && <p className="detail-panel__placeholder">No outputs.</p>}
              {detail.outputs.slice(0, 3).map((output) => (
                <div key={output.vout} className="detail-panel__line">
                  <span>vout {output.vout}</span>
                  <span>{output.value_sat.toLocaleString()} sat</span>
                </div>
              ))}
              {detail.outputs.length > 3 && (
                <p className="detail-panel__placeholder">+{detail.outputs.length - 3} more outputs</p>
              )}
            </div>
          </>
        )}
      </div>
    </aside>
  )
}

export default DetailPanel
