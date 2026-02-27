# @plawio/polymarket-veto-mcp

Guarded MCP sidecar for Polymarket CLI powered by Veto.

Tagline: **Polymarket CLI, but safe for agents.**

## What it does

- Exposes explicit Polymarket MCP tools (no arbitrary shell passthrough).
- Validates each tool call with Veto before execution.
- Defaults to simulation for mutating actions.
- Supports local deterministic policy enforcement out of the box.
- Supports optional cloud validation when configured in `veto/veto.config.yaml`.

## Install and run

```bash
npx -y @plawio/polymarket-veto-mcp serve
```

By default this starts stdio MCP transport with:

- policy profile: `defaults`
- simulation mode: `on`
- live trading: `disabled` unless explicitly enabled

## Required dependency: Polymarket binary

This MCP package wraps the Rust `polymarket` CLI. One of these must exist:

```bash
# Option A: install globally
brew install polymarket

# Option B: build from this repo
cargo build --release
```

Then verify:

```bash
polymarket --version
```

If you built locally and did not install globally, set:

```yaml
polymarket:
  binaryPath: ../target/release/polymarket
```

## Commands

```bash
npx -y @plawio/polymarket-veto-mcp serve \
  --policy-profile defaults \
  --simulation on \
  --transport stdio

npx -y @plawio/polymarket-veto-mcp doctor
npx -y @plawio/polymarket-veto-mcp print-tools
npx -y @plawio/polymarket-veto-mcp print-config
```

If `npx` is being run from this package source directory and fails to resolve the bin, use:

```bash
pnpm dlx @plawio/polymarket-veto-mcp serve
```

or

```bash
bunx @plawio/polymarket-veto-mcp serve
```

## MCP client config (works from any cwd)

```json
{
  "mcpServers": {
    "polymarket-veto": {
      "command": "npm",
      "args": [
        "exec",
        "--yes",
        "--prefix",
        "/tmp",
        "--package",
        "@plawio/polymarket-veto-mcp",
        "--",
        "polymarket-veto-mcp",
        "serve",
        "--policy-profile",
        "defaults"
      ]
    }
  }
}
```

## Tool set

Read-only tools:

- `markets_list`
- `markets_search`
- `markets_get`
- `clob_book`
- `clob_midpoint`
- `clob_price`
- `portfolio_positions`

Mutating tools (policy-guarded):

- `order_create_limit`
- `order_market`
- `order_cancel`
- `order_cancel_all`
- `approve_set`
- `ctf_split`
- `ctf_merge`
- `ctf_redeem`

Not exposed:

- `wallet_import`
- `wallet_reset`
- `clob_delete_api_key`

## Configuration

Default config path: `veto-agent/polymarket-veto.config.yaml`

Key settings:

- `polymarket.binaryPath`
- `execution.simulationDefault`
- `execution.allowLiveTrades`
- `execution.maxCommandTimeoutMs`
- `mcp.transport`
- `veto.configDir`
- `veto.policyProfile`

`polymarket.binaryPath` supports:

- `auto` (default): PATH lookup + local `target/release` / `target/debug` auto-discovery
- explicit command name (for example `polymarket`)
- explicit path (for example `../target/release/polymarket`)

Veto root config and rules are expected under `veto/`.

## Simulation vs live

Mutating tools execute as simulation by default.

To enable real execution, all of these must be true:

1. `--simulation off` (or config override)
2. `execution.allowLiveTrades: true`
3. environment variable `ALLOW_LIVE_TRADES=true`

## Development

```bash
cd veto-agent
npm install
npm run typecheck
npm test
npm run build
```
