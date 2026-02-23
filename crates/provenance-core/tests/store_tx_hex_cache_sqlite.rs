use provenance_core::store::db::Database;
use provenance_core::store::tx_hex_cache::TxHexCache;

#[test]
fn tx_hex_cache_round_trip_in_memory() {
    let db = Database::open(":memory:").expect("should open in-memory db");
    let cache = TxHexCache::new(db.conn());

    let txid = "0000000000000000000000000000000000000000000000000000000000000001"
        .parse()
        .unwrap();

    assert!(cache.get(&txid).unwrap().is_none());

    cache.put(&txid, "deadbeef").unwrap();
    assert_eq!(cache.get(&txid).unwrap().as_deref(), Some("deadbeef"));
}

#[test]
fn tx_hex_cache_persists_between_reopens() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("provenance.sqlite");
    let path_str = path.to_str().unwrap();

    let txid = "0000000000000000000000000000000000000000000000000000000000000002"
        .parse()
        .unwrap();

    {
        let db = Database::open(path_str).unwrap();
        let cache = TxHexCache::new(db.conn());
        cache.put(&txid, "cafebabe").unwrap();
    }

    {
        let db = Database::open(path_str).unwrap();
        let cache = TxHexCache::new(db.conn());
        assert_eq!(cache.get(&txid).unwrap().as_deref(), Some("cafebabe"));
    }
}
