use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{CoreError, Result};

/// A persisted classification attached to a transaction or output.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct StoredClassification {
    pub ref_type: String,
    pub ref_id: String,
    pub category: String,
    pub context: Option<String>,
    pub metadata: Value,
    pub tax_relevant: bool,
    /// Unix epoch seconds.
    pub created_at: i64,
    /// Unix epoch seconds.
    pub updated_at: i64,
}

/// Insert or update a classification record.
pub fn set_classification(
    conn: &Connection,
    ref_type: &str,
    ref_id: &str,
    category: &str,
    context: Option<&str>,
    metadata: &Value,
    tax_relevant: bool,
) -> Result<()> {
    let metadata_json = serde_json::to_string(metadata)
        .map_err(|e| CoreError::Other(format!("failed to serialize metadata json: {e}")))?;

    conn.execute(
        "INSERT INTO classifications (
            ref_type, ref_id, category, context, metadata, tax_relevant, created_at, updated_at
         ) VALUES (
            ?1, ?2, ?3, ?4, ?5, ?6, unixepoch(), unixepoch()
         )
         ON CONFLICT(ref_type, ref_id) DO UPDATE SET
            category     = excluded.category,
            context      = excluded.context,
            metadata     = excluded.metadata,
            tax_relevant = excluded.tax_relevant,
            updated_at   = unixepoch()",
        params![
            ref_type,
            ref_id,
            category,
            context,
            metadata_json,
            i64::from(tax_relevant)
        ],
    )?;

    Ok(())
}

/// Fetch one classification by `(ref_type, ref_id)`.
pub fn get_classification(
    conn: &Connection,
    ref_type: &str,
    ref_id: &str,
) -> Result<Option<StoredClassification>> {
    conn.query_row(
        "SELECT ref_type, ref_id, category, context, metadata, tax_relevant, created_at, updated_at
         FROM classifications
         WHERE ref_type = ?1 AND ref_id = ?2",
        params![ref_type, ref_id],
        row_to_classification,
    )
    .optional()
    .map_err(Into::into)
}

/// Fetch all classifications for a given `ref_type` (`tx` or `output`).
pub fn get_classifications_by_type(
    conn: &Connection,
    ref_type: &str,
) -> Result<Vec<StoredClassification>> {
    let mut stmt = conn.prepare(
        "SELECT ref_type, ref_id, category, context, metadata, tax_relevant, created_at, updated_at
         FROM classifications
         WHERE ref_type = ?1
         ORDER BY ref_id ASC",
    )?;

    let rows = stmt.query_map(params![ref_type], row_to_classification)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

/// Fetch all classifications (all types).
pub fn get_all_classifications(conn: &Connection) -> Result<Vec<StoredClassification>> {
    let mut stmt = conn.prepare(
        "SELECT ref_type, ref_id, category, context, metadata, tax_relevant, created_at, updated_at
         FROM classifications
         ORDER BY ref_type ASC, ref_id ASC",
    )?;

    let rows = stmt.query_map([], row_to_classification)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

fn row_to_classification(row: &rusqlite::Row<'_>) -> rusqlite::Result<StoredClassification> {
    let metadata_str: String = row.get(4)?;
    let metadata = serde_json::from_str(&metadata_str).map_err(|e| {
        rusqlite::Error::FromSqlConversionFailure(
            metadata_str.len(),
            rusqlite::types::Type::Text,
            Box::new(e),
        )
    })?;

    Ok(StoredClassification {
        ref_type: row.get(0)?,
        ref_id: row.get(1)?,
        category: row.get(2)?,
        context: row.get(3)?,
        metadata,
        tax_relevant: row.get::<_, i64>(5)? != 0,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
    })
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use crate::store::db::Database;

    use super::{get_all_classifications, get_classification, set_classification};

    const TXID_A: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const TXID_B: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

    #[test]
    fn set_and_get_classification_roundtrip() {
        let db = Database::open(":memory:").expect("db opens");
        let conn = db.conn();

        set_classification(
            conn,
            "tx",
            TXID_A,
            "Revenue",
            Some("monthly income"),
            &json!({"invoice_id": 1234}),
            true,
        )
        .expect("set classification");

        let stored = get_classification(conn, "tx", TXID_A)
            .expect("query works")
            .expect("classification exists");

        assert_eq!(stored.category, "Revenue");
        assert_eq!(stored.context.as_deref(), Some("monthly income"));
        assert_eq!(stored.metadata["invoice_id"], 1234);
        assert!(stored.tax_relevant);
    }

    #[test]
    fn upsert_overwrites_data_and_preserves_single_row() {
        let db = Database::open(":memory:").expect("db opens");
        let conn = db.conn();

        set_classification(
            conn,
            "tx",
            TXID_A,
            "Revenue",
            Some("old"),
            &json!({"version": 1}),
            true,
        )
        .expect("insert");
        set_classification(
            conn,
            "tx",
            TXID_A,
            "Internal Transfer",
            Some("new"),
            &json!({"version": 2}),
            false,
        )
        .expect("update");

        let stored = get_classification(conn, "tx", TXID_A)
            .expect("query works")
            .expect("classification exists");
        assert_eq!(stored.category, "Internal Transfer");
        assert_eq!(stored.context.as_deref(), Some("new"));
        assert_eq!(stored.metadata["version"], 2);
        assert!(!stored.tax_relevant);

        let all = get_all_classifications(conn).expect("list works");
        assert_eq!(all.len(), 1);
    }

    #[test]
    fn list_all_returns_sorted_rows() {
        let db = Database::open(":memory:").expect("db opens");
        let conn = db.conn();

        set_classification(conn, "tx", TXID_B, "Revenue", None, &json!({}), false)
            .expect("insert tx b");
        set_classification(
            conn,
            "output",
            &format!("{TXID_A}:0"),
            "Expense",
            None,
            &json!({}),
            true,
        )
        .expect("insert output");
        set_classification(conn, "tx", TXID_A, "Revenue", None, &json!({}), false)
            .expect("insert tx a");

        let rows = get_all_classifications(conn).expect("list works");
        let refs: Vec<(String, String)> = rows
            .into_iter()
            .map(|row| (row.ref_type, row.ref_id))
            .collect();

        assert_eq!(
            refs,
            vec![
                ("output".to_owned(), format!("{TXID_A}:0")),
                ("tx".to_owned(), TXID_A.to_owned()),
                ("tx".to_owned(), TXID_B.to_owned()),
            ]
        );
    }
}
