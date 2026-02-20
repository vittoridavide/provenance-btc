use bitcoin::Txid;

use provenance_core::model::tx_parents::parent_txids_from_hex;

#[test]
fn extracts_unique_parent_txids_from_inputs() {
    // A minimal legacy tx with 3 inputs referencing two distinct parents:
    // - parent1 (0x11..11) appears twice
    // - parent2 (0x22..22) appears once
    // Output is irrelevant for this test (empty script, 0 value).
    let tx_hex = concat!(
        "01000000", // version
        "03",       // vin count
        // input 1 (parent1)
        "1111111111111111111111111111111111111111111111111111111111111111",
        "00000000", // vout
        "00",       // scriptSig len
        "ffffffff", // sequence
        // input 2 (parent2)
        "2222222222222222222222222222222222222222222222222222222222222222",
        "01000000", // vout
        "00",       // scriptSig len
        "ffffffff", // sequence
        // input 3 (parent1 again)
        "1111111111111111111111111111111111111111111111111111111111111111",
        "02000000",         // vout
        "00",               // scriptSig len
        "ffffffff",         // sequence
        "01",               // vout count
        "0000000000000000", // value
        "00",               // scriptPubKey len
        "00000000"          // lock_time
    );

    let parents = parent_txids_from_hex(tx_hex).expect("should decode tx hex");

    let parent1: Txid = "1111111111111111111111111111111111111111111111111111111111111111"
        .parse()
        .unwrap();
    let parent2: Txid = "2222222222222222222222222222222222222222222222222222222222222222"
        .parse()
        .unwrap();

    assert_eq!(parents, vec![parent1, parent2]);
}

#[test]
fn coinbase_tx_returns_empty_parent_list() {
    // Minimal legacy coinbase-like tx: null prevout (txid=0x00..00, vout=0xffffffff)
    let tx_hex = concat!(
        "01000000", // version
        "01",       // vin count
        "0000000000000000000000000000000000000000000000000000000000000000",
        "ffffffff",         // vout
        "00",               // scriptSig len
        "ffffffff",         // sequence
        "01",               // vout count
        "0000000000000000", // value
        "00",               // scriptPubKey len
        "00000000"          // lock_time
    );

    let parents = parent_txids_from_hex(tx_hex).expect("should decode tx hex");
    assert!(parents.is_empty());
}
