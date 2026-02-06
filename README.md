# rpc-tester
[![Check chainlist RPCs](https://github.com/1delta-DAO/rpc-tester/actions/workflows/main.yml/badge.svg)](https://github.com/1delta-DAO/rpc-tester/actions/workflows/main.yml)

Checks RPC endpoints from [chainlist.org](https://chainlist.org) (connect + `eth_blockNumber`), writes per-chain JSON and a merged file.

## Usage

```bash
pnpm start
```

Pass extra options after `--`, e.g. `pnpm start -- --out=./rpcs`.

Output: `rpcs/<chainId>.json` per chain and `rpcs/all.json` with all chains in one file.

## Options

- `--chains-file=<path>` — text file with chain IDs (one per line or comma-separated)
- `--chains=1,137,56` — limit to these chain IDs
- `--out=./rpcs` — output directory (default: `./rpcs`)
- `--skip-existing` — skip chains that already have an output file
- `--batch=N` — number of batched calls  (default: 16)