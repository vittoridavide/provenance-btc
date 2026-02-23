mod types;
mod validate;

#[cfg(feature = "store-sqlite")]
mod export;
#[cfg(feature = "store-sqlite")]
mod import;

pub use types::Bip329Record;
pub use validate::{is_supported_type, validate_ref, ValidationError};

#[cfg(feature = "store-sqlite")]
pub use export::export_bip329_jsonl;
#[cfg(feature = "store-sqlite")]
pub use import::{import_bip329_jsonl, ImportErrorLine, ImportReport};

pub fn parse_record_line(line: &str) -> serde_json::Result<Bip329Record> {
    serde_json::from_str(line)
}
