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

### Data Management sidebar workflows

After you run a graph search, the right rail shows a contextual `Data Management` sidebar:

- the sidebar is visible only after search
- selecting a transaction card switches the right rail to `Transaction Details`
- clearing transaction selection restores `Data Management`

`Data Management` supports:

- `Import Labels` (BIP-329 JSONL only)
  - choose a file with the native open dialog
  - apply immediately with a selected conflict policy
- `Export Labels` (BIP-329 JSONL)
  - save via native dialog
- `Export CSV`
  - save `transactions` or `outputs` reports for the current graph context

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

1. Run a search and confirm `Data Management` appears in the right rail.
2. Select any transaction card and confirm `Transaction Details` replaces `Data Management`.
3. Clear selection and confirm `Data Management` is restored.
4. In `Export CSV`, save both `transactions` and `outputs` reports through native dialogs.
5. In `Import Labels`, import a BIP-329 file and confirm graph state refreshes.
6. In `Export Labels`, export BIP-329 JSONL and confirm the success path is shown.

## Current status

The desktop app now includes:

- transaction graph inspection and detail views
- local label and classification editing
- native-dialog CSV reporting for the current graph
- right-rail BIP-329 data management workflows (import/export labels + CSV exports)
