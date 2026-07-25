# Touchline v2 — the antifeed model, self-hostable

**Date:** 2026-07-25
**Status:** Approved direction; spec for implementation planning.

## Why a rebuild

The v1 review (2026-07-25, six days after the World Cup final) found the app
structurally sound but dead as a product:

- Its entire premise — a daily World Cup digest — expired on July 19. Today it
  renders an empty page over a 403 from football-data.org.
- The promised "calm, fun" digest was f-string templating, not writing.
- Pull-only: no delivery mechanism, no reason to return.
- No persistence: every page load re-fetched the whole tournament live from a
  10-req/min free API. No history, no cache.
- Headlines were wired into the CLI only; the web app never fetched news.
- The service worker was cache-first on `/`, serving a *daily* digest stale
  forever.
- "Competition-agnostic core" with `"WC"` and IST hardcoded at every surface.

What was worth keeping: pure core models, source clients behind protocols,
graceful per-record degradation, and a fast test suite.

The fix is a proven model, not more features: **antifeed** (`../antifeed`) —
a static site with a single JSON file as its database, plus a "brain"
(headless Claude Code) run each morning that sweeps sources, writes real
prose, appends to the JSON, validates, commits, and deploys.

**Touchline v2 = the antifeed model, productized for anyone.** Antifeed is a
personal product; touchline is self-hostable: preferences instead of personal
sync, and the brain runs locally on the owner's machine. Nothing runs
centrally.

## Product

