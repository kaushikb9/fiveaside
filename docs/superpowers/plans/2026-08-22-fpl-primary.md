# Touchline v2 — FPL becomes the front door, with live gameweek data

## Context

The FPL planner shipped 2026-08-21 as a secondary tab at `/fpl/`. After a
design workshop and three mockup rounds, KB picked **`day0-home`** — the
two-tier page: a genuinely useful *public* FPL page (the commons) plus a
*personal* layer revealed by a sync toggle. He now wants that page to be
**touchline's primary landing page**, the Chelsea digest demoted to its
own tab (later to broaden into a general Premier League news tab that
mirrors the FPL page — Chelsea-heavy but unified, "more on that later"),
and **live in-gameweek data** if free APIs allow.

They do. The FPL API exposes per-player live points with scoring
breakdowns (`/event/{gw}/live/`), live scores with a match clock and
provisional-bonus BPS (`/fixtures/?event=N`), plus entry picks and
league standings — all keyless. The single blocker is CORS: the API
sends no `access-control-allow-origin`, so a browser cannot call it
directly. A Cloudflare Pages Function proxy solves it, same-origin, and
matches the pattern antifeed/kaizen already use.

**Decisions locked with KB:** digest moves to `/digest/` · full live view
(matches in play, live squad points, live mini-league) · sync stays a
simple toggle (a declutter gate, not secrecy — picks are public via the
API anyway).

## Done when / Reject if

**Done when:**
1. `touchline-chelsea.pages.dev/` serves the FPL page in the `day0-home`
   design, rendered from `site/data/fpl.json` — not hardcoded.
2. The digest lives at `/digest/` and works exactly as before; `/fpl/`
   301s to `/`; nav on every page reads `FPL · digest · about`.
3. During a live gameweek the page shows: matches in play with the clock,
   and (when synced) live squad points per player, provisional bonus, and
   the live mini-league table — refreshed on demand, degrading silently
   to the static page when the proxy or API is unavailable.
4. Both tiers render from real data: commons (template board, captain
   poll, penalty takers, fixture runs, bus team, wildcard XI, chip clock)
   and personal (call, squad, watchlist, wagers, doctrine, race, debrief).
5. `uv run pytest -q`, `uv run ruff check .`, `node brain/validate-fpl.mjs`,
   `node brain/validate.mjs`, `node --check` on all site JS pass; deploy
   asserts the Functions bundle uploaded.

**Reject if:**
- The digest page or `digests.json` changes behaviour (move only).
- Live data invents numbers: every live figure is API-derived or absent.
- The page breaks when `fpl.json` is stale/missing, or when the live
  proxy 500s — both degrade to a quiet, complete-looking page.
- The proxy is an open relay (must whitelist upstream paths).

## The build

### 1. Site restructure
- `site/index.html` + `site/app.js` → the FPL page (new renderer, ported
  from `docs/superpowers/mockups/2026-08-22-fpl-v2/day0-home.html`).
- Current digest shell/renderer move to `site/digest/index.html` +
  `site/digest/app.js` — only edits: data paths `data/…` → `../data/…`,
  nav, and `?v=` bump. Renderer logic untouched.
- `site/_redirects`: `/fpl/* / 301`.
- `site/style.css`: append the FPL v2 component block (squad boards, FDR
  strips, ownership bars, signal cards, chip clock, race, live strip),
  reusing existing tokens; add `--fdr*` tokens already present. Bump all
  three pages to `style.css?v=3`.
- Nav pattern per design-system INVARIANTS: `[content links] · about`.

### 2. fpl.json v2 schema (validator is the authority)
Keeps `season · gameweek · call · squad · watchlist · signals · ticker ·
plan · log`; adds:
- **commons**: `new_this_season[]` {title,note} · `template.groups[]`
  {pos, rows[{name,team,ownership}]} · `captain_poll` {most_captained,
  rows[], note} · `penalties` {rows[{team,taker,note?}], note} ·
  `bus` / `wildcard` {formation, note, players[15]} · `chips`
  {rows[{code,name,window,expires}], note}
- **personal**: `desk` {team_name, entered, gw_points?, overall_rank?,
  league{name,rank,of}?, bank?, free_transfers?, chips_available[]} ·
  `wagers[]` {claim, settles_gw, owner?} · `doctrine[]` {id, text,
  established, status} · `race` {league_name, state: pre|live|settled,
  rows[], benchmarks[], note} · `call.template_drift`
