use std::cell::RefCell;
use std::collections::HashMap;

use bitcoin::Txid;

use provenance_core::provenance::trace::{trace_ancestry, TraceOptions};

fn txid(hex: &str) -> Txid {
    hex.parse().unwrap()
}

fn u32_le_hex(n: u32) -> String {
    n.to_le_bytes().iter().map(|b| format!("{b:02x}")).collect()
}

fn legacy_tx_hex(inputs: Vec<(Txid, u32)>, coinbase: bool) -> String {
    let mut s = String::new();

    s.push_str("01000000"); // version

    if coinbase {
        s.push_str("01"); // vin count
        s.push_str(&"00".repeat(32)); // null txid
        s.push_str("ffffffff"); // vout = 0xffffffff
        s.push_str("00"); // scriptSig len
        s.push_str("ffffffff"); // sequence
    } else {
        assert!(!inputs.is_empty());
        assert!(inputs.len() < 0xfd);
        s.push_str(&format!("{:02x}", inputs.len()));

        for (prev_txid, vout) in inputs {
            // NOTE: txid endianness in the raw tx doesn't matter for tests because our test txids
            // are repeated-byte patterns (aa.., bb.., ...), which are invariant under reversal.
            s.push_str(&prev_txid.to_string());
            s.push_str(&u32_le_hex(vout));
            s.push_str("00"); // scriptSig len
            s.push_str("ffffffff"); // sequence
        }
    }

    // one dummy output
    s.push_str("01");
    s.push_str("0000000000000000"); // value
    s.push_str("00"); // scriptPubKey len

    s.push_str("00000000"); // lock_time

    s
}

#[test]
fn traces_simple_chain_a_to_b_to_c() {
    let a = txid("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    let b = txid("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    let c = txid("cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc");

    let tx_a = legacy_tx_hex(vec![(b, 0)], false);
    let tx_b = legacy_tx_hex(vec![(c, 0)], false);
    let tx_c = legacy_tx_hex(vec![], true); // coinbase-like

    let map: HashMap<Txid, String> = HashMap::from([(a, tx_a), (b, tx_b), (c, tx_c)]);

    let fetch = |txid: &Txid| {
        map.get(txid)
            .cloned()
            .ok_or_else(|| provenance_core::CoreError::Other("missing fixture tx".into()))
    };

    let g = trace_ancestry(a, TraceOptions::new(10, 100), fetch).unwrap();

    assert_eq!(g.nodes.len(), 3);
    assert_eq!(g.nodes.get(&a).unwrap().parents, vec![b]);
    assert_eq!(g.nodes.get(&b).unwrap().parents, vec![c]);
    assert!(g.nodes.get(&c).unwrap().parents.is_empty());
}

#[test]
fn traces_full_ancestry_and_does_not_refetch_shared_parents() {
    let a = txid("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    let b = txid("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    let c = txid("cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc");
    let d = txid("dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd");

    // Diamond: A -> (B, C) -> D
    let tx_a = legacy_tx_hex(vec![(b, 0), (c, 0)], false);
    let tx_b = legacy_tx_hex(vec![(d, 0)], false);
    let tx_c = legacy_tx_hex(vec![(d, 1)], false);
    let tx_d = legacy_tx_hex(vec![], true); // coinbase-like

    let map: HashMap<Txid, String> = HashMap::from([(a, tx_a), (b, tx_b), (c, tx_c), (d, tx_d)]);

    let calls: RefCell<HashMap<Txid, usize>> = RefCell::new(HashMap::new());

    let fetch = |txid: &Txid| {
        *calls.borrow_mut().entry(*txid).or_insert(0) += 1;
        map.get(txid)
            .cloned()
            .ok_or_else(|| provenance_core::CoreError::Other("missing fixture tx".into()))
    };

    let g = trace_ancestry(a, TraceOptions::new(10, 100), fetch).unwrap();

    // All nodes present.
    assert_eq!(g.nodes.len(), 4);

    // D should only be fetched once even though it is referenced twice.
    assert_eq!(calls.borrow().get(&d).copied().unwrap_or(0), 1);
}

#[test]
fn max_depth_truncates_traversal() {
    let a = txid("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    let b = txid("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    let c = txid("cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc");
    let d = txid("dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd");

    let tx_a = legacy_tx_hex(vec![(b, 0), (c, 0)], false);
    let tx_b = legacy_tx_hex(vec![(d, 0)], false);
    let tx_c = legacy_tx_hex(vec![(d, 1)], false);
    let tx_d = legacy_tx_hex(vec![], true);

    let map: HashMap<Txid, String> = HashMap::from([(a, tx_a), (b, tx_b), (c, tx_c), (d, tx_d)]);

    let fetch = |txid: &Txid| {
        map.get(txid)
            .cloned()
            .ok_or_else(|| provenance_core::CoreError::Other("missing fixture tx".into()))
    };

    // max_depth=1: root (depth 0) is expanded, parents at depth 1 are present but not expanded.
    let g = trace_ancestry(a, TraceOptions::new(1, 100), fetch).unwrap();

    assert_eq!(g.nodes.len(), 3); // A, B, C (D not discovered because B/C aren't expanded)
    assert!(g.nodes.get(&b).unwrap().parents.is_empty());
    assert!(g.nodes.get(&c).unwrap().parents.is_empty());
}

#[test]
fn max_txs_exceeded_returns_error() {
    let a = txid("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    let b = txid("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    let c = txid("cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc");
    let d = txid("dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd");

    let tx_a = legacy_tx_hex(vec![(b, 0), (c, 0)], false);
    let tx_b = legacy_tx_hex(vec![(d, 0)], false);
    let tx_c = legacy_tx_hex(vec![(d, 1)], false);
    let tx_d = legacy_tx_hex(vec![], true);

    let map: HashMap<Txid, String> = HashMap::from([(a, tx_a), (b, tx_b), (c, tx_c), (d, tx_d)]);

    let fetch = |txid: &Txid| {
        map.get(txid)
            .cloned()
            .ok_or_else(|| provenance_core::CoreError::Other("missing fixture tx".into()))
    };

    let err = trace_ancestry(a, TraceOptions::new(10, 3), fetch).unwrap_err();
    let msg = err.to_string();
    assert!(msg.contains("max_txs"));
}
