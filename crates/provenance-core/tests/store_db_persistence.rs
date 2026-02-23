use provenance_core::store::db::Database;
use provenance_core::store::labels;

/// Success-condition test for Phase 3:
/// Close app → reopen → labels persist.
#[test]
fn labels_persist_across_reopen() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("provenance.sqlite");
    let path_str = path.to_str().unwrap();

    let txid = "aabbccdd00000000000000000000000000000000000000000000000000000001";
    let outpoint = "aabbccdd00000000000000000000000000000000000000000000000000000001:2";

    // --- First session: write labels ---
    {
        let db = Database::open(path_str).unwrap();
        let conn = db.conn();

        labels::set_label(conn, "tx", txid, "Vendor invoice #42").unwrap();
        labels::set_label(conn, "output", outpoint, "Cold storage").unwrap();
    } // db dropped → connection closed

    // --- Second session: labels must still be there ---
    {
        let db = Database::open(path_str).unwrap();
        let conn = db.conn();

        let tx_label = labels::get_label(conn, "tx", txid)
            .unwrap()
            .expect("tx label should persist");
        assert_eq!(tx_label.label, "Vendor invoice #42");

        let out_label = labels::get_label(conn, "output", outpoint)
            .unwrap()
            .expect("output label should persist");
        assert_eq!(out_label.label, "Cold storage");
    }
}

/// Migration is idempotent: reopening an already-migrated DB doesn't fail.
#[test]
fn reopen_does_not_fail_on_existing_schema() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("provenance.sqlite");
    let path_str = path.to_str().unwrap();

    let _db1 = Database::open(path_str).unwrap();
    drop(_db1);
    let _db2 = Database::open(path_str).unwrap();
}
