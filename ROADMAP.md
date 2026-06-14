# Roadmap

Ordered top-to-bottom; the night shift picks the first open `[ ]` item. Keep slices
thin — each must leave the repo green and shippable.

## Night 1 — foundations + first digest

- [x] Project skeleton: core/sources/render/web package layout per README, pydantic models for Fixture/Result/Standing (competition-agnostic), uv + pytest + ruff wiring, one trivial passing test
- [x] football-data.org client in sources/: fetch World Cup fixtures + results behind a SourceInterface, with recorded JSON fixtures for tests and graceful degradation on HTTP errors
- [x] Digest core: given fixtures/results data, generate a DailyDigest (yesterday's results with one-line stories, today's matches with kickoff times in IST, one "match of the day" pick) — pure functions, fully tested
- [x] Restore dedicated tests for core/models.py (lost in PR reconciliation): winner/draw logic, negative-score ValidationError, goal-difference both signs — match the current models, keep the suite green
- [ ] Markdown renderer + `terrace digest` CLI command that prints today's digest

## Night 2 — the surface + the fun

- [ ] FastAPI web app: GET / renders the daily digest as a clean responsive HTML page (Jinja2), mobile-first, installable as a PWA (manifest + icons)
- [ ] News ingestion: pull 2-3 football RSS feeds in sources/, dedupe, attach the 3 most relevant headlines per digest section
- [ ] Standings/groups view: World Cup group tables on the web app, updated from the same source client
- [ ] Digest personality pass: a "what to watch today" section with a strong opinionated pick and one fun fact, generated from data (no LLM dependency yet)

## Later (don't pick up without human re-ordering)
- [ ] Rename the Python package `terrace` -> `touchline` (imports, pyproject `[tool.hatch...packages]`, test imports); repo + identity already renamed. Do this only after the foundational PRs are merged to main.

- [ ] Club mode: configure a club (Chelsea default) and competition set; club digest alongside WC
- [ ] Telegram delivery adapter (reuse solo's bus or bot token)
- [ ] LLM-written digest prose behind a flag, with a quality rubric + eval set
- [ ] Knockout bracket view with scenario explainer ("who advances if...")
