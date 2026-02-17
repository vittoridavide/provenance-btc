# Provenance Desktop App

A Tauri-based desktop application for Bitcoin provenance analysis.

## Development

### Prerequisites

- Node.js (v20.19+ or v22.12+)
- Rust (1.77.2+)
- Bitcoin Core with RPC enabled

### Bitcoin Core Configuration

The app currently connects to Bitcoin Core RPC at `http://127.0.0.1:8332` with default credentials.

**Temporary Configuration**: The RPC credentials are currently hardcoded in `src-tauri/src/lib.rs`. For development, update the `get_chain_info()` function:

```rust
let config = RpcConfig {
    url: "http://127.0.0.1:8332".to_string(),
    auth: RpcAuth::UserPass {
        username: "your_rpc_username".to_string(),
        password: "your_rpc_password".to_string(),
    },
};
```

Make sure your `bitcoin.conf` has:

```
server=1
rpcuser=your_rpc_username
rpcpassword=your_rpc_password
```

**TODO**: Implement proper configuration management via settings UI or config file.

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

## Features

- Real-time Bitcoin chain status display
- Shows network type (mainnet/testnet/regtest/signet)
- Block height and sync progress
- Auto-refreshes every 10 seconds

## Current Status

This is a minimal implementation showing chain information. Future features will include:
- Transaction inspection
- Provenance graph visualization
- Label management
- BIP-329 import/export
- Reporting tools
