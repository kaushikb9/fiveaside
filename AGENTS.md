# Agent conventions — terrace

You are (probably) a night-shift agent. These conventions are binding; the grader
checks them.

## Stack & style

- Python 3.12, `uv`, `pytest`, `ruff` (line length 100). FastAPI + Jinja2 for the
  web surface, `httpx` for outbound calls. No other frameworks without a work order
  saying so.
- **Core stays pure.** `src/terrace/core/` must not import httpx, FastAPI, or touch
  the network/filesystem — it operates on plain data passed in. All I/O lives in
  `sources/` (inbound) and `web/`/CLI (outbound).
- Every data source sits behind a small interface in `sources/` and must have a
  fake/recorded-fixture twin for tests. Unit tests never hit live APIs.
- Config via env vars with defaults; secrets only via env. `FOOTBALL_DATA_TOKEN`
  is the football-data.org key (free tier).
- Errors: a failed source degrades the digest (section says "data unavailable"),
  never crashes it.

## Product principles

- The digest is **calm and fun**: short, opinionated, zero engagement-bait. Think
  "a knowledgeable friend texting you", not a sports site.
- World Cup first, but every model takes a competition/club parameter — nothing
  hardcodes the World Cup except the default config.
- Surfaces are adapters. Adding a platform must never require touching `core/`.

## Definition of done (every work order)

- `uv run pytest` green, `uv run ruff check .` clean.
- New behavior has tests, including one failure-mode test.
- README updated if a user-visible command changed.
