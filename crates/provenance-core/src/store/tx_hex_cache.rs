use bitcoin::Txid;
use rusqlite::{params, Connection, OptionalExtension};

use crate::Result;

/// Thin query helper for the `tx_hex_cache` table.
///
/// The table itself is created by [`super::db::Database`] migrations.
/// This struct just borrows a `&Connection` and runs queries against it.
pub struct TxHexCache<'a> {
    conn: &'a Connection,
}

impl<'a> TxHexCache<'a> {
    pub fn new(conn: &'a Connection) -> Self {
        Self { conn }
    }

    pub fn get(&self, txid: &Txid) -> Result<Option<String>> {
        self.conn
            .query_row(
                "SELECT hex FROM tx_hex_cache WHERE txid = ?1",
                params![txid.to_string()],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(Into::into)
    }

    pub fn put(&self, txid: &Txid, hex: &str) -> Result<()> {
        self.conn.execute(
            "INSERT INTO tx_hex_cache (txid, hex) VALUES (?1, ?2)
             ON CONFLICT(txid) DO UPDATE SET hex = excluded.hex",
            params![txid.to_string(), hex],
        )?;
        Ok(())
    }
}
