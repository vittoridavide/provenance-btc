// tests/rpc_indexinfo_parsing.rs
use provenance_core::rpc::indexinfo::parse_indexinfo;

#[test]
fn parses_txindex_true() {
    let v: serde_json::Value = serde_json::json!({
        "txindex": { "synced": true, "best_block_height": 100 }
    });
    let (tx, cs, bf) = parse_indexinfo(&v);
    assert_eq!(tx, Some(true));
    assert_eq!(cs, None);
    assert_eq!(bf, None);
}

#[test]
fn parses_blockfilter_basic() {
    let v: serde_json::Value = serde_json::json!({
        "basic": { "synced": false }
    });
    let (tx, cs, bf) = parse_indexinfo(&v);
    assert_eq!(bf, Some(false));
    assert_eq!(tx, None);
    assert_eq!(cs, None);
}

#[test]
fn missing_fields_are_none() {
    let v: serde_json::Value = serde_json::json!({});
    let (tx, cs, bf) = parse_indexinfo(&v);
    assert_eq!(tx, None);
    assert_eq!(cs, None);
    assert_eq!(bf, None);
}
