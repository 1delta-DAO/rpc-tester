# rpc-tester
[![Check chainlist RPCs](https://github.com/1delta-DAO/rpc-tester/actions/workflows/main.yml/badge.svg)](https://github.com/1delta-DAO/rpc-tester/actions/workflows/main.yml)

Checks RPC endpoints from [chainlist.org](https://chainlist.org) (connect + `eth_blockNumber`), writes per-chain JSON and a merged file.

## Usage

Use Node.js 24 and the pnpm version declared in `package.json`. Install locked
dependencies and compile before running:

```bash
pnpm install --frozen-lockfile
pnpm build
```

```bash
pnpm start
```

Pass extra options after `--`, e.g. `pnpm start -- --out=./rpcs`.

Output: `rpcs/<chainId>.json` per chain and `rpcs/all.json` with all chains in one file.

## Options

- `--chains-file=<path>` — text file with chain IDs (one per line or comma-separated)
- `--chains=1,137,56` — limit to these chain IDs
- `--out=./rpcs` — output directory (default: `./rpcs`)
- `--skip-existing` — reuse existing chain results, removing rejected credential-shaped URLs from both the per-chain and merged output
- `--batch=N` — number of batched calls  (default: 16)

## Published endpoint safety

Generated lists reject URL user/password credentials, fragments, query parameters
other than short `owner` routing identifiers, and long key-shaped path segments.
The same filter applies to cached results. This is a preventive heuristic, not a
guarantee that every accepted URL is unauthenticated; review provider-specific
endpoint formats before publishing them.

The previously committed RPCFast API-key URL has been removed from current
outputs. Its provider owner must still revoke or rotate the exposed key and
review usage. Source removal does not revoke credentials; historical Git copies
remain under the no-history-rewrite policy.

The HTTP client is locked to a patched Undici 7 release. Verification covered
TypeScript compilation, a clean dependency audit, live read-only Ethereum RPC
probes, and cached-output filtering of synthetic query, userinfo and path keys.
The regeneration job retains `contents: write` only at job scope because it
commits refreshed lists; external actions are pinned to immutable commits.