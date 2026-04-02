import type { ClassificationState, ProvenanceGraph } from '../types/api'

export type GraphClassificationUpdate = {
  txid: string
  classificationCategory: string | null
  classificationState: ClassificationState
  transactionLabel?: string | null
  labeledOutputsDelta?: number
  labeledTransactionsDelta?: number
}

export function applyGraphClassificationUpdate(
  currentGraph: ProvenanceGraph | null,
  classificationUpdate: GraphClassificationUpdate,
): ProvenanceGraph | null {
  if (!currentGraph) return currentGraph

  const normalizedTxid = classificationUpdate.txid.trim()
  if (!normalizedTxid) return currentGraph

  const nodeIndex = currentGraph.nodes.findIndex((node) => node.txid === normalizedTxid)
  if (nodeIndex === -1) return currentGraph

  const currentNode = currentGraph.nodes[nodeIndex]
  const normalizedCategory = classificationUpdate.classificationCategory?.trim() ?? ''
  const nextClassificationCategory = normalizedCategory.length > 0 ? normalizedCategory : null
  const nextClassificationState = classificationUpdate.classificationState
  const hasTransactionLabelUpdate = 'transactionLabel' in classificationUpdate
  const normalizedTransactionLabel = classificationUpdate.transactionLabel?.trim() ?? ''
  const nextTransactionLabel = normalizedTransactionLabel.length > 0 ? normalizedTransactionLabel : null
  const labeledOutputsDelta = classificationUpdate.labeledOutputsDelta ?? 0
  const labeledTransactionsDelta = classificationUpdate.labeledTransactionsDelta ?? 0
  const classificationChanged =
    currentNode.classification_category !== nextClassificationCategory ||
    currentNode.classification_state !== nextClassificationState
  const labelChanged = hasTransactionLabelUpdate && currentNode.label !== nextTransactionLabel
  const summaryChanged = labeledOutputsDelta !== 0 || labeledTransactionsDelta !== 0
  if (!classificationChanged && !labelChanged && !summaryChanged) {
    return currentGraph
  }

  let nextNodes = currentGraph.nodes
  let nextUnclassifiedNodes = currentGraph.summary.unclassified_nodes
  if (classificationChanged || labelChanged) {
    const wasUnclassified = currentNode.classification_state === 'None'
    const isUnclassified = nextClassificationState === 'None'
    if (classificationChanged) {
      nextUnclassifiedNodes = Math.max(
        0,
        currentGraph.summary.unclassified_nodes + (isUnclassified ? 1 : 0) - (wasUnclassified ? 1 : 0),
      )
    }

    nextNodes = [...currentGraph.nodes]
    nextNodes[nodeIndex] = {
      ...currentNode,
      classification_category: classificationChanged
        ? nextClassificationCategory
        : currentNode.classification_category,
      classification_state: classificationChanged
        ? nextClassificationState
        : currentNode.classification_state,
      label: labelChanged ? nextTransactionLabel : currentNode.label,
    }
  }

  return {
    ...currentGraph,
    nodes: nextNodes,
    summary: {
      ...currentGraph.summary,
      unclassified_nodes: nextUnclassifiedNodes,
      labeled_outputs: Math.max(0, currentGraph.summary.labeled_outputs + labeledOutputsDelta),
      labeled_transactions: Math.max(
        0,
        currentGraph.summary.labeled_transactions + labeledTransactionsDelta,
      ),
    },
  }
}
