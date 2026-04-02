<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="apps/provenance-desktop/frontend/src/assets/provenance-white.svg" />
    <img src="apps/provenance-desktop/frontend/src/assets/provenance.svg" alt="Provenance logo" width="160" />
  </picture>
</p>

<h1 align="center">Provenance</h1>

<p align="center">
  <strong>Turn Bitcoin transaction history into a structured business record.</strong>
</p>

---

Provenance is an open-source desktop application built with Rust and Tauri for people/businesses that need to trace fund history and label transactions and UTXOs.

Provenance is analysis-only (read-only) you can use it with a local bitcoin core or with the endpoint of one. It does not create, sign, or broadcast transactions.

## Why Provenance?

Provenance helps you:

- Trace the ancestry of transactions and UTXOs
- Reconstruct historical fund flows
- Label transactions and outputs with business meaning
- Maintain local records for internal review and documentation
- Analyze movement across wallets and systems
- Preserve confidentiality by working directly with your own node

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

## License

MIT License