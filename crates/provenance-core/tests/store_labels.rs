use provenance_core::store::db::Database;
use provenance_core::store::labels;

fn memory_db() -> Database {
    Database::open(":memory:").expect("in-memory db")
}

#[test]
fn set_and_get_tx_label() {
    let db = memory_db();
    let conn = db.conn();

    let txid = "aabbccdd00000000000000000000000000000000000000000000000000000001";

    assert!(labels::get_label(conn, "tx", txid).unwrap().is_none());

    labels::set_label(conn, "tx", txid, "Vendor payment").unwrap();

    let label = labels::get_label(conn, "tx", txid)
        .unwrap()
        .expect("should exist");
    assert_eq!(label.ref_type, "tx");
    assert_eq!(label.ref_id, txid);
    assert_eq!(label.label, "Vendor payment");
    assert!(label.created_at > 0);
    assert_eq!(label.created_at, label.updated_at);
}

#[test]
fn set_and_get_output_label() {
    let db = memory_db();
    let conn = db.conn();

    let outpoint = "aabbccdd00000000000000000000000000000000000000000000000000000001:0";

    labels::set_label(conn, "output", outpoint, "Cold storage deposit").unwrap();

    let label = labels::get_label(conn, "output", outpoint)
        .unwrap()
        .expect("should exist");
    assert_eq!(label.ref_type, "output");
    assert_eq!(label.ref_id, outpoint);
    assert_eq!(label.label, "Cold storage deposit");
}

#[test]
fn upsert_updates_label_and_updated_at() {
    let db = memory_db();
    let conn = db.conn();

    let txid = "0000000000000000000000000000000000000000000000000000000000000099";

    labels::set_label(conn, "tx", txid, "first").unwrap();
    let v1 = labels::get_label(conn, "tx", txid).unwrap().unwrap();

    // Small sleep so unixepoch() can tick (if the machine is fast enough it
    // may stay the same — that's fine, we just check the label text changed).
    labels::set_label(conn, "tx", txid, "second").unwrap();
    let v2 = labels::get_label(conn, "tx", txid).unwrap().unwrap();

    assert_eq!(v2.label, "second");
    // created_at should be preserved
    assert_eq!(v1.created_at, v2.created_at);
    // updated_at >= original (may be equal if sub-second)
    assert!(v2.updated_at >= v1.updated_at);
}

#[test]
fn delete_label_removes_row() {
    let db = memory_db();
    let conn = db.conn();

    let txid = "0000000000000000000000000000000000000000000000000000000000000042";

    labels::set_label(conn, "tx", txid, "to delete").unwrap();
    assert!(labels::get_label(conn, "tx", txid).unwrap().is_some());

    let removed = labels::delete_label(conn, "tx", txid).unwrap();
    assert!(removed);

    assert!(labels::get_label(conn, "tx", txid).unwrap().is_none());

    // Deleting again returns false
    let removed_again = labels::delete_label(conn, "tx", txid).unwrap();
    assert!(!removed_again);
}

#[test]
fn get_labels_by_type_filters_correctly() {
    let db = memory_db();
    let conn = db.conn();

    labels::set_label(conn, "tx", "tx_aaa", "Label A").unwrap();
    labels::set_label(conn, "tx", "tx_bbb", "Label B").unwrap();
    labels::set_label(conn, "output", "tx_ccc:0", "Output label").unwrap();

    let tx_labels = labels::get_labels_by_type(conn, "tx").unwrap();
    assert_eq!(tx_labels.len(), 2);
    assert!(tx_labels.iter().all(|l| l.ref_type == "tx"));

    let out_labels = labels::get_labels_by_type(conn, "output").unwrap();
    assert_eq!(out_labels.len(), 1);
    assert_eq!(out_labels[0].ref_id, "tx_ccc:0");
}
