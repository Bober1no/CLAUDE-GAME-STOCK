# WARMARKET (working title)

Real-time multiplayer strategy game for 2–8 players. Everyone runs a nation, and a shared global
stock market is the scoreboard. Wars, trade, sanctions, spies and world events all move the market.
Sessions run 30–45 minutes. Players join a lobby with a 5-character code. No accounts.

```
/shared   types, config.ts (all balance numbers), formatting helpers
/server   Node + TypeScript + Socket.io. Authoritative game logic.
  src/market/     price engine (pure), accounts (pure), exchange
  src/world/      map generation, nations, production, stability
  src/military/   armies, movement, battles (pure)
  src/events/     news feed, world-event scheduler (pure)
  src/diplomacy/  chat, deals, alliances, sanctions
  src/espionage/  spies, insider tips, regulator
  src/net/        socket wiring, input validation (zod), rate limiting
  src/game/       Game orchestrator: world loop (100ms) + market clock (20s)
/client   React + Vite + lightweight-charts. Renders what the server says.
```

## Run locally

Requires Node 18.18+ (22 recommended). Works in PowerShell, cmd, and bash.

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:5173 in two browser tabs (or one normal + one private window, since a tab
remembers its seat in localStorage). Create a game in one, join with the code in the other, then
start it from the host tab.

`npm run dev` builds `/shared` once, then runs three watchers together: shared (tsc), server
(tsx on :3000), and client (Vite on :5173, which proxies `/socket.io` to the server).

### Production build locally

```bash
npm run build
```

```bash
npm start
```

Then open http://localhost:3000 in two tabs. In production one Node process serves the built
client and Socket.io on the same origin.

### Tests

```bash
npm test
```

Vitest runs over the pure cores: price engine, account/margin maths, battle resolution, event
scheduler, map generation.

## Deploy to Render (free web service)

The repo includes a `render.yaml` blueprint. Two ways to deploy:

**Blueprint:** Render dashboard → New → Blueprint → pick this GitHub repo. It reads `render.yaml`.

**Manual Web Service** with these exact settings:

| Setting           | Value             |
| ----------------- | ----------------- |
| Runtime           | Node              |
| Branch            | your main branch  |
| Root directory    | *(leave blank)*   |
| Build command     | `npm run build`   |
| Start command     | `npm start`       |
| Health check path | `/health`         |
| Instance type     | Free              |
| Env var (optional)| `NODE_VERSION` = `22.12.0` |

The server listens on `process.env.PORT` and binds `0.0.0.0`. Render sets `PORT` itself.

**Free-tier caveats.** The service sleeps after 15 minutes idle and takes about a minute to wake.
All game state is in memory, so a restart or sleep wipes every room. The client handles this: it
auto-reconnects, shows a "Reconnecting…" banner, and rejoins your seat using the code and the
player token stored in localStorage. If the server restarted, the room is gone and you go back to
the home screen with a message. Before a class session, open the site once so it's awake.

## How the market works

* Assets: 8 commodities, 3 parody companies per player nation (sector-tagged), and one memecoin
  (WarDoge, which pumps at random and eventually rugs).
* **Batch auction every 20s.** Orders queue during the window and all clear at one price on the tick.
  * `imbalance = (buy − sell) / (buy + sell + depth)`
  * `return = 0.22·imbalance + event drift + lagged sector links + mean reversion + noise`, capped at ±15%.
  * Slippage = 12% × (order notional / depth), max 10%, always against you.
  * Circuit breaker: if the raw (pre-cap) move is a drop of more than 20%, the asset halts for the next round.
* Order types: market buy / sell / short / cover, limit (fills only if this clear lands in range),
  leverage 1/2/3/5x with margin calls (forced close below 7% equity).
* The BUY/SELL pressure bars are deliberately fuzzy (noise + quantised) and about 4 seconds late.
  Spies and analysts see the real book.

All balance numbers live in `shared/src/config.ts`.

## Anti-cheat stance

The client only sends intents (`{type:'order', assetId, side, qty}`, `{type:'move', armyId, to}` …).
Every payload is validated with zod, rate-limited per socket, and re-checked against server state.
Each player receives only their own filtered view (fog of war, private orders, tips). The full
game state is never broadcast.
