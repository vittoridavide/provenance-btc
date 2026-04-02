import { describe, expect, it } from 'vitest'
import {
  applyGraphClassificationUpdate,
  type GraphClassificationUpdate,
} from '../../utils/graphClassificationUpdate'
import type { ProvenanceGraph } from '../../types/api'

const TXID = 'a'.repeat(64)

function makeGraph(): ProvenanceGraph {
  return {
    nodes: [
      {
        txid: TXID,
        status: 'confirmed',
        confirmations: 12,
        height: 100,
        time: 1_700_000_000,
        vsize: 140,
        fee_sat: 1000,
        is_root: true,
        label: null,
        classification_category: null,
        classification_state: 'None',
        missing_parents_count: 0,
      },
    ],
    edges: [],
    summary: {
      total_nodes: 1,
      unclassified_nodes: 1,
      missing_parent_edges: 0,
      confirmed_nodes: 1,
      mempool_nodes: 0,
      total_outputs: 2,
      labeled_transactions: 0,
      labeled_outputs: 0,
    },
  }
}

describe('applyGraphClassificationUpdate', () => {
  it('updates graph summary counters for label-only saves', () => {
    const graph = makeGraph()
    const update: GraphClassificationUpdate = {
      txid: TXID,
      classificationCategory: null,
      classificationState: 'None',
      transactionLabel: 'client payment',
      labeledTransactionsDelta: 1,
    }

    const nextGraph = applyGraphClassificationUpdate(graph, update)

    expect(nextGraph).not.toBe(graph)
    expect(nextGraph?.summary.labeled_transactions).toBe(1)
    expect(nextGraph?.summary.unclassified_nodes).toBe(1)
    expect(nextGraph?.nodes[0]).toEqual({
      ...graph.nodes[0],
      label: 'client payment',
    })
  })

  it('updates node classification, label, and unclassified totals when classification changes', () => {
    const graph = makeGraph()
    const update: GraphClassificationUpdate = {
      txid: TXID,
      classificationCategory: 'expense',
      classificationState: 'Complete',
      transactionLabel: 'Expense',
    }

    const nextGraph = applyGraphClassificationUpdate(graph, update)

    expect(nextGraph?.nodes[0]?.classification_category).toBe('expense')
    expect(nextGraph?.nodes[0]?.classification_state).toBe('Complete')
    expect(nextGraph?.nodes[0]?.label).toBe('Expense')
    expect(nextGraph?.summary.unclassified_nodes).toBe(0)
  })

  it('returns the same graph when nothing changes', () => {
    const graph = makeGraph()
    const update: GraphClassificationUpdate = {
      txid: TXID,
      classificationCategory: null,
      classificationState: 'None',
    }

    const nextGraph = applyGraphClassificationUpdate(graph, update)

    expect(nextGraph).toBe(graph)
  })
})
