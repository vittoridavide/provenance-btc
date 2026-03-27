use std::collections::{HashMap, HashSet, VecDeque};

use rusqlite::{params_from_iter, Connection};
use serde::{Deserialize, Serialize};

use crate::api::types::{
    Classification, ClassificationState, GraphEdge, GraphNode, GraphSummary, ProvenanceGraph,
    RefType, TxStatus,
};
use crate::model::tx_view::TxView;
use crate::rpc::client::CoreRpc;
use crate::{CoreError, Result};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GraphExportContextRequest {
    pub root_txid: String,
    pub traversal_depth: u32,
}

impl GraphExportContextRequest {
    pub fn new(root_txid: String, traversal_depth: u32) -> Self {
        Self {
            root_txid,
            traversal_depth,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct GraphExportContext {
    pub root_txid: String,
    pub traversal_depth: u32,
    pub tx_nodes: Vec<GraphContextTxNode>,
    pub output_rows: Vec<GraphContextOutputRow>,
    pub edges: Vec<GraphEdge>,
    pub warnings: Vec<GraphCompletenessWarning>,
    pub summary: GraphSummary,
}

impl GraphExportContext {
    pub fn to_provenance_graph(&self) -> ProvenanceGraph {
        let mut nodes = self
            .tx_nodes
            .iter()
            .cloned()
            .map(GraphContextTxNode::into_graph_node)
            .collect::<Vec<_>>();
        nodes.sort_by(|a, b| a.txid.cmp(&b.txid));

        let mut edges = self.edges.clone();
        sort_edges(&mut edges);

        ProvenanceGraph {
            nodes,
            edges,
            summary: self.summary.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct GraphContextTxNode {
    pub graph_depth: u32,
    pub txid: String,
    pub status: TxStatus,
    pub confirmations: Option<u32>,
    pub height: Option<u32>,
    pub time: Option<u64>,
    pub vsize: Option<u64>,
    pub fee_sat: Option<u64>,
    pub is_root: bool,
    pub label: Option<String>,
    pub classification: Option<Classification>,
    pub classification_state: ClassificationState,
    pub missing_parents_count: u32,
}

impl GraphContextTxNode {
    fn into_graph_node(self) -> GraphNode {
        GraphNode {
            txid: self.txid,
            status: self.status,
            confirmations: self.confirmations,
            height: self.height,
            time: self.time,
            vsize: self.vsize,
            fee_sat: self.fee_sat,
            is_root: self.is_root,
            label: self.label,
            classification_category: self.classification.map(|c| c.category),
            classification_state: self.classification_state,
            missing_parents_count: self.missing_parents_count,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct GraphContextOutputRow {
    pub root_txid: String,
    pub graph_depth: u32,
    pub txid: String,
    pub vout: u32,
    pub outpoint: String,
    pub tx_status: TxStatus,
    pub block_height: Option<u32>,
    pub block_time: Option<u64>,
    pub value_sat: u64,
    pub address: Option<String>,
    pub script_type: Option<String>,
    pub label: Option<String>,
    pub classification: Option<Classification>,
    pub tx_label: Option<String>,
    pub tx_classification: Option<Classification>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum GraphCompletenessWarningCode {
    MissingParent,
    MempoolTransaction,
    UnclassifiedTransaction,
    UnclassifiedOutput,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GraphCompletenessWarning {
    pub code: GraphCompletenessWarningCode,
    pub ref_type: RefType,
    pub ref_id: String,
    pub message: String,
}

pub trait TxViewProvider {
    fn fetch_tx_view(&self, txid: &str) -> Result<TxView>;
}

impl TxViewProvider for CoreRpc {
    fn fetch_tx_view(&self, txid: &str) -> Result<TxView> {
        self.fetch_tx_view(txid)
    }
}

pub fn build_graph_export_context<P: TxViewProvider>(
    rpc: &P,
    conn: &Connection,
    request: &GraphExportContextRequest,
) -> Result<GraphExportContext> {
    let root_txid = request.root_txid.trim();
    if root_txid.is_empty() {
        return Err(CoreError::Other("root_txid must not be empty".to_string()));
    }

    let root_txid = root_txid.to_string();
    let mut tx_nodes = HashMap::<String, GraphContextTxNode>::new();
    let mut tx_views = HashMap::<String, TxView>::new();
    let mut edges = Vec::<GraphEdge>::new();
    let mut q = VecDeque::<(String, u32)>::new();
    let mut queued = HashSet::<String>::new();
    let mut visited = HashSet::<String>::new();

    q.push_back((root_txid.clone(), 0));
    queued.insert(root_txid.clone());
    tx_nodes.insert(root_txid.clone(), missing_node(&root_txid, true, 0));

    while let Some((txid, current_depth)) = q.pop_front() {
        queued.remove(&txid);
        if !visited.insert(txid.clone()) {
            continue;
        }

        tx_nodes
            .entry(txid.clone())
            .and_modify(|node| node.graph_depth = node.graph_depth.min(current_depth))
            .or_insert_with(|| missing_node(&txid, txid == root_txid, current_depth));

        let tx_view = match rpc.fetch_tx_view(&txid) {
            Ok(view) => view,
            Err(err) => {
                if txid == root_txid {
                    return Err(CoreError::Other(format!(
                        "failed to fetch root tx '{root_txid}': {err}"
                    )));
                }

                if let Some(node) = tx_nodes.get_mut(&txid) {
                    node.status = TxStatus::Missing;
                }
                continue;
            }
        };

        if let Some(node) = tx_nodes.get_mut(&txid) {
            node.status = if tx_view.confirmations.unwrap_or(0) > 0 {
                TxStatus::Confirmed
            } else {
                TxStatus::Mempool
            };
            node.confirmations = tx_view.confirmations;
            node.height = tx_view.block_height;
            node.time = tx_view.block_time;
            node.vsize = Some(tx_view.vsize);
            node.fee_sat = tx_view.fee_sat;
            node.is_root = txid == root_txid;
        }

        tx_views.insert(txid.clone(), tx_view.clone());

        if current_depth >= request.traversal_depth {
            continue;
        }

        for input in tx_view.inputs.iter().filter(|input| !input.is_coinbase) {
            let parent_txid = input.prev_txid.clone();
            let parent_depth = current_depth.saturating_add(1);

            edges.push(GraphEdge {
                from_txid: txid.clone(),
                to_txid: parent_txid.clone(),
                vin_index: input.vin,
            });

            tx_nodes
                .entry(parent_txid.clone())
                .and_modify(|node| node.graph_depth = node.graph_depth.min(parent_depth))
                .or_insert_with(|| missing_node(&parent_txid, false, parent_depth));

            if !visited.contains(&parent_txid) && queued.insert(parent_txid.clone()) {
                q.push_back((parent_txid, parent_depth));
            }
        }
    }

    let txids = tx_nodes.keys().cloned().collect::<Vec<_>>();
    let tx_labels = fetch_labels_for_ids(conn, RefType::Tx.as_str(), &txids)?;
    let tx_classifications = fetch_classifications_for_ids(conn, RefType::Tx.as_str(), &txids)?;

    for node in tx_nodes.values_mut() {
        node.label = tx_labels.get(&node.txid).cloned();
        node.classification = tx_classifications.get(&node.txid).cloned();
        node.classification_state = if node.classification.is_some() {
            ClassificationState::TxOnly
        } else {
            ClassificationState::None
        };
    }

    let mut output_refs = tx_views
        .values()
        .flat_map(|tx| {
            tx.outputs
                .iter()
                .map(|output| format!("{}:{}", tx.txid, output.vout))
                .collect::<Vec<_>>()
        })
        .collect::<Vec<_>>();
    output_refs.sort();
    output_refs.dedup();

    let output_labels = fetch_labels_for_ids(conn, RefType::Output.as_str(), &output_refs)?;
    let output_classifications =
        fetch_classifications_for_ids(conn, RefType::Output.as_str(), &output_refs)?;

    let mut missing_parent_counts = HashMap::<String, u32>::new();
    for edge in &edges {
        if matches!(
            tx_nodes.get(&edge.to_txid).map(|node| node.status),
            Some(TxStatus::Missing)
        ) {
            *missing_parent_counts
                .entry(edge.from_txid.clone())
                .or_insert(0) += 1;
        }
    }

    for node in tx_nodes.values_mut() {
        node.missing_parents_count = *missing_parent_counts.get(&node.txid).unwrap_or(&0);
    }

    let mut output_rows = Vec::<GraphContextOutputRow>::new();
    for tx in tx_views.values() {
        let Some(node) = tx_nodes.get(&tx.txid) else {
            continue;
        };

        for output in &tx.outputs {
            let outpoint = format!("{}:{}", tx.txid, output.vout);
            output_rows.push(GraphContextOutputRow {
                root_txid: root_txid.clone(),
                graph_depth: node.graph_depth,
                txid: tx.txid.clone(),
                vout: output.vout,
                outpoint: outpoint.clone(),
                tx_status: node.status,
                block_height: node.height,
                block_time: node.time,
                value_sat: output.value_sat,
                address: output.address.clone(),
                script_type: output.script_type.clone(),
                label: output_labels.get(&outpoint).cloned(),
                classification: output_classifications.get(&outpoint).cloned(),
                tx_label: node.label.clone(),
                tx_classification: node.classification.clone(),
            });
        }
    }
    output_rows.sort_by(|a, b| {
        a.graph_depth
            .cmp(&b.graph_depth)
            .then_with(|| a.txid.cmp(&b.txid))
            .then_with(|| a.vout.cmp(&b.vout))
    });

    sort_edges(&mut edges);

    let mut warnings = Vec::<GraphCompletenessWarning>::new();
    for edge in &edges {
        if matches!(
            tx_nodes.get(&edge.to_txid).map(|node| node.status),
            Some(TxStatus::Missing)
        ) {
            warnings.push(GraphCompletenessWarning {
                code: GraphCompletenessWarningCode::MissingParent,
                ref_type: RefType::Tx,
                ref_id: edge.from_txid.clone(),
                message: format!(
                    "missing parent '{}' referenced by {}:{}",
                    edge.to_txid, edge.from_txid, edge.vin_index
                ),
            });
        }
    }

    for node in tx_nodes.values() {
        if matches!(node.status, TxStatus::Mempool) {
            warnings.push(GraphCompletenessWarning {
                code: GraphCompletenessWarningCode::MempoolTransaction,
                ref_type: RefType::Tx,
                ref_id: node.txid.clone(),
                message: format!("transaction '{}' is unconfirmed", node.txid),
            });
        }

        if !matches!(node.status, TxStatus::Missing) && node.classification.is_none() {
            warnings.push(GraphCompletenessWarning {
                code: GraphCompletenessWarningCode::UnclassifiedTransaction,
                ref_type: RefType::Tx,
                ref_id: node.txid.clone(),
                message: format!("transaction '{}' has no classification", node.txid),
            });
        }
    }

    for row in &output_rows {
        if row.classification.is_none() {
            warnings.push(GraphCompletenessWarning {
                code: GraphCompletenessWarningCode::UnclassifiedOutput,
                ref_type: RefType::Output,
                ref_id: row.outpoint.clone(),
                message: format!("output '{}' has no classification", row.outpoint),
            });
        }
    }

    warnings.sort_by(|a, b| {
        warning_rank(a.code)
            .cmp(&warning_rank(b.code))
            .then_with(|| ref_type_rank(a.ref_type).cmp(&ref_type_rank(b.ref_type)))
            .then_with(|| a.ref_id.cmp(&b.ref_id))
            .then_with(|| a.message.cmp(&b.message))
    });

    let mut tx_nodes_vec = tx_nodes.into_values().collect::<Vec<_>>();
    tx_nodes_vec.sort_by(|a, b| {
        a.graph_depth
            .cmp(&b.graph_depth)
            .then_with(|| a.txid.cmp(&b.txid))
    });

    let summary = GraphSummary {
        total_nodes: tx_nodes_vec.len() as u32,
        unclassified_nodes: tx_nodes_vec
            .iter()
            .filter(|node| matches!(node.classification_state, ClassificationState::None))
            .count() as u32,
        missing_parent_edges: edges
            .iter()
            .filter(|edge| {
                matches!(
                    tx_nodes_vec
                        .iter()
                        .find(|node| node.txid == edge.to_txid)
                        .map(|node| node.status),
                    Some(TxStatus::Missing)
                )
            })
            .count() as u32,
        confirmed_nodes: tx_nodes_vec
            .iter()
            .filter(|node| matches!(node.status, TxStatus::Confirmed))
            .count() as u32,
        mempool_nodes: tx_nodes_vec
            .iter()
            .filter(|node| matches!(node.status, TxStatus::Mempool))
            .count() as u32,
        total_outputs: output_rows.len() as u32,
        labeled_transactions: tx_nodes_vec
            .iter()
            .filter(|node| node.label.is_some())
            .count() as u32,
        labeled_outputs: output_rows.iter().filter(|row| row.label.is_some()).count() as u32,
    };

    Ok(GraphExportContext {
        root_txid,
        traversal_depth: request.traversal_depth,
        tx_nodes: tx_nodes_vec,
        output_rows,
        edges,
        warnings,
        summary,
    })
}

fn sort_edges(edges: &mut [GraphEdge]) {
    edges.sort_by(|a, b| {
        a.from_txid
            .cmp(&b.from_txid)
            .then_with(|| a.to_txid.cmp(&b.to_txid))
            .then_with(|| a.vin_index.cmp(&b.vin_index))
    });
}

fn warning_rank(code: GraphCompletenessWarningCode) -> u8 {
    match code {
        GraphCompletenessWarningCode::MissingParent => 0,
        GraphCompletenessWarningCode::MempoolTransaction => 1,
        GraphCompletenessWarningCode::UnclassifiedTransaction => 2,
        GraphCompletenessWarningCode::UnclassifiedOutput => 3,
    }
}

fn ref_type_rank(ref_type: RefType) -> u8 {
    match ref_type {
        RefType::Tx => 0,
        RefType::Output => 1,
    }
}

fn fetch_labels_for_ids(
    conn: &Connection,
    ref_type: &str,
    ref_ids: &[String],
) -> Result<HashMap<String, String>> {
    if ref_ids.is_empty() {
        return Ok(HashMap::new());
    }
    if ref_type != RefType::Tx.as_str() && ref_type != RefType::Output.as_str() {
        return Err(CoreError::Other(format!(
            "unsupported label ref_type '{ref_type}'"
        )));
    }

    let placeholders = vec!["?"; ref_ids.len()].join(", ");
    let sql = format!(
        "SELECT ref_id, label
         FROM labels
         WHERE ref_type = '{ref_type}' AND ref_id IN ({placeholders})"
    );

    let mut stmt = conn.prepare(&sql)?;
    let mut rows = stmt.query(params_from_iter(ref_ids.iter()))?;
    let mut out = HashMap::new();

    while let Some(row) = rows.next()? {
        let ref_id: String = row.get(0)?;
        let label: String = row.get(1)?;
        out.insert(ref_id, label);
    }

    Ok(out)
}

fn fetch_classifications_for_ids(
    conn: &Connection,
    ref_type: &str,
    ref_ids: &[String],
) -> Result<HashMap<String, Classification>> {
    if ref_ids.is_empty() {
        return Ok(HashMap::new());
    }
    if ref_type != RefType::Tx.as_str() && ref_type != RefType::Output.as_str() {
        return Err(CoreError::Other(format!(
            "unsupported classification ref_type '{ref_type}'"
        )));
    }

    let placeholders = vec!["?"; ref_ids.len()].join(", ");
    let sql = format!(
        "SELECT ref_id, category, context, metadata, tax_relevant
         FROM classifications
         WHERE ref_type = '{ref_type}' AND ref_id IN ({placeholders})"
    );

    let mut stmt = conn.prepare(&sql)?;
    let mut rows = stmt.query(params_from_iter(ref_ids.iter()))?;
    let mut out = HashMap::new();

    while let Some(row) = rows.next()? {
        let ref_id: String = row.get(0)?;
        let category: String = row.get(1)?;
        let context: Option<String> = row.get(2)?;
        let metadata_raw: String = row.get(3)?;
        let tax_relevant: i64 = row.get(4)?;

        let metadata = serde_json::from_str(&metadata_raw).map_err(|e| {
            CoreError::Other(format!(
                "invalid classification metadata for '{ref_id}': {e}"
            ))
        })?;

        out.insert(
            ref_id,
            Classification {
                category,
                context: context.unwrap_or_default(),
                metadata,
                tax_relevant: tax_relevant != 0,
            },
        );
    }

    Ok(out)
}

fn missing_node(txid: &str, is_root: bool, graph_depth: u32) -> GraphContextTxNode {
    GraphContextTxNode {
        graph_depth,
        txid: txid.to_string(),
        status: TxStatus::Missing,
        confirmations: None,
        height: None,
        time: None,
        vsize: None,
        fee_sat: None,
        is_root,
        label: None,
        classification: None,
        classification_state: ClassificationState::None,
        missing_parents_count: 0,
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use crate::model::tx_view::{TxInpView, TxOutView, TxView};
    use crate::store::{classifications, db::Database, labels};
    use crate::{CoreError, Result};
    use serde_json::json;

    use super::{
        build_graph_export_context, GraphCompletenessWarningCode, GraphExportContextRequest,
        TxViewProvider,
    };

    const ROOT_TXID: &str = "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
    const PARENT_TXID: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const MISSING_PARENT_TXID: &str =
        "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

    struct FakeTxViewProvider {
        tx_by_id: HashMap<String, TxView>,
    }

    impl TxViewProvider for FakeTxViewProvider {
        fn fetch_tx_view(&self, txid: &str) -> Result<TxView> {
            self.tx_by_id
                .get(txid)
                .cloned()
                .ok_or_else(|| CoreError::Other(format!("tx '{txid}' not found")))
        }
    }

    #[test]
    fn build_context_moves_graph_and_annotation_data_into_core_service() {
        let db = Database::open(":memory:").expect("db opens");
        let conn = db.conn();

        labels::set_label(conn, "tx", ROOT_TXID, "root-label").expect("set tx label");
        labels::set_label(conn, "output", &format!("{ROOT_TXID}:0"), "root-out-0")
            .expect("set output label");
        classifications::set_classification(
            conn,
            "tx",
            ROOT_TXID,
            "Income",
            Some("core test"),
            &json!({ "counterparty": "Alice" }),
            true,
        )
        .expect("set tx classification");
        classifications::set_classification(
            conn,
            "output",
            &format!("{ROOT_TXID}:0"),
            "Owned",
            None,
            &json!({}),
            false,
        )
        .expect("set output classification");

        let provider = FakeTxViewProvider {
            tx_by_id: HashMap::from([
                (ROOT_TXID.to_string(), root_tx_view()),
                (PARENT_TXID.to_string(), parent_tx_view()),
            ]),
        };
        let request = GraphExportContextRequest::new(ROOT_TXID.to_string(), 1);

        let context =
            build_graph_export_context(&provider, conn, &request).expect("context builds");

        let txids_by_depth = context
            .tx_nodes
            .iter()
            .map(|node| node.txid.clone())
            .collect::<Vec<_>>();
        assert_eq!(
            txids_by_depth,
            vec![
                ROOT_TXID.to_string(),
                PARENT_TXID.to_string(),
                MISSING_PARENT_TXID.to_string()
            ]
        );

        let root_node = context
            .tx_nodes
            .iter()
            .find(|node| node.txid == ROOT_TXID)
            .expect("root node exists");
        assert_eq!(root_node.label.as_deref(), Some("root-label"));
        assert_eq!(
            root_node
                .classification
                .as_ref()
                .map(|classification| classification.category.as_str()),
            Some("Income")
        );
        assert_eq!(root_node.missing_parents_count, 1);

        let root_output = context
            .output_rows
            .iter()
            .find(|row| row.outpoint == format!("{ROOT_TXID}:0"))
            .expect("root output row exists");
        assert_eq!(root_output.label.as_deref(), Some("root-out-0"));
        assert_eq!(
            root_output
                .classification
                .as_ref()
                .map(|classification| classification.category.as_str()),
            Some("Owned")
        );

        let warning_codes = context
            .warnings
            .iter()
            .map(|warning| warning.code)
            .collect::<Vec<_>>();
        assert!(warning_codes.contains(&GraphCompletenessWarningCode::MissingParent));
        assert!(warning_codes.contains(&GraphCompletenessWarningCode::MempoolTransaction));
        assert!(warning_codes.contains(&GraphCompletenessWarningCode::UnclassifiedTransaction));
        assert!(warning_codes.contains(&GraphCompletenessWarningCode::UnclassifiedOutput));

        let graph = context.to_provenance_graph();
        let graph_txids = graph
            .nodes
            .iter()
            .map(|node| node.txid.clone())
            .collect::<Vec<_>>();
        assert_eq!(
            graph_txids,
            vec![
                PARENT_TXID.to_string(),
                MISSING_PARENT_TXID.to_string(),
                ROOT_TXID.to_string()
            ]
        );
        assert_eq!(graph.summary.total_nodes, 3);
        assert_eq!(graph.summary.confirmed_nodes, 1);
        assert_eq!(graph.summary.mempool_nodes, 1);
        assert_eq!(graph.summary.unclassified_nodes, 2);
        assert_eq!(graph.summary.missing_parent_edges, 1);
        assert_eq!(graph.summary.total_outputs, 3);
        assert_eq!(graph.summary.labeled_transactions, 1);
        assert_eq!(graph.summary.labeled_outputs, 1);
    }

    fn root_tx_view() -> TxView {
        let inputs = vec![
            regular_input(0, PARENT_TXID, 0),
            regular_input(1, MISSING_PARENT_TXID, 1),
        ];
        let outputs = vec![tx_output(0, 100_000), tx_output(1, 50_000)];

        TxView {
            txid: ROOT_TXID.to_string(),
            version: 2,
            lock_time: 0,
            inputs_count: inputs.len(),
            outputs,
            inputs,
            weight: 400,
            vsize: 100,
            is_coinbase: false,
            fee_sat: Some(1_000),
            feerate_sat_vb: Some(10.0),
            confirmations: Some(42),
            blockhash: Some(
                "1111111111111111111111111111111111111111111111111111111111111111".to_string(),
            ),
            block_height: Some(800_000),
            block_time: Some(1_700_000_000),
        }
    }

    fn parent_tx_view() -> TxView {
        let outputs = vec![tx_output(0, 150_000)];

        TxView {
            txid: PARENT_TXID.to_string(),
            version: 2,
            lock_time: 0,
            inputs_count: 0,
            outputs,
            inputs: Vec::new(),
            weight: 600,
            vsize: 150,
            is_coinbase: false,
            fee_sat: None,
            feerate_sat_vb: None,
            confirmations: Some(0),
            blockhash: None,
            block_height: None,
            block_time: None,
        }
    }

    fn regular_input(vin: u32, prev_txid: &str, prev_vout: u32) -> TxInpView {
        TxInpView {
            vin,
            prev_txid: prev_txid.to_string(),
            prev_vout,
            value_sat: Some(100_000),
            script_pubkey_hex: "0014deadbeef".to_string(),
            script_type: Some("p2wpkh".to_string()),
            script_sig_hex: String::new(),
            witness_items_count: 2,
            witness_hex: vec!["aa".to_string(), "bb".to_string()],
            is_coinbase: false,
        }
    }

    fn tx_output(vout: u32, value_sat: u64) -> TxOutView {
        TxOutView {
            vout,
            value_sat,
            script_pubkey_hex: "0014deadbeef".to_string(),
            script_type: Some("p2wpkh".to_string()),
            address: Some("bc1qexampleexampleexampleexampleexampleexample".to_string()),
        }
    }
}
