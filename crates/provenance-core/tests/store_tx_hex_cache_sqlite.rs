use provenance_core::store::tx_hex_cache::TxHexCache;

#[test]
fn tx_hex_cache_round_trip_in_memory() {
    let cache = TxHexCache::open(":memory:").expect("should open in-memory db");

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
    let path = dir.path().join("cache.sqlite");
    let path_str = path.to_str().unwrap();

    let txid = "0000000000000000000000000000000000000000000000000000000000000002"
        .parse()
        .unwrap();

    {
        let cache = TxHexCache::open(path_str).unwrap();
        cache.put(&txid, "cafebabe").unwrap();
    }

    {
        let cache2 = TxHexCache::open(path_str).unwrap();
        assert_eq!(cache2.get(&txid).unwrap().as_deref(), Some("cafebabe"));
    }
}
