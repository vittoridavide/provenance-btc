use rusqlite::Connection;

use crate::Result;

/// Current schema version. Bump this and add a migration branch
/// in `run_migrations` whenever the schema changes.
const LATEST_VERSION: u32 = 3;

/// Single entry-point for all SQLite access.
///
/// Opens (or creates) the database file at the given path, runs any
/// outstanding migrations, and exposes `&Connection` for sub-stores.
#[derive(Debug)]
pub struct Database {
    conn: Connection,
}

impl Database {
    /// Open an existing database or create a new one at `path`.
    ///
    /// Pass `":memory:"` for an ephemeral in-memory database (tests).
    pub fn open(path: &str) -> Result<Self> {
        let conn = Connection::open(path)?;
        // WAL mode gives better concurrent-read performance and is
        // crash-safe. Harmless on in-memory databases.
        conn.execute_batch("PRAGMA journal_mode = WAL;")?;
        run_migrations(&conn)?;
        Ok(Self { conn })
    }

    /// Borrow the underlying connection so sub-stores can run queries.
    pub fn conn(&self) -> &Connection {
        &self.conn
    }
}

// ---------------------------------------------------------------------------
// Migrations
// ---------------------------------------------------------------------------

fn current_version(conn: &Connection) -> Result<u32> {
    let v: u32 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;
    Ok(v)
}

fn set_version(conn: &Connection, version: u32) -> Result<()> {
    // PRAGMA doesn't support parameter binding, so we use format!.
    // `version` is a u32 — no injection risk.
    conn.pragma_update(None, "user_version", version)?;
    Ok(())
}

/// v2 → v3: create `bip329_records` table.
fn migrate_to_v3(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS bip329_records (
            record_type         TEXT    NOT NULL,
            record_ref          TEXT    NOT NULL,
            origin_key          TEXT    NOT NULL DEFAULT '',
            payload_json        TEXT    NOT NULL,
            raw_json            TEXT    NOT NULL,
            tracks_local_label  INTEGER NOT NULL DEFAULT 0 CHECK(tracks_local_label IN (0,1)),
            created_at          INTEGER NOT NULL DEFAULT (unixepoch()),
            updated_at          INTEGER NOT NULL DEFAULT (unixepoch()),
            PRIMARY KEY (record_type, record_ref, origin_key)
        );

        CREATE INDEX IF NOT EXISTS idx_bip329_records_lookup
            ON bip329_records(record_type, record_ref);",
    )?;
    Ok(())
}

/// v1 → v2: create `classifications` table.
fn migrate_to_v2(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS classifications (
            ref_type     TEXT    NOT NULL CHECK(ref_type IN ('tx','output')),
            ref_id       TEXT    NOT NULL,
            category     TEXT    NOT NULL,
            context      TEXT,
            metadata     TEXT    NOT NULL DEFAULT '{}',
            tax_relevant INTEGER NOT NULL DEFAULT 0 CHECK(tax_relevant IN (0,1)),
            created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
            updated_at   INTEGER NOT NULL DEFAULT (unixepoch()),
            PRIMARY KEY (ref_type, ref_id)
        );

        CREATE INDEX IF NOT EXISTS idx_classifications_ref_type
            ON classifications(ref_type);",
    )?;
    Ok(())
}

fn run_migrations(conn: &Connection) -> Result<()> {
    let current = current_version(conn)?;

    if current < 1 {
        migrate_to_v1(conn)?;
    }
    if current < 2 {
        migrate_to_v2(conn)?;
    }
    if current < 3 {
        migrate_to_v3(conn)?;
    }

    if current < LATEST_VERSION {
        set_version(conn, LATEST_VERSION)?;
    }

    Ok(())
}

/// v0 → v1: create `tx_hex_cache` and `labels` tables.
fn migrate_to_v1(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS tx_hex_cache (
            txid TEXT PRIMARY KEY,
            hex  TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS labels (
            ref_type   TEXT    NOT NULL CHECK(ref_type IN ('tx','output')),
            ref_id     TEXT    NOT NULL,
            label      TEXT    NOT NULL,
            created_at INTEGER NOT NULL DEFAULT (unixepoch()),
            updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
            PRIMARY KEY (ref_type, ref_id)
        );

        CREATE INDEX IF NOT EXISTS idx_labels_ref_type ON labels(ref_type);",
    )?;
    Ok(())
}
