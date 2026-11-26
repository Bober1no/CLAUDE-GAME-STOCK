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

## Testing with two browser tabs

1. `npm run dev`, then open http://localhost:5173 in a normal window **and** a private/incognito
   window (each window keeps its own seat in localStorage).
2. Window A: enter a name → **Create game**. Pick a session length, mode and roles.
3. Window B: enter a name and the 5-letter code → **Join**. Window A: **Start game**.
4. Things to try:
   * **Market:** pick an asset in the left list, queue BUY/SHORT orders in both windows, and
     watch them clear together when the countdown hits 0. Try 5x leverage, and a limit order.
   * **Nation:** click ★ capital, build a farm/mine, recruit an army. Export oil in the Nation tab.
   * **War:** click your army marker, then a highlighted neighbour to march (30–90s). Neutral land
     can be taken any time. For another player, Diplomacy → Nations → Declare war first.
     Their companies drop, defence stocks jump.
   * **Diplomacy:** chat (global or @private), propose an alliance (shared vision), offer a trade
     deal, sanction someone. Two sanctioners = embargo.
   * **Intel:** train a spy (30s), then surveil, read their trading desk, steal tech, or plant a
     fake story about one of their companies.
   * **Reconnect:** reload a tab mid-game. You land back in your seat.

Dev shortcut: set `WARMARKET_SESSION_SCALE=0.05` on the server to make sessions 20× shorter, so
you can reach the end-of-game recap quickly. Leave it unset in production.

Keyboard: `W` world map, `M` market, `Tab` toggle, `Esc` deselect army.

## Game systems

| System | Where | Notes |
| --- | --- | --- |
| Nations | `world/world.ts` | Treasury = trading cash. Resources trickle from provinces + buildings. Food upkeep for land and armies. |
| Stability | `world/economy.ts` | Drained by war, sanctions, starvation, crashing company stocks. Below 30: protests (production ×0.6). At 0: coup (40% of provinces revolt, 30% of the treasury is looted). |
| Companies | `world/companies.ts` | 3 per nation, sector-tagged. Price reverts toward a fundamental built from stability × territory × sector output (defence likes war). |
| Commodities | `world/economy.ts` | Fundamental follows live world supply of provinces with that specialty (war damage, droughts and discoveries move it). |
| Military | `military/` | Recruit (20s), march to adjacent provinces (30–90s by terrain, slower by sea), battles via Lanchester's square law with terrain/fort bonuses and ±20% rolls. Head-on clashes on roads too. |
| Fog of war | `military/military.ts` | You see your land, your army positions and routes, one hop around them, plus allies and spied nations. Everything else is never sent to your browser. |
| Events | `events/` | 12 event types fire more often and harder as the session goes on. Rumour Mill pre-announces some (~40% of its rumours are false). Insider tips are sent privately and are sometimes wrong. |
| Diplomacy | `diplomacy/` | Chat, trade deals (flows per minute; defaulting or breaking costs reputation), alliances, sanctions, embargo. |
| Espionage | `espionage/` | Spies with 4 missions. A regulator fines pump-and-dump round trips. Secret roles: analyst (live order book), whale (2.5× cash), journalist (publishes headlines). |
| Modes | `game/Game.ts` | Net worth (default), domination (45% of world production), hegemony (majority of founding capitals for 60s), last one standing. |

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
