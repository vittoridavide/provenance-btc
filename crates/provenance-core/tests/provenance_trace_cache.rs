use std::cell::RefCell;
use std::collections::HashMap;

use bitcoin::Txid;

use provenance_core::provenance::trace::{
    trace_ancestry_cache_first, TraceOptions, TxHexCacheMetrics,
};
use provenance_core::store::tx_hex_cache::TxHexCache;

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
            // For repeated-byte txids (aa.., bb..), endianness doesn't affect the string.
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
fn second_trace_uses_cache_instead_of_remote_fetch() {
    let a = txid("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    let b = txid("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    let c = txid("cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc");
    let d = txid("dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd");

    // Diamond: A -> (B, C) -> D
    let tx_a = legacy_tx_hex(vec![(b, 0), (c, 0)], false);
    let tx_b = legacy_tx_hex(vec![(d, 0)], false);
    let tx_c = legacy_tx_hex(vec![(d, 1)], false);
    let tx_d = legacy_tx_hex(vec![], true);

    let fixtures: HashMap<Txid, String> =
        HashMap::from([(a, tx_a), (b, tx_b), (c, tx_c), (d, tx_d)]);

    let cache = TxHexCache::open(":memory:").unwrap();

    let remote_calls: RefCell<u64> = RefCell::new(0);
    let remote = |txid: &Txid| {
        *remote_calls.borrow_mut() += 1;
        fixtures
            .get(txid)
            .cloned()
            .ok_or_else(|| provenance_core::CoreError::Other("missing fixture tx".into()))
    };

    // First trace: cache empty => all misses and remote is called.
    let mut m1 = TxHexCacheMetrics::default();
    let _g1 =
        trace_ancestry_cache_first(a, TraceOptions::new(10, 100), &cache, remote, Some(&mut m1))
            .unwrap();

    assert_eq!(*remote_calls.borrow(), 4);
    assert_eq!(m1.hits, 0);
    assert_eq!(m1.misses, 4);

    // Second trace: should be fully served by cache (no new remote calls).
    let remote2_calls: RefCell<u64> = RefCell::new(0);
    let remote2 = |txid: &Txid| {
        *remote2_calls.borrow_mut() += 1;
        fixtures
            .get(txid)
            .cloned()
            .ok_or_else(|| provenance_core::CoreError::Other("missing fixture tx".into()))
    };

    let mut m2 = TxHexCacheMetrics::default();
    let _g2 = trace_ancestry_cache_first(
        a,
        TraceOptions::new(10, 100),
        &cache,
        remote2,
        Some(&mut m2),
    )
    .unwrap();

    assert_eq!(*remote2_calls.borrow(), 0);
    assert_eq!(m2.hits, 4);
    assert_eq!(m2.misses, 0);
}
