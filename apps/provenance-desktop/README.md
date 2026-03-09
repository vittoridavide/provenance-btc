# Provenance Desktop App

A Tauri-based desktop application for local-first Bitcoin provenance analysis.

## Development

### Prerequisites

- Node.js (v20.19+ or v22.12+)
- Rust (1.77.2+)
- Bitcoin Core with RPC enabled

### Bitcoin Core Configuration

The app now requires RPC setup in-app when it starts. The **Connect Bitcoin RPC** modal opens before graph data loads and must be completed once per launch.

- Enter your RPC URL (for example `http://127.0.0.1:8332`).
- Choose authentication mode:
  - `None`
  - `Username + Password`
- If you choose `None` and the endpoint is **not local/loopback**, the app shows a privacy warning and requires explicit acknowledgement before enabling **Connect**.
- Reopen this modal at any time from the top bar via **RPC Settings** to update connection parameters.

Make sure your `bitcoin.conf` has:

```
server=1
rpcuser=your_rpc_username
rpcpassword=your_rpc_password
```

If you connect to a public unauthenticated RPC endpoint, that server may log searched transactions and addresses.

### Import / Export workflows

The desktop UI routes report and BIP-329 actions through a dedicated `Import / Export` center:

- `Reports`
  - preview `transactions`, `outputs`, or `exceptions` CSV output for the current graph
  - show row counts, suggested filename, and warning summary before save
  - save through the native Tauri dialog plugin
- `BIP-329 Labels`
  - choose a file with the native open dialog
  - preview parsed counts, ambiguous supported-record warnings, and invalid lines
  - apply imports only after explicit confirmation and conflict-policy selection
  - export editable local labels plus preserved records as JSONL through the native save dialog

File contents are read and written in `src-tauri/src/main.rs`; the frontend only selects paths and manages UI state.

### Running the App

From the `apps/provenance-desktop` directory:

```bash
# Install dependencies (first time only)
npm install
cd frontend && npm install && cd ..

# Run in development mode
npm run tauri:dev
```

### Building

```bash
# Build for production
npm run tauri:build
```
### Manual smoke checklist

1. Open `Import / Export` from the top bar.
2. In `Reports`, preview each report kind and confirm save stays disabled when preview returns zero rows.
3. Save a report through the native dialog and confirm the success message shows the final path.
4. In `BIP-329 Labels`, preview an import before applying it and verify ambiguous or invalid records are surfaced.
5. Apply a label import and confirm graph and detail state refresh immediately.
6. Export labels through the native dialog and confirm export works even without a loaded graph.

## Current status

The desktop app now includes:

- transaction graph inspection and detail views
- local label and classification editing
- native-dialog CSV reporting for the current graph
- staged BIP-329 import/export workflows for label portability
