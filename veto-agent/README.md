# @vulnzap/polymarket-veto-mcp

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
npx @vulnzap/polymarket-veto-mcp serve
```

By default this starts stdio MCP transport with:

- policy profile: `defaults`
- simulation mode: `on`
- live trading: `disabled` unless explicitly enabled

## Commands

```bash
npx @vulnzap/polymarket-veto-mcp serve \
  --policy-profile defaults \
  --simulation on \
  --transport stdio

npx @vulnzap/polymarket-veto-mcp doctor
npx @vulnzap/polymarket-veto-mcp print-tools
npx @vulnzap/polymarket-veto-mcp print-config
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
