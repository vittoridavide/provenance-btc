use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use crate::bip329::Bip329Record;
use crate::{CoreError, Result};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct StoredBip329Record {
    pub record_type: String,
    pub record_ref: String,
    pub origin_key: String,
    pub payload_json: String,
    pub raw_json: String,
    pub tracks_local_label: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

impl StoredBip329Record {
    pub fn payload(&self) -> Result<Bip329Record> {
        serde_json::from_str(&self.payload_json).map_err(|err| {
            CoreError::Other(format!(
                "failed to deserialize stored BIP-329 record {} {}: {err}",
                self.record_type, self.record_ref
            ))
        })
    }
}

pub fn upsert_record(
    conn: &Connection,
    record: &Bip329Record,
    raw_json: &str,
    tracks_local_label: bool,
) -> Result<()> {
    let payload_json = record.to_json_line()?;

    conn.execute(
        "INSERT INTO bip329_records (
            record_type,
            record_ref,
            origin_key,
            payload_json,
            raw_json,
            tracks_local_label,
            created_at,
            updated_at
         ) VALUES (
            ?1, ?2, ?3, ?4, ?5, ?6, unixepoch(), unixepoch()
         )
         ON CONFLICT(record_type, record_ref, origin_key) DO UPDATE SET
            payload_json        = excluded.payload_json,
            raw_json            = excluded.raw_json,
            tracks_local_label  = excluded.tracks_local_label,
            updated_at          = unixepoch()",
        params![
            &record.r#type,
            &record.r#ref,
            record.origin_key(),
            payload_json,
            raw_json.trim(),
            i64::from(tracks_local_label),
        ],
    )?;

    Ok(())
}

pub fn get_records_by_ref(
    conn: &Connection,
    record_type: &str,
    record_ref: &str,
) -> Result<Vec<StoredBip329Record>> {
    let mut stmt = conn.prepare(
        "SELECT record_type, record_ref, origin_key, payload_json, raw_json, tracks_local_label,
                created_at, updated_at
         FROM bip329_records
         WHERE record_type = ?1 AND record_ref = ?2
         ORDER BY origin_key ASC",
    )?;

    let rows = stmt.query_map(params![record_type, record_ref], row_to_record)?;
    let mut records = Vec::new();
    for row in rows {
        records.push(row?);
    }

    Ok(records)
}

pub fn list_records(conn: &Connection) -> Result<Vec<StoredBip329Record>> {
    let mut stmt = conn.prepare(
        "SELECT record_type, record_ref, origin_key, payload_json, raw_json, tracks_local_label,
                created_at, updated_at
         FROM bip329_records
         ORDER BY record_type ASC, record_ref ASC, origin_key ASC",
    )?;

    let rows = stmt.query_map([], row_to_record)?;
    let mut records = Vec::new();
    for row in rows {
        records.push(row?);
    }

    Ok(records)
}

fn row_to_record(row: &rusqlite::Row<'_>) -> rusqlite::Result<StoredBip329Record> {
    Ok(StoredBip329Record {
        record_type: row.get(0)?,
        record_ref: row.get(1)?,
        origin_key: row.get(2)?,
        payload_json: row.get(3)?,
        raw_json: row.get(4)?,
        tracks_local_label: row.get::<_, i64>(5)? != 0,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
    })
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use serde_json::json;

    use crate::store::db::Database;

    use super::{get_records_by_ref, list_records, upsert_record};

    #[test]
    fn upsert_persists_payload_and_origin_key() {
        let db = Database::open(":memory:").expect("db opens");
        let record = crate::bip329::Bip329Record {
            r#type: "tx".to_owned(),
            r#ref: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".to_owned(),
            label: Some("salary".to_owned()),
            origin: Some("wallet".to_owned()),
            spendable: None,
            extra: BTreeMap::from([(String::from("foo"), json!(1))]),
        };

        upsert_record(db.conn(), &record, r#"{"type":"tx"}"#, true).expect("store succeeds");

        let stored = get_records_by_ref(db.conn(), "tx", &record.r#ref).expect("query succeeds");
        assert_eq!(stored.len(), 1);
        assert_eq!(stored[0].origin_key, "wallet");
        assert!(stored[0].tracks_local_label);
        assert_eq!(stored[0].payload().expect("payload parses"), record);
        assert_eq!(list_records(db.conn()).expect("list succeeds").len(), 1);
    }
}
