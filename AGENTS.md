# Agent notes for Five-a-Side

> **Starting fresh? Read [`ROADMAP.md`](ROADMAP.md) first** — current state,
> known debt, and the ordered todo list. Then this file for the rules, then
> `new-ideas.md` for KB's intent and
> `docs/superpowers/mockups/2026-08-23-five-a-side-sketches.html` for the
> agreed design.

Football and FPL for five friends, produced by a three-part machine with one
hard boundary: **Python produces facts, the brain produces prose, the site
produces pixels.** Work on one side of a boundary without leaking into
another.

Its own palette on purpose (Dugout in daylight, Floodlit at night — one
design in two lights), but the shared **structure** — see `../design-system/`
for the token contract and the cross-app invariants.

## Map

**The product is Five-a-Side**: football and FPL for five friends, in three
rooms under one shell, one nav and one theme.

| Room | URL | Job |
|---|---|---|
| **touchline** | `/` | What happened. The league, identical for all five. |
| **the gaffers** | `/gaffers/` | What we did about it. Five squads, five weeks. |
| **the locker room** | `/locker/` | What we know. Every player, evidence first. |

The join that makes them one product rather than three tabs: **any player
name in touchline or the gaffers opens their locker-room card**, via one
delegated listener in `site/common.js`. Keep it that way.

- `src/touchline/` — the facts CLI. `uv run touchline facts` builds the
  digest bundle, `uv run touchline fpl` the FPL one. Pure core
  (`core/facts.py`, `core/fpl.py` — no I/O, injected `now`), source clients
  behind protocols. Owner preferences in `touchline.config.json`; never
  hardcode a club, competition or timezone.
- `brain/` — two editors, same discipline. `curate.sh` + `prompt.md` write
  `digests.json`; `curate-fpl.sh` + `fpl-prompt.md` write `fpl.json`.
  `split-facts.mjs` sits between the facts CLI and the FPL prompt: it writes
  the mechanical files straight to disk and hands the brain the remainder.
  The three `validate-*.mjs` files are the schema authorities.
- `functions/` — Pages Functions, a **sibling** of `site/`, not inside it.
  `api/live.js` proxies the FPL API (which sends no CORS headers),
  `api/stars.js` is the KV-backed watchlist star, `api/auth.js` is Google
  sign-in for the gaffers room, and `api/private.js` serves the data that
  room needs. One KV namespace (`STARS`) holds all of it, keyed by prefix.
- `site/` — static, no framework, no build step, no CDNs. `common.js` loads
  first on every page and holds everything that must behave identically in
  all three rooms: theme, nicknames, kits, the focus-club rule, the player
  card. Every data-derived string goes through `esc()`. `faces.js` loads
  after it in the gaffers room only: five inline-SVG caricatures of the
  football people the five are named after, drawn on one skeleton so they
  read as a set. Drawn, never fetched — same rule as the kits.

**Public and private.** `deploy.sh` runs `brain/publish-private.mjs`, which
pushes the squads and the weekly reads into KV and keeps them out of the
upload. `site/data/gaffers.json` exists in the repo as a build artifact and
is **never published** — a tombstone ships in its place. Do not "fix" that by
publishing it.

**Which file may say what — the rule the whole repo turns on**

| File | Written by | Contains |
|---|---|---|
| `players.json` | `touchline fpl` | Every player, evidence only. Mechanical. |
| `gaffers.json` | `touchline fpl` | Five squads, picks, captaincy, chips. Mechanical. |
| `fpl.json` | the brain | **Judgment only.** Opinion with reasoning attached. |
| `digests.json` | the brain | The league page. **Append-only**, one entry per date. |

If a value could be copied from the API, it does not belong in `fpl.json`.
Routing 600 player records through a model cost ~100k tokens a run to retype
numbers and invited transcription errors. `fpl.json` is a **living document**
— sections replaced wholesale each run, except `log`, which is
append-and-settle.

**Focus clubs are a rule, not a list.** Chelsea, Manchester United and
Arsenal are permanent because that is who the five support. Until GW10 the
other two are seeded from `top_clubs`; from GW10 the rest is the real top six
of the table, recomputed weekly. Implemented once in `FA.focusClubs()` and
described to the brain in `prompt.md`.

## Commands

```sh
uv run pytest -q                 # 101 tests — keep green
uv run ruff check .              # lint (line-length 100)
node brain/validate.mjs          # digests.json
node brain/validate-fpl.mjs      # fpl.json — judgment layer
node brain/validate-players.mjs  # players.json — the player file
node --check site/common.js site/app.js site/gaffers/app.js site/locker/app.js \
             functions/api/*.js brain/*.mjs
./brain/curate.sh --no-deploy      # league room, full run without publishing
./brain/curate-fpl.sh --no-deploy  # gaffers room, ditto
./deploy.sh                      # stamp assets, split private, push to KV, deploy
brain/test/smoke.sh https://fiveaside.pages.dev/   # 45 checks over the live site
cd site && python3 -m http.server # local preview — /api/* 404s and the page
                                  # degrades honestly, which is worth seeing
```

**Wrap any long unattended run in `caffeinate -dimsu`.** This machine has
`pmset sleep 1` on AC and two brain runs died mid-response before that was
added; `-i` alone is not enough, it only blocks idle sleep. `auto.sh` does it.

## Rules that have bitten before

