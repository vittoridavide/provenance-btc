import { memo, useMemo } from 'react'
import { Handle, Position, type NodeProps } from 'reactflow'
import type { GraphFlowNodeData } from '../../utils/graphAdapter'

function formatHeaderTxid(txid: string): string {
  if (txid.length <= 16) return txid
  return `${txid.slice(0, 16)}...`
}

function shortTxid(txid: string): string {
  if (txid.length <= 12) return txid
  return `${txid.slice(0, 6)}...${txid.slice(-6)}`
}

function CheckCircleIcon() {
  return (
    <svg
      className="transaction-node-card__state-icon transaction-node-card__state-icon--ok"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="6.2" stroke="currentColor" strokeWidth="1.4" />
      <path d="M5.2 8.1l1.9 1.9 3.8-3.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function AlertCircleIcon() {
  return (
    <svg
      className="transaction-node-card__state-icon transaction-node-card__state-icon--warn"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="6.2" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8 4.7v4.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="8" cy="11.5" r="0.9" fill="currentColor" />
    </svg>
  )
}

function AlertTriangleIcon() {
  return (
    <svg
      className="transaction-node-card__state-icon transaction-node-card__state-icon--error"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path d="M8 2.3l6.1 10.6H1.9L8 2.3z" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8 6v3.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="8" cy="11.8" r="0.8" fill="currentColor" />
    </svg>
  )
}

function MissingIcon() {
  return (
    <svg className="transaction-node-card__status-alert" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6.2" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8 4.7v4.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="8" cy="11.5" r="0.9" fill="currentColor" />
    </svg>
  )
}

function CopyIcon() {
  return (
    <svg className="transaction-node-card__copy-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="5.1" y="5.1" width="8.2" height="8.2" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M10.1 5.1V3.7c0-.8-.6-1.4-1.4-1.4H3.7c-.8 0-1.4.6-1.4 1.4v4.9c0 .8.6 1.4 1.4 1.4h1.4"
        stroke="currentColor"
        strokeWidth="1.3"
      />
    </svg>
  )
}

async function copyTextToClipboard(value: string): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value)
      return
    } catch {
      // fallback below
    }
  }

  if (typeof document === 'undefined') {
    return
  }

  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.setAttribute('readonly', 'true')
  textarea.style.position = 'absolute'
  textarea.style.left = '-9999px'
  textarea.style.top = '0'
  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()
  try {
    document.execCommand('copy')
  } catch {
    // ignore
  } finally {
    document.body.removeChild(textarea)
  }
}

function statusLabel(status: GraphFlowNodeData['status']): string {
  if (status === 'confirmed') return 'Confirmed'
  if (status === 'mempool') return 'Mempool'
  return 'Missing'
}

function labelingIndicator(labelingState: GraphFlowNodeData['labeling_state']) {
  if (labelingState === 'fully-labeled') {
    return <CheckCircleIcon />
  }
  if (labelingState === 'partially-labeled') {
    return <AlertCircleIcon />
  }
  if (labelingState === 'conflicted') {
    return <AlertTriangleIcon />
  }
  return null
}

function TransactionNode({ data, selected }: NodeProps<GraphFlowNodeData>) {
  const classes = ['transaction-node-card']
  if (selected) classes.push('transaction-node-card--selected')
  if (data.is_root) classes.push('transaction-node-card--root')
  if (data.status === 'missing') classes.push('transaction-node-card--missing')
  if (data.audit_unclassified) classes.push('transaction-node-card--audit-unclassified')
  if (data.labeling_state === 'fully-labeled' && data.classification_key) {
    classes.push(`transaction-node-card--classified-${data.classification_key}`)
  }
  if (data.category_palette_key) classes.push(`transaction-node-card--category-${data.category_palette_key}`)
  if (data.category_neutral_indicator) classes.push('transaction-node-card--category-neutral-indicator')

  const nodeStatusLabel = statusLabel(data.status)
  const labelingIcon = useMemo(() => labelingIndicator(data.labeling_state), [data.labeling_state])
  const displayConfirmations = data.status === 'confirmed' && data.confirmations !== null
  const displayMetrics = data.status !== 'missing' && (data.vsize !== null || data.fee_sat !== null)
  const displayOutputClassification = data.labeled_output_count > 0 && data.total_output_count > 0

  return (
    <div
      className={classes.join(' ')}
      title={data.txid}
      role="button"
      tabIndex={0}
      aria-label={`Transaction ${shortTxid(data.txid)}, status ${nodeStatusLabel.toLowerCase()}`}
    >
      <Handle
        type="target"
        position={Position.Top}
        isConnectable={false}
        className="transaction-node-card__handle"
      />

      <header className="transaction-node-card__header">
        <div className="transaction-node-card__header-row">
          <span className="transaction-node-card__txid">{formatHeaderTxid(data.txid)}</span>
          <div className="transaction-node-card__header-icons">
            {labelingIcon}
            <button
              type="button"
              className="transaction-node-card__copy-btn"
              aria-label="Copy transaction id"
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation()
                void copyTextToClipboard(data.txid)
              }}
            >
              <CopyIcon />
            </button>
          </div>
        </div>

        {data.classification_label && (
          <div className="transaction-node-card__classification-row">
            <span
              className={`transaction-node-card__classification-badge transaction-node-card__classification-badge--${data.classification_key ?? 'other'}`}
            >
              {data.classification_label}
            </span>
          </div>
        )}
      </header>

      <section className="transaction-node-card__content">
        <div className="transaction-node-card__badges">
          <span className={`transaction-node-card__badge transaction-node-card__badge--status-${data.status}`}>
            {data.status === 'missing' ? (
              <MissingIcon />
            ) : (
              <span className="transaction-node-card__status-dot" aria-hidden="true" />
            )}
            {nodeStatusLabel}
          </span>
          {displayConfirmations && (
            <span className="transaction-node-card__badge transaction-node-card__badge--confirmations">
              {data.confirmations} conf
            </span>
          )}
          {data.script_type && (
            <span className="transaction-node-card__badge transaction-node-card__badge--script">
              {data.script_type.toUpperCase()}
            </span>
          )}
        </div>

        {displayMetrics && (
          <div className="transaction-node-card__metrics">
            {data.vsize !== null && (
              <span>
                <span className="transaction-node-card__metric-label">vsize:</span>{' '}
                <span className="transaction-node-card__metric-value">{data.vsize}</span>
              </span>
            )}
            {data.fee_sat !== null && (
              <span>
                <span className="transaction-node-card__metric-label">fee:</span>{' '}
                <span className="transaction-node-card__metric-value">{data.fee_sat} sat</span>
              </span>
            )}
          </div>
        )}

        {displayOutputClassification && (
          <div className="transaction-node-card__output-summary">
            <span className="transaction-node-card__output-dot" aria-hidden="true" />
            <span>
              {data.labeled_output_count} of {data.total_output_count} outputs classified
            </span>
          </div>
        )}

        {data.status === 'confirmed' && data.block_height !== null && (
          <footer className="transaction-node-card__footer">
            <span>height {data.block_height}</span>
            {data.timestamp_label && <span> · {data.timestamp_label}</span>}
          </footer>
        )}
      </section>

      <Handle
        type="source"
        position={Position.Bottom}
        isConnectable={false}
        className="transaction-node-card__handle"
      />
    </div>
  )
}

export default memo(TransactionNode)
