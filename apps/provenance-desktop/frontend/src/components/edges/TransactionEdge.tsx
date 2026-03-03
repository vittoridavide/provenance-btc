import { memo, useMemo, useState } from 'react'
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from 'reactflow'
import type { GraphFlowEdgeData } from '../../utils/graphAdapter'

const DEFAULT_EDGE_STROKE = '#94a3b8'
const HOVER_EDGE_STROKE = '#475569'
const SELECTED_EDGE_STROKE = '#3b82f6'

function sanitizeMarkerId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '-')
}

function TransactionEdge({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  selected,
  style,
  data,
}: EdgeProps<GraphFlowEdgeData>) {
  const [isHovered, setIsHovered] = useState(false)
  const baseStroke = typeof style?.stroke === 'string' ? style.stroke : DEFAULT_EDGE_STROKE
  const strokeColor = selected ? SELECTED_EDGE_STROKE : isHovered ? HOVER_EDGE_STROKE : baseStroke
  const strokeWidth = selected || isHovered ? 3 : 2

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  })

  const markerId = useMemo(() => `transaction-edge-arrow-${sanitizeMarkerId(id)}`, [id])
  const edgeLabel = data?.label ?? `vin ${data?.vinIndex ?? ''}`.trim()
  const edgeAriaLabel = `Input ${data?.vinIndex ?? ''} from ${source} to ${target}`.trim()

  return (
    <>
      <defs>
        <marker
          id={markerId}
          markerWidth="8"
          markerHeight="8"
          viewBox="0 0 8 8"
          refX="7"
          refY="4"
          orient="auto"
          markerUnits="userSpaceOnUse"
        >
          <path d="M0,0 L8,4 L0,8 Z" fill={strokeColor} />
        </marker>
      </defs>
      <g
        className={`transaction-edge${selected ? ' transaction-edge--selected' : ''}${isHovered ? ' transaction-edge--hovered' : ''}`}
        role="button"
        aria-label={edgeAriaLabel}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <BaseEdge
          id={id}
          path={edgePath}
          style={{ stroke: strokeColor, strokeWidth }}
          markerEnd={`url(#${markerId})`}
          interactionWidth={20}
        />
      </g>
      <EdgeLabelRenderer>
        <div
          className={`transaction-edge__label${selected ? ' transaction-edge__label--selected' : ''}${isHovered ? ' transaction-edge__label--hovered' : ''}`}
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY - 5}px)`,
          }}
        >
          {edgeLabel}
        </div>
      </EdgeLabelRenderer>
    </>
  )
}

export default memo(TransactionEdge)
