<p align="center">
  <img src="apps/provenance-desktop/frontend/src/assets/provenance.svg" alt="Provenance logo" width="160" />
</p>

<h1 align="center">Provenance</h1>

<p align="center">
  Local-first Bitcoin capital analysis for businesses.<br/>
  Turn opaque UTXOs into structured, accountable financial assets.
</p>

---

Provenance is an open-source desktop application built with **Rust + Tauri** that allows business owners to reconstruct coin history, label transactions and UTXOs, and generate audit-ready provenance reports — without leaking data to third parties.

This tool is **analysis-only** (read-only). It does not create or broadcast transactions.

## Why Provenance?

Bitcoin wallets abstract away UTXOs.
Businesses need financial clarity.

Provenance helps you:

* Understand where funds came from
* Reconstruct historical context
* Label transactions and outputs with business meaning
* Prepare documentation for tax authorities or auditors
* Analyze how funds move across wallets and systems
* Maintain sovereignty by working entirely with your local Bitcoin node

This is not a block explorer.
This is a capital reconstruction tool.

## Features (Phase 1)

### Transaction & UTXO Inspection

* Inspect by `txid` or `txid:vout`
* Recursive ancestry tracing (configurable depth)
* Fee, feerate, vsize calculation
* Script type decoding
* Confirmation and block metadata

### Provenance Graph

* Expandable ancestry view
* Focus on specific UTXO paths
* Depth-limited traversal for performance

### Labeling & Reconstruction

* Label transactions
* Label individual outputs (UTXOs)
* Add notes for accounting context
* Bulk labeling support
* Local persistence (SQLite)

### BIP-329 Support

* Preview wallet label imports before applying them locally
* Apply editable local state for `tx` and `output` labels
* Preserve unsupported or ambiguous records for round-trip export when possible
* Export labels for portability

### Reporting

* CSV export of the current graph as `transactions`, `outputs`, or `exceptions`
* Preview row counts, suggested filenames, and data-quality warnings before saving
* Structured provenance report generation without exporting internal notes

### Local-First Architecture

* Connects directly to your Bitcoin Core node
* No external block explorer calls
* No telemetry
* No cloud dependency

## Requirements

* Bitcoin Core with RPC enabled
* Recommended:

    * `txindex=1` for full historical lookup
    * Non-pruned node (or ensure relevant blocks are available)

Example `bitcoin.conf`:

```
server=1
txindex=1
rpcuser=youruser
rpcpassword=yourpassword
```

## Security & Privacy Model

* Provenance never broadcasts transactions.
* All blockchain data is fetched directly from your node.
* All labels and metadata are stored locally.
* No external APIs are called.

This tool is designed to preserve business confidentiality.

## Architecture

* Rust core library (`provenance-core`)

    * Bitcoin Core RPC client
    * Provenance graph builder
    * Label store (SQLite)
    * BIP-329 parser/exporter
    * Reporting engine
* Tauri desktop frontend
* Local SQLite database for caching and metadata

The core logic is UI-agnostic and reusable.

## Desktop import/export workflows

The desktop app exposes a native `Import / Export` center:

* `Reports` previews graph-scoped CSV exports before saving them through the operating system file dialog.
* `BIP-329 Labels` previews imports before apply, supports explicit conflict policies, and preserves unsupported records for round-trip export when possible.
* File selection happens in the frontend, while file reading and writing stays in the Rust/Tauri layer.

## Project Status

Phase 1: Analysis & Reconstruction

* [x] Bitcoin Core RPC connectivity
* [ ] Transaction inspection
* [ ] Recursive ancestry tracing
* [ ] Local label storage
* [ ] CSV export
* [ ] Multi-wallet session overlay
* [ ] Advanced visualization polish

## Non-Goals (Phase 1)

* No transaction signing
* No PSBT creation
* No automatic coin selection
* No Lightning support
* No cloud sync

Spending assistance and policy guardrails are planned for later phases.

## License

MIT License

## Contributing

Contributions are welcome.

If you’re interested in:

* Improving provenance visualization
* Enhancing BIP-329 compatibility
* Adding advanced reporting
* Improving performance on large ancestry graphs

Open an issue or submit a pull request.