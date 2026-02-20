use bitcoin::Txid;
use rusqlite::{params, Connection, OptionalExtension};

use crate::Result;

/// Tiny SQLite-backed cache for raw transaction hex.
#[derive(Debug)]
pub struct TxHexCache {
    conn: Connection,
}

impl TxHexCache {
    pub fn open(path: &str) -> Result<Self> {
        let conn = Connection::open(path)?;
        Self::init(&conn)?;
        Ok(Self { conn })
    }

    fn init(conn: &Connection) -> Result<()> {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS tx_hex_cache (\
                txid TEXT PRIMARY KEY,\
                hex  TEXT NOT NULL\
            );",
        )?;
        Ok(())
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
        // Upsert so repeated fetches just refresh the value.
        self.conn.execute(
            "INSERT INTO tx_hex_cache (txid, hex) VALUES (?1, ?2)\
             ON CONFLICT(txid) DO UPDATE SET hex = excluded.hex",
            params![txid.to_string(), hex],
        )?;
        Ok(())
    }
}
