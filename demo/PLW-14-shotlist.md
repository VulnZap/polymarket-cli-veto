# PLW-14 Shot List (30 Seconds)

1. Open terminal and start guarded MCP sidecar:
   - `npx -y @plawio/polymarket-veto-mcp serve --policy-profile defaults`
2. Show MCP `tools/list` response including both read-only and mutating tools.
3. Execute read-only market lookup (`markets_search`) and show success.
4. Execute dangerous mutation (`order_market` with amount 80) and show approval-required/deny response.
5. Show simulation output for safe mutation preview with midpoint/notional context.
6. End with policy file snippet (`veto/rules/defaults.yaml`) and tagline:
   - "Polymarket CLI, but safe for agents."
