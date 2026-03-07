mod error;

pub use error::{CoreError, Result};
pub mod api;
pub mod bip329;

pub mod model;
pub mod provenance;
pub mod reporting;
pub mod rpc;
pub mod store;