- `bus`/`wildcard` players reuse the **existing squad-legality checker**
  in `brain/validate-fpl.mjs` (2/5/5/3, ≤3 per club, 11/4, C+V) — one
  function, three call sites.
- `signals[].tag` enum extends to `injury|doubt|ban|rotation|price|news|
  managers` (the mockup's card pills).
- Fixture runs need **no new field** — the renderer slices kindest/hardest
  from the existing `ticker`.

### 3. Python facts (`uv run touchline fpl`)
- `src/touchline/sources/fpl.py`: add `fetch_entry(id)`,
  `fetch_entry_picks(id, gw)`, `fetch_league(id)` — same
  `ok/error`-degrading result models as `fetch_bootstrap`.
- `src/touchline/core/fpl.py`: add to the bundle — `template` (top N by
  ownership per position), `captain_poll` (event `most_captained` +
  candidates), `penalties` (`penalties_order == 1` per club),
  `entry`/`league` blocks when `config.fpl.team_id` is set. Pure, injected
  `now`, unchanged compaction for `players`.
- `tests/test_fpl.py`: extend fixtures + 3 cases (entry parse/degrade,
  penalties join, template grouping).

### 4. Live proxy + live view
- `functions/api/live.js` — **one** endpoint, `onRequestGet`, whitelisted
  upstream paths only, joins on the server so the browser makes one call:
  `?gw=N[&entry=N][&league=N]` → `{gw, status, fixtures[], squad[],
  totals, league[]}`. Relies on the upstream `max-age=300` for caching;
  same-origin so no CORS headers needed. Plain-text errors, per the
  antifeed idiom.
- `site/app.js`: a live strip that polls **only on demand** (render once
  on load, plus a manual refresh control) when the gameweek is in play;
  absent/failed → nothing renders. No auto-polling loops.
- `deploy.sh`: port antifeed's `grep -q "Uploading Functions bundle"`
  assertion — it catches the silent failure where functions are dropped.

### 5. Brain
- `brain/fpl-prompt.md`: rewrite for the v2 schema — commons sections are
  copied verbatim from the facts bundle (template/captain/penalties/
  ticker are facts, not prose); personal sections keep the editorial
  rules already agreed (one signed Call, FYI strip, wagers with settle
  GWs, four-verdict ledger, doctrine ladder).
- `brain/validate-fpl.mjs`: extend for every new section.
- `brain/curate-fpl.sh` / `auto.sh`: unchanged.
- **Migration**: I hand-author `site/data/fpl.json` v2 from live API data
  now, so the page is correct the moment it deploys; the next brain run
  maintains it. Per KB's rule, show him the brain's output diff on real
  data before it becomes the standing daily run.

### 6. Docs
`AGENTS.md`: new site map (root = FPL, `/digest/`), the `functions/`
seam, and the live-proxy contract. Copy this plan to
`docs/superpowers/plans/2026-08-22-fpl-primary.md`.

## Deliberately not in this build
KV-backed ☆ stars (localStorage only for now) · the Chelsea→PL-news
broadening (separate pass, KB said "more on that later") · friend team-ID
entry · any auto-refresh/websocket behaviour.

## Verification
1. `uv run pytest -q` · `uv run ruff check .` · `node --check site/app.js
   site/digest/app.js functions/api/live.js` · `node brain/validate-fpl.mjs`
   · `node brain/validate.mjs`.
2. `uv run touchline fpl | head -60` — eyeball template/penalties/entry
   blocks against the live API.
3. Local: `cd site && python3 -m http.server` — check `/` (both sync
   states, both themes), `/digest/`, `/about/`, phone width 390px, and the
   stale-data path (rename fpl.json → page must degrade quietly).
4. Live path can only be tested against the deployed Function
   (`wrangler pages dev` optional): after deploy, hit
   `/api/live?gw=1&entry=7149204&league=391164` and confirm JSON, then
   confirm the strip renders and that GW1 shows real in-play state.
5. `./deploy.sh` — must print the Functions-bundle assertion; then verify
   `/`, `/digest/`, `/fpl/` (301), and the live strip on the live URL.
