# PLW-14 Recording Script

## Opening (0-5s)
"This is Polymarket trading from an AI agent, guarded by Veto."

## Tool discovery (5-10s)
- Call `tools/list`.
- Narration: "The agent sees explicit tools only. No arbitrary shell access."

## Safe research path (10-15s)
- Call `markets_search` with a real query.
- Narration: "Read paths are fast and allowed by default."

## Risky mutation path (15-23s)
- Call `order_market` with amount > 25.
- Narration: "High-risk actions are intercepted before money moves."

## Simulation proof (23-28s)
- Show simulated execution payload with midpoint/notional output.
- Narration: "You still get execution realism without silent live trading."

## Close (28-30s)
"This is why agent trading needs authorization by default."
