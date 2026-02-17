# AGENTS.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Repository status
This is an early-stage Rust workspace for a local-first Bitcoin provenance analysis tool. The README describes the intended product and architecture, but the implemented code is currently minimal scaffolding.

## Development commands
Run all commands from the repository root.

- Build workspace:
  - `cargo build --workspace`
- Check compilation without producing release artifacts:
  - `cargo check --workspace`
- Run tests:
  - `cargo test --workspace`
- Run a single test by exact name:
  - `cargo test --workspace <test_name>`
  - example: `cargo test --workspace parses_core_status`
- Run tests in one crate:
  - `cargo test -p provenance-core`
- Lint:
  - `cargo clippy --workspace --all-targets --all-features -- -D warnings`
- Format:
  - `cargo fmt --all`

## High-level architecture
The repository is organized as a Rust workspace (`Cargo.toml` at root) with one active member crate:

- `crates/provenance-core`: intended to contain domain logic for Bitcoin provenance analysis, independent of UI.
- `apps/provenance-desktop`: placeholder for a future Tauri desktop app (currently no implementation files).

The README defines the target architecture as:
- Core domain library for RPC access, provenance graphing, labeling, BIP-329 import/export, and reporting.
- Desktop frontend (Tauri) that should call into the core library.
- Local-first persistence model (SQLite) and no external API dependency.

## Current implemented module shape (provenance-core)
Inside `crates/provenance-core/src`, the currently implemented modules are:

- `error.rs`: shared `CoreError` enum and crate `Result<T>` alias.
- `rpc/types.rs`: serializable `CoreStatus` model for node/network/index status.
- `rpc/mod.rs`: RPC module entrypoint (declares submodules).
- `main.rs`: minimal executable entrypoint.

Important for future edits:
- `crates/provenance-core/Cargo.toml` declares a library target at `src/lib.rs`, but that file is not present yet.
- `src/rpc/mod.rs` declares `pub mod client;`, but `src/rpc/client.rs` is not present yet.

When adding functionality, align module declarations and manifest targets first (library vs binary layout), then build features on top.

## Source-of-truth documents
- Product scope and intended behavior: `README.md`
- Workspace/crate dependency and feature configuration: root `Cargo.toml` and `crates/provenance-core/Cargo.toml`
