# PLW-14 Validation Checklist

## Pre-record checks

- [ ] `polymarket --version` works locally.
- [ ] `veto-agent/polymarket-veto.config.yaml` exists and profile is set.
- [ ] `veto/veto.config.yaml` uses `validation.mode: local` for offline demo stability.
- [ ] `npx -y @plawio/polymarket-veto-mcp print-tools` returns expected tool set.

## Functional checks

- [ ] `markets_search` succeeds with JSON output.
- [ ] `order_market` over threshold returns policy denial/approval-required.
- [ ] `order_market` low amount returns simulation payload by default.
- [ ] `order_cancel_all` is approval-gated.
- [ ] No wallet/key mutation tool is exposed in `tools/list`.

## Launch artifact checks

- [ ] README quickstart commands are copy-paste valid.
- [ ] Demo shot list, script, and checklist committed in `demo/`.
- [ ] One successful dry-run recording completed before launch cut.
