# Build progress

- [x] Phase 1: Foundations (monorepo, lobby, 20s batch market, charts, price-engine tests, Render build)
- [x] Phase 2: Nations and map (procedural Voronoi map, nations, production, buildings, stability, coups, national companies, export)
- [x] Phase 3: War (armies, timed movement, fog of war, Lanchester battles, field collisions, war declarations, peace, war-to-market shocks)
- [x] Phase 4: News, events, diplomacy, leverage (12 world event types with escalating intensity, Rumour Mill ~40% false, chat, trade deals with defaults, alliances with shared vision, sanctions + embargo, limit orders, 1–5x leverage + margin calls)
- [x] Phase 5: Spies and chaos (4 spy missions, insider tips, regulator fines, secret roles, 4 game modes, end-of-game recap with awards)

Tests: 74 Vitest tests over the pure cores (price engine, accounts, map gen, economy, battles,
events, regulator) plus headless whole-game simulations.
