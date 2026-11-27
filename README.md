# WARMARKET (working title)

Real-time multiplayer stock-market game for 2–8 players. Everyone is a tycoon: a trader who also
runs their own listed company. You win by having the highest net worth at the closing bell, and
you get there by trading, running your company well (or fraudulently), planting stories, lobbying
governments and spying on rivals. Sessions run 10–45 minutes. Players join a lobby with a
5-character code. No accounts.

## Play it (no command line needed)

The game runs on Render. Everyone just opens the Render link in a browser. Opening `index.html`
straight from disk can't work, because the game needs its server.

1. render.com → **New → Web Service** → connect this GitHub repo.
2. Settings:

| Setting           | Value             |
| ----------------- | ----------------- |
| Branch            | the branch with this code |
| Language          | Node              |
| Root directory    | *(leave blank)*   |
| Build command     | `npm run build`   |
| Start command     | `npm start`       |
| Instance type     | Free              |
| Health check path | `/health`         |
| Env var           | `NODE_VERSION` = `22.12.0` |

3. Deploy, wait for "Live", and share the `https://…onrender.com` link. One person clicks
   **Create game**, everyone else types the code.

Or use the included `render.yaml`: Render → New → Blueprint → this repo.

**Free-tier caveats.** Render sleeps the service after 15 minutes idle and takes about a minute to
wake, so open the link before the lesson starts. Game state is in memory, so a sleep or redeploy
ends any game in progress. If your connection drops, the client shows "Reconnecting…" and puts you
back in your seat automatically (the code and a seat token are kept in localStorage).

## How to play

* **Lobby:** pick your name, your company's name and its sector. The host picks the session length
  and whether secret roles are on, then rings the opening bell.
* **You start with** $10,000 cash and 150 founder shares of your own company at $40. Your stock
  is a big chunk of your net worth, so rivals will try to wreck it.
* **The market** clears every 20 seconds as a batch auction: everyone's orders fill together at
  one price. Buy, sell, short, cover, limit orders, 1–5x leverage (with margin calls).
* **Company tab (CEO actions):**
  * R&D: slow, durable value (80% chance it pays off).
  * Marketing: quick hype that fades.
  * Buyback: price and value up a little.
  * Dividend: pays every holder, and shorts have to pay it too, so it's a weapon against people
    shorting you.
  * Issue shares: instant cash, but dilution.
  * Cook the books: a big fake pump until the regulator catches it.
* **Influence tab:**
  * Plant a pump or smear story about any stock or commodity (it may get traced back to you).
  * Lobby the government to push a commodity.
  * Plant a mole to see a rival's queued orders.
  * Buy research to see the live order book.
* **Chaos:**
  * World events (droughts, hurricanes, pandemics, earnings, scandals, rate changes…) get bigger
    as the session goes on.
  * The Rumour Mill is wrong about 40% of the time.
  * Insider tips arrive privately and are sometimes wrong.
  * The regulator fines pump-and-dumps.
  * Getting caught lowers your reputation, and low reputation makes the regulator twitchier.
* **Secret roles (optional):** analyst (sees the live order book), whale (2.5× cash), journalist
  (publishes headlines).
* **Recap** at the end: winner, biggest loser, best-run company, worst trade, rugged by WarDoge,
  media mogul, creative accounting…

## For developers

```
/shared   types, config.ts (every balance number), formatting
/server   Node + TypeScript + Socket.io. Authoritative game logic.
  src/market/     price engine (pure), accounts (pure), exchange
  src/corporate/  player-run companies (CEO actions, fraud)
  src/influence/  stories, lobbying, moles, research, journalist
  src/events/     news feed, world-event generator (pure), rumours, tips
  src/espionage/  regulator (pure detector)
  src/chat/       global + private chat
  src/net/        socket wiring, zod validation, rate limiting
  src/game/       Game orchestrator: 100ms loop + 20s market clock
/client   React + Vite + lightweight-charts
```

Local dev (needs Node 18.18+): `npm install`, then `npm run dev`, then open
http://localhost:5173 in a normal and a private window. Tests: `npm test`. Production locally:
`npm run build` then `npm start` (http://localhost:3000). Dev-only:
`WARMARKET_SESSION_SCALE=0.05` makes sessions 20× shorter.

### Market maths

* `imbalance = (buy − sell) / (buy + sell + depth)`
* `return = 0.22·imbalance + event drift + lagged sector links + mean reversion + noise`,
  capped at ±15% per clear.
* Mean reversion pulls toward a fundamental value. For player companies that's IPO price × health
  (which CEO actions change) × event/story shifts that fade over time.
* Slippage = 12% × (order size / depth), max 10%, always against you.
* Circuit breaker: a raw drop of more than 20% halts the asset for the next round.

### Anti-cheat stance

The client only sends intents. Every payload is validated with zod, rate-limited per socket and
re-checked against server state. Each player gets only their own view: your orders, your
company's true fundamentals, your fraud status, your mole reports. The full state is never
broadcast.