A one-page-a-day football companion you host yourself. You pick a club
(Chelsea in KB's deployment) and each morning a local brain run publishes
today's page:

- **What happened** — your club first, then the day's football.
- **What's on today** — and why it matters, with an honest take.
- **The wider game** — 1–3 links from the day's discourse, each with an
  antifeed-style hook; optionally one good read.

Written prose with a point of view. History accumulates; the archive is part
of the product. The 2026–27 European season starts ~Aug 15 — the natural
deadline for v2 to be live.

## Architecture

Three parts with one boundary rule: **Python produces facts, the brain
produces prose, the site produces pixels.**

### `site/` — static reader
- No framework, no build step. Reads `site/data/digests.json`.
- Views: **Today** (the latest digest), **Archive** (previous days), and a
  small **Prefs** display (club/timezone labels come from config).
- Deployed to Cloudflare Pages via `deploy.sh` (antifeed's pattern).
- Read-flags or UI state, if any, live in localStorage. No server state.

### `brain/` — daily curation
- `brain/prompt.md` — the curation prompt: voice, quality bar, schema rules.
- `brain/sources.md` — editable source list (prose, not code).
- `brain/curate.sh` — runs headless Claude Code (`claude -p`) with the
  owner's config; the brain:
  1. runs `touchline facts` for ground-truth structured data,
  2. reads the discourse/news feeds (WebFetch),
  3. writes today's digest entry and appends it to `site/data/digests.json`,
  4. validates the JSON (script aborts the commit on failure),
  5. commits and deploys.
- Run manually with morning coffee; automation deliberately deferred.

### `src/touchline/` — facts CLI
- Shrinks to one command: `touchline facts --json` (club/competitions/
  timezone read from config, overridable by flags). Emits a structured
  bundle: yesterday's results, today's and upcoming fixtures, current
  table(s), the club's recent form.
- **Keeps:** `core/models.py`, `sources/football_data.py`, their tests, and
  the graceful-degradation behavior.
- **Retired:** `web/` (FastAPI app, Jinja templates, service worker, icons),
  `render/markdown.py`, `sources/rss.py` (the brain reads feeds directly —
  keeping a Python RSS parser would breach the facts/prose boundary),
  `core/digest.py` heuristics (`result_story`,
  `pick_match_of_the_day`, `pick_what_to_watch`, `fun_fact`,
  `relevant_headlines`) and their tests. FastAPI/Jinja2/uvicorn drop out of
  `pyproject.toml` dependencies.
- Date bucketing ("yesterday" / "today" in the owner's timezone) stays in
  Python — it is fact-shaping, not prose.

## Preferences, not sync

`touchline.config.json` at repo root:

```json
{
  "club": { "name": "Chelsea", "code": "CHE", "subreddit": "chelseafc" },
  "competitions": ["PL", "CL"],
  "timezone": "Asia/Kolkata",
  "feeds": [
    { "label": "The Guardian Football", "url": "https://www.theguardian.com/football/rss" },
    { "label": "BBC Football", "url": "https://feeds.bbci.co.uk/sport/football/rss.xml" }
  ],
  "voice": "calm, sharp, no hype; assumes a fan who missed the day, not a stranger"
}
```

- The facts CLI reads it for club/competitions/timezone.
- The brain reads it for voice, feeds, and the club subreddit.
- The site reads it for labels: `deploy.sh` copies `touchline.config.json`
  to `site/data/config.json` so the static site never depends on repo paths.
- Self-hosting = fork the repo, edit the config, set `FOOTBALL_DATA_TOKEN`,
  run `./brain/curate.sh`.
- No KV, no tokens, no server-side state. Preference sync across devices is
  explicitly deferred.

## Sources

1. **football-data.org** — structured facts. Existing client; free tier
   covers PL, CL, FA Cup-adjacent competitions. Token via env var.
2. **r/soccer top-of-day RSS** (`reddit.com/r/soccer/top/.rss?t=day`) — the
   HN-equivalent: community-voted discourse. Verified working 2026-07-25
   (public `.json` endpoints 403; RSS returns 200).
3. **Club subreddit RSS** (from config, e.g. r/chelseafc).
4. **Guardian Football + BBC Football RSS** — editorial. Verified working.

## Digest entry schema

One entry per date, append-only (past entries are never edited):

```json
{
  "date": "2026-08-16",
  "club": {
    "results": [ { "home": "...", "away": "...", "score": "2–1", "competition": "PL" } ],
    "fixtures": [ { "opponent": "...", "home": true, "kickoff_local": "...", "competition": "PL" } ],
    "table": { "position": 4, "points": 3, "played": 1 }
  },
  "headline": "written by the brain",
  "yesterday": "the story of what happened — prose",
  "today": "what's on and why it matters — prose with a take",
  "wider": [ { "title": "...", "url": "...", "hook": "why this is worth your click" } ],
  "read": { "title": "...", "url": "...", "hook": "..." }
}
```

`club` is structured (the site renders scorelines/table from it); everything
else is brain-written prose. Empty days are fine: `yesterday`/`today` can say
"quiet day" honestly; `wider` keeps the page alive on no-match days.

## Reliability

- `curate.sh` validates `digests.json` (parse + schema check script) before
  committing; aborts on failure — a bad brain run can never ship.
- If a source is down, the brain says so in the digest prose rather than
  silently thinning the page.
- The facts CLI keeps per-record parse tolerance and `ok/error` result
  containers; pytest suite stays green throughout the rebuild.

## Cleanup (no baggage)

The nightshift experiment is over. As part of the rebuild:

- Remove `AGENTS.md`, `MEMORY.md`, `rubrics/`, `ROADMAP.md`, and
  `docs/reviews/` (nightshift process artifacts).
- Rewrite `README.md` for the v2 product and self-hosting story.
- Git history is the archive; nothing else is kept for sentiment.

## Deliberately not built (yet)

Match-detail pages; standings page (the digest's table snapshot replaces
it); PWA install/service worker; Telegram/web push/email delivery; any
server runtime; preference sync; automated daily trigger. Each may return
if the habit sticks.

## Testing

- Python: existing pytest suite, trimmed to surviving modules; new tests for
  the facts bundle (fixed clock, fake sources — the injectable patterns
  already exist).
- `digests.json`: schema-check script exercised by `curate.sh` and runnable
  standalone.
- Site: no build step to test; manual visual check plus one smoke script
  asserting the JSON renders (optional, low priority).

## Success criteria

- By ~Aug 15: KB runs `./brain/curate.sh` with coffee and gets a page worth
  reading in under a minute, every day of the season.
- A stranger can fork, edit `touchline.config.json`, and self-host without
  reading any code.
- Zero live API calls at page-view time; the site is static and instant.
