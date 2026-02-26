import { Handle, Position, type NodeProps } from 'reactflow'
import type { GraphFlowNodeData } from '../../utils/graphAdapter'

function formatTxid(txid: string): string {
  if (txid.length <= 12) return txid
  return `${txid.slice(0, 6)}...${txid.slice(-6)}`
}

function TransactionNode({ data, selected }: NodeProps<GraphFlowNodeData>) {
  const classes = ['transaction-node', `transaction-node--status-${data.status}`]

  if (selected) classes.push('transaction-node--selected')
  if (data.is_root) classes.push('transaction-node--root')

  return (
    <div className={classes.join(' ')} title={data.txid}>
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={false}
        className="tx-node-handle"
      />

      <div className="transaction-node__header">
        <span className="transaction-node__txid">{formatTxid(data.txid)}</span>
        {data.is_root && <span className="tx-badge tx-badge--root">root</span>}
      </div>

      {data.node_label && <div className="transaction-node__label">{data.node_label}</div>}

      <div className="transaction-node__meta">
        <span className={`tx-badge tx-badge--status tx-badge--status-${data.status}`}>{data.status}</span>
        {data.classification_category && (
          <span className="tx-badge tx-badge--classification">
            {data.classification_category}
          </span>
        )}
      </div>

      <Handle
        type="source"
        position={Position.Right}
        isConnectable={false}
        className="tx-node-handle"
      />
    </div>
  )
}

export default TransactionNode
