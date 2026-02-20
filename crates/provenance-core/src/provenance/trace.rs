use bitcoin::Txid;

use std::collections::{HashMap, HashSet, VecDeque};

use crate::model::tx_parents::parent_txids_from_hex;
use crate::provenance::graph::{Node, ProvenanceGraph};
use crate::{CoreError, Result};

#[derive(Debug, Clone, Copy)]
pub struct TraceOptions {
    /// Maximum traversal depth starting from the root (root is depth 0).
    ///
    /// If `max_depth == 0`, the returned graph will only contain the root node.
    pub max_depth: usize,

    /// Maximum number of unique txids allowed in the graph.
    pub max_txs: usize,
}

impl TraceOptions {
    pub fn new(max_depth: usize, max_txs: usize) -> Self {
        Self { max_depth, max_txs }
    }
}

/// Trace a transaction's ancestry (parents recursively) and build an in-memory [`ProvenanceGraph`].
///
/// The caller provides a `fetch_tx_hex` function so this stays independent of RPC/DB implementations.
pub fn trace_ancestry<F>(
    root: Txid,
    opts: TraceOptions,
    mut fetch_tx_hex: F,
) -> Result<ProvenanceGraph>
where
    F: FnMut(&Txid) -> Result<String>,
{
    if opts.max_txs == 0 {
        return Err(CoreError::Other("max_txs must be > 0".into()));
    }

    let mut graph = ProvenanceGraph {
        root,
        nodes: HashMap::from([(
            root,
            Node {
                txid: root,
                parents: vec![],
            },
        )]),
    };

    // txids whose tx hex we've already fetched/decoded.
    let mut visited_txids = HashSet::<Txid>::new();

    // Deterministic traversal: BFS from root. We only enqueue nodes whose parents we intend to fetch.
    let mut q = VecDeque::<(Txid, usize)>::new();
    let mut queued = HashSet::<Txid>::new();

    if opts.max_depth > 0 {
        q.push_back((root, 0));
        queued.insert(root);
    }

    while let Some((txid, depth)) = q.pop_front() {
        queued.remove(&txid);

        if !visited_txids.insert(txid) {
            continue;
        }

        if depth >= opts.max_depth {
            // Depth guard: we keep any nodes discovered at this depth (so they appear in the graph),
            // but we do not fetch/expand them.
            continue;
        }

        let tx_hex = fetch_tx_hex(&txid)?;
        let mut parents = parent_txids_from_hex(&tx_hex)?;
        parents.sort();
        parents.dedup();

        graph.set_parents(txid, parents.clone());

        // Ensure parent nodes exist in the graph (so ancestry output is inspectable even if
        // we don't expand those nodes due to max_depth).
        for p in &parents {
            ensure_node(&mut graph, *p, opts.max_txs)?;
        }

        let next_depth = depth + 1;
        if next_depth < opts.max_depth {
            for p in parents {
                if visited_txids.contains(&p) || queued.contains(&p) {
                    continue;
                }
                q.push_back((p, next_depth));
                queued.insert(p);
            }
        }
    }

    Ok(graph)
}

#[cfg(feature = "store-sqlite")]
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct TxHexCacheMetrics {
    pub hits: u64,
    pub misses: u64,
}

#[cfg(feature = "store-sqlite")]
pub fn trace_ancestry_cache_first<F>(
    root: Txid,
    opts: TraceOptions,
    cache: &crate::store::tx_hex_cache::TxHexCache,
    mut fetch_remote_hex: F,
    mut metrics: Option<&mut TxHexCacheMetrics>,
) -> Result<ProvenanceGraph>
where
    F: FnMut(&Txid) -> Result<String>,
{
    trace_ancestry(root, opts, |txid| {
        if let Some(hex) = cache.get(txid)? {
            if let Some(m) = metrics.as_deref_mut() {
                m.hits += 1;
            }
            return Ok(hex);
        }

        if let Some(m) = metrics.as_deref_mut() {
            m.misses += 1;
        }

        let hex = fetch_remote_hex(txid)?;
        cache.put(txid, &hex)?;
        Ok(hex)
    })
}

fn ensure_node(graph: &mut ProvenanceGraph, txid: Txid, max_txs: usize) -> Result<()> {
    if graph.nodes.contains_key(&txid) {
        return Ok(());
    }

    if graph.nodes.len() >= max_txs {
        return Err(CoreError::Other(format!(
            "max_txs exceeded: limit={max_txs}, attempted_to_add={txid}"
        )));
    }

    graph.nodes.insert(
        txid,
        Node {
            txid,
            parents: vec![],
        },
    );

    Ok(())
}
