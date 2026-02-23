use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::Result;

/// A persisted label attached to a transaction or output.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Label {
    pub ref_type: String,
    pub ref_id: String,
    pub label: String,
    /// Unix epoch seconds.
    pub created_at: i64,
    /// Unix epoch seconds.
    pub updated_at: i64,
}

/// Insert or update a label.
///
/// On conflict the existing `label` text and `updated_at` are overwritten;
/// `created_at` is preserved from the original insert.
pub fn set_label(conn: &Connection, ref_type: &str, ref_id: &str, label: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO labels (ref_type, ref_id, label, created_at, updated_at)
         VALUES (?1, ?2, ?3, unixepoch(), unixepoch())
         ON CONFLICT(ref_type, ref_id) DO UPDATE SET
           label      = excluded.label,
           updated_at = unixepoch()",
        params![ref_type, ref_id, label],
    )?;
    Ok(())
}

/// Fetch a single label, or `None` if it doesn't exist.
pub fn get_label(conn: &Connection, ref_type: &str, ref_id: &str) -> Result<Option<Label>> {
    conn.query_row(
        "SELECT ref_type, ref_id, label, created_at, updated_at
         FROM labels
         WHERE ref_type = ?1 AND ref_id = ?2",
        params![ref_type, ref_id],
        |row| {
            Ok(Label {
                ref_type: row.get(0)?,
                ref_id: row.get(1)?,
                label: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
            })
        },
    )
    .optional()
    .map_err(Into::into)
}

/// Return all labels of the given `ref_type` (`"tx"` or `"output"`).
pub fn get_labels_by_type(conn: &Connection, ref_type: &str) -> Result<Vec<Label>> {
    let mut stmt = conn.prepare(
        "SELECT ref_type, ref_id, label, created_at, updated_at
         FROM labels
         WHERE ref_type = ?1
         ORDER BY ref_id ASC",
    )?;

    let rows = stmt.query_map(params![ref_type], |row| {
        Ok(Label {
            ref_type: row.get(0)?,
            ref_id: row.get(1)?,
            label: row.get(2)?,
            created_at: row.get(3)?,
            updated_at: row.get(4)?,
        })
    })?;

    let mut labels = Vec::new();
    for row in rows {
        labels.push(row?);
    }
    Ok(labels)
}

/// Return all transaction labels.
pub fn get_tx_labels(conn: &Connection) -> Result<Vec<Label>> {
    get_labels_by_type(conn, "tx")
}

/// Return all output labels.
pub fn get_output_labels(conn: &Connection) -> Result<Vec<Label>> {
    get_labels_by_type(conn, "output")
}
/// Delete a label. Returns `true` if a row was actually removed.
pub fn delete_label(conn: &Connection, ref_type: &str, ref_id: &str) -> Result<bool> {
    let changed = conn.execute(
        "DELETE FROM labels WHERE ref_type = ?1 AND ref_id = ?2",
        params![ref_type, ref_id],
    )?;
    Ok(changed > 0)
}

#[cfg(test)]
mod tests {
    use crate::store::db::Database;

    use super::{get_output_labels, get_tx_labels, set_label};

    const TXID_A: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const TXID_B: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

    #[test]
    fn list_queries_return_correct_tx_and_output_sets() {
        let db = Database::open(":memory:").expect("db opens");
        let conn = db.conn();

        set_label(conn, "tx", TXID_B, "tx-b").expect("insert tx-b");
        set_label(conn, "output", &format!("{TXID_A}:1"), "out-1").expect("insert out-1");
        set_label(conn, "tx", TXID_A, "tx-a").expect("insert tx-a");
        set_label(conn, "output", &format!("{TXID_A}:0"), "out-0").expect("insert out-0");

        let tx_labels = get_tx_labels(conn).expect("query tx");
        let tx_refs: Vec<&str> = tx_labels
            .iter()
            .map(|label| label.ref_id.as_str())
            .collect();
        assert_eq!(tx_refs, vec![TXID_A, TXID_B]);
        assert!(tx_labels.iter().all(|label| label.ref_type == "tx"));

        let output_labels = get_output_labels(conn).expect("query output");
        let output_refs: Vec<String> = output_labels
            .iter()
            .map(|label| label.ref_id.clone())
            .collect();
        assert_eq!(
            output_refs,
            vec![format!("{TXID_A}:0"), format!("{TXID_A}:1")]
        );
        assert!(output_labels.iter().all(|label| label.ref_type == "output"));
    }
}
