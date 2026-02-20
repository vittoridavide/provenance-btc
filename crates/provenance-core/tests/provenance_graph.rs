use bitcoin::Txid;

use provenance_core::provenance::graph::ProvenanceGraph;

fn txid(hex: &str) -> Txid {
    hex.parse().unwrap()
}

#[test]
fn graph_can_be_built_incrementally_and_listed() {
    let a = txid("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    let b = txid("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    let c = txid("cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc");
    let d = txid("dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd");

    let mut g = ProvenanceGraph::new(a);
    g.set_parents(a, vec![c, b]); // intentionally out-of-order
    g.set_parents(b, vec![d]);
    g.set_parents(c, vec![d]);

    let list = g.to_ancestry_list();
    let txids: Vec<Txid> = list.iter().map(|e| e.txid).collect();

    // Deterministic BFS:
    // - root
    // - parents (sorted)
    // - grandparents...
    assert_eq!(txids, vec![a, b, c, d]);

    // Depth expectations.
    assert_eq!(list[0].depth, 0);
    assert_eq!(list[1].depth, 1);
    assert_eq!(list[2].depth, 1);
    assert_eq!(list[3].depth, 2);

    // Parents in entries are sorted for stable output.
    assert_eq!(list[0].parents, vec![b, c]);
}

#[test]
fn set_parents_dedups() {
    let a = txid("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    let b = txid("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");

    let mut g = ProvenanceGraph::new(a);
    g.set_parents(a, vec![b, b, b]);

    let list = g.to_ancestry_list();
    assert_eq!(list[0].parents, vec![b]);
}
