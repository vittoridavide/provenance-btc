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
         ORDER BY updated_at DESC",
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

/// Delete a label. Returns `true` if a row was actually removed.
pub fn delete_label(conn: &Connection, ref_type: &str, ref_id: &str) -> Result<bool> {
    let changed = conn.execute(
        "DELETE FROM labels WHERE ref_type = ?1 AND ref_id = ?2",
        params![ref_type, ref_id],
    )?;
    Ok(changed > 0)
}