- **The brain invents things it was never given.** On 2026-08-23 it wrote the
  owner's real name into `fpl.json` as `desk.manager` — a key the facts layer
  deliberately does not produce, from a name that appears nowhere in the
  bundle. It came from repository context. `validate-fpl.mjs` now rejects the
  file on sight if it finds a banned key; do not weaken that check, and do not
  assume a Python-side test protects the one file a model authors.
- The brain must never invent facts (scores, fees, stats) — prose comes from
  fetched sources; structured club data is copied verbatim from the bundle.
  `club_form` scores are club-digit-first; `latest_result.score` is home–away
  ordered — the swap rule lives in `prompt.md`, don't weaken it.
- **`multiplier` is the chip's fingerprint**, and 0 does not mean "no
  multiplier": 0 is benched, 1 normal (or a Bench-Boosted bench slot), 2 a
  captain, 3 a triple captain. Scoring a squad with `multiplier ?? 1` silently
  zeroes the bench. And the bench asks two different questions: normally it is
  regret and the API's `points_on_bench` answers it, but under Bench Boost the
  bench SCORED and that field reads 0 because nothing was left on it.
- The gameweek has two meanings and they differ mid-week: `gameweek` is the
  one being **planned for** (next deadline), `live_gameweek` the one being
  **played**. The pitch follows the second.
- **Player-card form is Premier League only.** `_recent()` builds it from the
  FPL API's fixtures, which know about no other competition, so a midweek cup
  tie leaves a gap the strip cannot show. Logged in ROADMAP §4b; do not
  describe it as "form" anywhere that implies all competitions.
- **A finished match is not `finished`.** FPL flips that flag only once bonus
  is confirmed, which can be a day later — a 3-0 that is ninety minutes old
  still reads `finished: false`. Use `finished_provisional` or `minutes >= 90`
  as well, which is what `_recent()` does.
- **Making something private means REPLACING it, not deleting it.** Removing
  `gaffers.json` from the upload left Cloudflare serving it from the edge for
  another six days (`cf-cache-status: HIT`, `s-maxage` 604800). Pages purges
  an asset it replaces on deploy, not one that vanishes — so a tombstone
  ships at that path. `site/_headers` also caps `/data/*` and forbids caching
  `/api/*`.
- **A `.json` path that 404s still answers 200 with `content-type:
  application/json`** — Pages serves its SPA fallback and labels it by
  extension. Neither status nor content type tells you whether a file
  shipped; parse the body.
- **The `?v=` cache-buster is a content hash**, stamped by
  `brain/stamp-assets.mjs` at deploy. It used to be a hand-typed integer and
  a forgotten bump served a stale `app.js` against fresh markup — the page
  rendered, just without the feature.
- **`text-wrap: balance` on a long headline** splits it into two half-width
  lines and wastes the page. It is applied to short headings only.
- **Grid items default to `min-width: auto`**, so a wide table's min-content
  forces its `1fr` track past the container and scrolls the whole page
  sideways. `.grid2 > * { min-width: 0 }`.
- **Wire-once helpers must be idempotent.** A table inside a closed
  `<details>` is already in the DOM, so a page-level pass and a toggle
  handler both wired it and every sort click fired twice.
- Competition labels on stat boards are short codes ("PL", "CL", "FR"); only
  the table heading uses the human league name.
- ESPN is unofficial: keep the wide date window (120d back / 45d forward) and
  `limit=400` — silent truncation drops future fixtures mid-season.
- Reddit listings are login-walled since August 2026; `brain/sources.md` has
  the working fallbacks. WebFetch is blocked for several news domains — curl
  and parse instead.
- Changing tokens at runtime can leave an existing subtree on the previous
  theme's resolved colour in Chromium. The theme control re-renders for that
  reason; if you add another way to switch, do the same.
- Design changes are **mockup-first**: agree the mockup with the owner before
  touching `site/`. The current one is
  `docs/superpowers/mockups/2026-08-23-rooms/`, with his comments archived
  beside it in `docs/superpowers/comments/`.
- Specs and plans live in `docs/superpowers/`; `ROADMAP.md` at the root is the
  state of play. Read it before structural changes.

## Deployment

Cloudflare Pages project `fiveaside`, live at https://fiveaside.pages.dev (no
custom domain). Deploys are non-interactive (`CI=1`) — just `./deploy.sh`,
which stamps asset hashes, splits public from private, pushes the private half
to KV, and asserts the Functions bundle uploaded (the silent failure mode is
`/api/*` 404ing to the static site).

**Secrets and bindings.** One KV namespace `STARS`, bound in `wrangler.toml`,
holds `stars:<gaffer>` and `private:gaffers` / `private:people`.
`SESSION_SECRET` is set as a Pages secret. `GOOGLE_CLIENT_ID` is **not set
yet** — see ROADMAP §4a; without it sign-in returns 503 and the gaffers room
says so honestly rather than showing a dead button.

**Scheduling.** `brain/auto.sh` fires hourly via launchd
(`com.kb.touchline.plist`). It pulls with autostash and a timeout, then:

1. refreshes the **mechanical** data every hour (prices, points, squads,
   chips — no LLM), publishing only if something moved;
2. runs each brain at most once a day, on independent freshness checks, so a
   failure in one never starves the other.

The hourly refresh sits ABOVE the "nothing due, exit" guard on purpose. It
was below it once, which meant that the moment both brains had run for the
day the script exited before ever refreshing — the exact staleness it exists
to remove.

`touchline-pl` was deleted on 2026-08-23. The Chelsea digest moved to its own
repo the same day — `~/Code/touchline-chelsea`, weekly, backup only; retire it
once these three rooms have run for a week.
