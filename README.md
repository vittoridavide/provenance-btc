<p align="center">
  <img src="apps/provenance-desktop/frontend/src/assets/provenance.svg" alt="Provenance logo" width="160" />
</p>

<h1 align="center">Provenance</h1>

<p align="center">
  <strong>Turn Bitcoin transaction history into a structured business record.</strong>
</p>

---

Provenance is an open-source desktop application built with Rust and Tauri for businesses that need to trace fund history, label transactions and UTXOs with business context, and preserve that knowledge locally for accounting, treasury, and audit workflows.

It helps transform opaque UTXOs into understandable, accountable financial records without sending sensitive data to third parties.

Provenance is analysis-only (read-only). It does not create, sign, or broadcast transactions.

## Why Provenance?

Bitcoin wallets are optimized for spending and balance tracking, not for explaining the financial meaning of coin history.

Businesses need more than raw transaction data. They need to answer questions like:

- Where did these funds come from?
- Was this customer revenue, an internal transfer, treasury consolidation, a refund, or a supplier payment?
- Which outputs belong to which business purpose?
- How can this history be documented later for accounting, tax, or audit review?

Provenance helps you:

- Trace the ancestry of transactions and UTXOs
- Reconstruct historical fund flows
- Label transactions and outputs with business meaning
- Maintain local records for internal review and documentation
- Analyze movement across wallets and systems
- Preserve confidentiality by working directly with your own node

This is not a block explorer. It is a Bitcoin capital reconstruction and classification tool.

## Features (Phase 1)

### Transaction and UTXO Inspection

- Inspect by `txid` or `txid:vout`
- Recursive ancestry tracing with configurable depth
- Fee, feerate, and vsize calculation
- Script type decoding
- Confirmation status and block metadata

### Provenance Graph

- Expandable ancestry view
- Focus on specific UTXO paths
- Depth-limited traversal for performance and control

### Labeling and Reconstruction

- Label transactions
- Label individual outputs (UTXOs)
- Add notes for accounting and operational context
- Bulk labeling support
- Local persistence with SQLite

### BIP-329 Support

- Preview wallet label imports before applying them locally
- Apply editable local state for transaction and output labels
- Preserve unsupported or ambiguous records for round-trip export when possible
- Export labels for portability

### Reporting

- Export graph-scoped CSV reports for transactions, outputs, or exceptions
- Preview row counts, suggested filenames, and data-quality warnings before saving
- Generate structured provenance reports for internal review, accounting support, and audit preparation without exporting internal notes

### Local-First Architecture

- Connect directly to your local Bitcoin Core node for maximum privacy
- External RPC backends are also supported for convenience and faster setup
- No telemetry
- No cloud dependency

## RPC Options and Privacy Tradeoffs

Provenance supports both local and external RPC backends.

For maximum privacy, use your own local Bitcoin Core node. This keeps transaction and UTXO lookups within your own infrastructure.

External RPC backends are also supported for convenience and faster setup. However, using an external provider may expose transaction queries, requested history, and access patterns to that provider. If confidentiality matters, a local node is strongly recommended.

## Requirements

Bitcoin Core with RPC enabled.

Recommended:

- `txindex=1` for full historical lookup
- A non-pruned node, or access to all relevant historical blocks

Example `bitcoin.conf`:

```ini
server=1
txindex=1
rpcuser=youruser
rpcpassword=yourpassword
```

## Security & Privacy Model

* Provenance never broadcasts transactions
* When connected to a local node, blockchain data is fetched directly from your own Bitcoin Core instance
* Labels and metadata are stored locally
* No telemetry or cloud dependency
* If you choose to use an external RPC provider, transaction queries and access patterns may be visible to that provider

This tool is designed to preserve operational confidentiality for businesses working with Bitcoin while allowing a practical tradeoff between convenience and privacy.

## Architecture

### Rust Core Library (`provenance-core`)

* Bitcoin Core RPC client
* Provenance graph builder
* Label store (SQLite)
* BIP-329 parser and exporter
* Reporting engine

### Tauri Desktop Frontend

* Native desktop interface
* Import and export workflows
* Local SQLite database for caching and metadata

The core logic is UI-agnostic and reusable.

## Import / Export Workflows

The desktop app exposes a native Import / Export center:

### Reports

* Preview graph-scoped CSV exports before saving through the operating system file dialog

### BIP-329 Labels

* Preview imports before apply
* Support explicit conflict policies
* Preserve unsupported records for round-trip export when possible

File selection happens in the frontend, while file reading and writing stay in the Rust / Tauri layer.

## Project Status

### Phase 1: Analysis & Reconstruction

* [x] Bitcoin Core RPC connectivity
* [x] Transaction inspection
* [x] Recursive ancestry tracing
* [x] Local label storage
* [x] CSV export
* [x] Address search
* [ ] Multi-wallet session overlay

## License

MIT License