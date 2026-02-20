use bitcoin::Txid;

use std::collections::{HashMap, HashSet, VecDeque};

#[derive(Debug, Clone)]
pub struct Node {
    pub txid: Txid,
    pub parents: Vec<Txid>,
}

#[derive(Debug, Clone)]
pub struct ProvenanceGraph {
    pub root: Txid,
    pub nodes: HashMap<Txid, Node>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AncestryEntry {
    pub depth: usize,
    pub txid: Txid,
    pub parents: Vec<Txid>,
}

impl ProvenanceGraph {
    pub fn new(root: Txid) -> Self {
        let mut nodes = HashMap::new();
        nodes.insert(
            root,
            Node {
                txid: root,
                parents: vec![],
            },
        );

        Self { root, nodes }
    }

    /// Ensure the graph has a node for `txid`.
    pub fn ensure_node(&mut self, txid: Txid) -> &mut Node {
        self.nodes.entry(txid).or_insert_with(|| Node {
            txid,
            parents: vec![],
        })
    }

    /// Replace parents for `txid`.
    ///
    /// Parents are deduplicated while preserving first-seen order.
    pub fn set_parents(&mut self, txid: Txid, parents: Vec<Txid>) {
        let node = self.ensure_node(txid);
        node.parents = dedup_txids(parents);
    }

    /// Add a single parent edge `txid -> parent`.
    pub fn add_parent(&mut self, txid: Txid, parent: Txid) {
        let node = self.ensure_node(txid);
        if !node.parents.contains(&parent) {
            node.parents.push(parent);
        }
    }

    /// Deterministic breadth-first ancestry listing, starting from `root`.
    ///
    /// - Each txid appears at most once in the output.
    /// - Parent lists are returned sorted (for stable inspection output).
    pub fn to_ancestry_list(&self) -> Vec<AncestryEntry> {
        let mut out = Vec::<AncestryEntry>::new();
        let mut visited = HashSet::<Txid>::new();
        let mut q = VecDeque::<(Txid, usize)>::new();

        q.push_back((self.root, 0));

        while let Some((txid, depth)) = q.pop_front() {
            if !visited.insert(txid) {
                continue;
            }

            let mut parents = self
                .nodes
                .get(&txid)
                .map(|n| n.parents.clone())
                .unwrap_or_default();
            parents.sort();

            out.push(AncestryEntry {
                depth,
                txid,
                parents: parents.clone(),
            });

            for p in parents {
                if !visited.contains(&p) {
                    q.push_back((p, depth + 1));
                }
            }
        }

        out
    }
}

fn dedup_txids(txids: Vec<Txid>) -> Vec<Txid> {
    let mut seen = HashSet::<Txid>::new();
    let mut out = Vec::with_capacity(txids.len());

    for t in txids {
        if seen.insert(t) {
            out.push(t);
        }
    }

    out
}
