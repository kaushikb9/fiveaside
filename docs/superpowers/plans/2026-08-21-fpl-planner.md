# Touchline FPL planner — new tab + daily brain + day-0 squad

## Context

KB plays Fantasy Premier League. The 2026–27 season's GW1 deadline is
**tonight: 2026-08-21 17:30 UTC = 23:00 IST** (first kickoff 00:30 IST).
He has no team yet. He wants, inside touchline (frontend-only static site,
same model as the digest):

- a new **FPL tab** that researches daily (or on demand): FPL API data,
  injury/team news, fixture difficulty, fan discourse — with a standing
  watchlist of players/teams/fixtures and a season-long plan;
- **day-0 deliverable**: a definitive 15-man squad (captain, vice, bench
  order, budget) optimized for GW1–3 while structured for the long term;
- a weekly learning loop — track what we called, score it, improve;
- later: his team_id/league_id for deeper in-season analysis.

Interview answers (locked): **balanced conviction** (safe premium core +
2–3 researched bets), **strictly points** (no Chelsea bias), **one
definitive call** with reasoning, **straight to live** today (mockup rule
waived for the deadline; v1 live page is the mockup, iterate after GW1).

Verified today: FPL API is keyless and live (599 players, prices,
ownership, status/news, fixtures with FDR; GW1 deadline confirmed from
`bootstrap-static`). r/FantasyPL via old.reddit RSS → 200; Google News RSS
returns current GW1 press-conference news. The player pool has changed
materially vs pre-training knowledge (promoted COV/HUL/IPS; WHA/WOL out;
big transfers) — **everything must be built from fetched data, never from
model priors.** Pre-season results are explicitly noise.

## Done when / Reject if

**Done when:**
1. FPL tab live at touchline-chelsea.pages.dev/fpl/ showing: the day-0
   squad call, watchlist, triaged signals, 20-team × 6-GW fixture ticker,
   season plan, and (empty for now) learning log.
2. The recommended squad — legal (£100m, max 3/club, 2 GK/5 DEF/5 MID/3
   FWD), captain+vice+bench order — is delivered in chat AND on the page
   well before 23:00 IST, with reasoning grounded in cited research.
3. Daily pipeline exists end to end: `uv run touchline fpl` facts →
   `brain/curate-fpl.sh` → validated `site/data/fpl.json` → auto.sh runs
   it under its own freshness guard.
4. `uv run pytest -q`, `uv run ruff check .`, `node brain/validate-fpl.mjs`,
   `node --check` on new JS all green; digest page untouched and working.

**Reject if:**
- Recommendations read as hype-following (pre-season form, recency noise,
  "everyone says") rather than reasoned conviction.
- The page breaks or half-renders when fpl.json is missing/junk (must
  degrade to header + quiet empty state).
- Schema seams drift (facts bundle / prompt / validator / renderer changed
  independently).
- Digest page/data affected in any way beyond the nav link.

## Architecture (summary)

Mirrors the digest machine exactly, one seam each:

| Seam | Digest | FPL planner |
|---|---|---|
| Facts (Python) | `uv run touchline facts` | `uv run touchline fpl` — new subcommand: bootstrap-static + fixtures, compacted |
| Brain | `brain/prompt.md` + `curate.sh` | `brain/fpl-prompt.md` + `curate-fpl.sh` |
| Schema authority | `brain/validate.mjs` | `brain/validate-fpl.mjs` |
| Data | `site/data/digests.json` (append-only) | `site/data/fpl.json` (**living state** + bounded `log[]` — deliberate divergence) |
| Renderer | `site/app.js` → `#main` | `site/fpl/index.html` + `site/fpl/fpl.js` (about-page pattern) |
| Nav | — | tab links in `.strap` on both pages: `today · fpl` |
| Schedule | auto.sh: digest date == today | parallel guard: fpl.json generated_at date == today |
| Deploy | `deploy.sh` (site/ wholesale) | no change needed |

## site/data/fpl.json — the contract (schema authority: brain/validate-fpl.mjs)

A **living document**: current-state sections replaced wholesale each run;
`log[]` is append-and-settle (open entries get settled with hit/miss +
lesson; settled entries frozen; ≤1/GW so bounded at 38/season). This is a
deliberate divergence from digests.json's append-only rule — documented in
fpl-prompt.md and AGENTS.md. Seed `{"log": []}` committed before any brain
run so the quarantine `git checkout --` path works from run 1.

Top-level (all sections optional-when-absent; page renders what exists):

- `generated_at` ISO (stamped by curate-fpl.sh) · `season` "2026/27"
- `gameweek` — `id`, `deadline_utc`, `deadline_local` (pre-formatted IST
  string, matching the repo's `kickoff_local` convention)
- `call` — the ONE definitive recommendation: `headline`, `reasoning`
  (prose), `captain`, `vice`; OPTIONAL `moves[]` `{out,in,cost,note}`
  (in-season only — omitted on day 0; this is how one schema serves both
  modes), `chip`, `alternatives[]` (max 2, only when genuinely close).
  `call` present ⇒ `squad` present.
- `squad` — `formation` "d-d-d", `bank`, `players[15]`:
  `{name, team (3-letter), pos GK|DEF|MID|FWD, price, role start|bench}`
  + `bench_order` (req iff bench, 1–4 unique), `captain`/`vice` bools,
  `bet` bool (the researched differentials), `note`. Validator enforces
  FPL legality: 2/5/5/3 positions, 11/4 split, one C + one V among
  starters, ≤3 per club, C/V names match `call`. v1: squad = recommended
  state; when team_id lands it becomes actual picks from `/api/entry/` —
  schema unchanged, only the source.
- `watchlist[]` — `{name, team, pos, price, status rising|hold|cooling,
  note}` + optional `ownership`. **Ships on day 0** (explicit part of the
  ask).
- `signals[]` — triage, ≤6: `{tag injury|rotation|price|news, text,
  source, action}` + `player`/`team` (≥1), optional `url`.
- `ticker` — **copied verbatim from the facts bundle** (FDR is fact, not
  prose): `from_gw`, `gws:6`, `rows[20]` `{team, avg, fixtures[]:
  {gw, opp, home, fdr 1–5}}`, pre-sorted best-run-first by Python.
  Flat per-GW list, so blanks/doubles fall out naturally later.
- `plan` — `outlook` prose + optional `items[]` `{label, when, note}`
  (chips, swap windows). Brief on day 0.
- `log[]` — `{gw, date, call, verdict hit|miss|open}` + optional
  `outcome`, `lesson`. Day 0 writes one `open` entry.

## Files

**Python (facts):** `uv run touchline fpl`
- `src/touchline/sources/fpl.py` — `FPLClient` (httpx, injected client for
  tests, `base_url` param, 10s timeout) fetching `/bootstrap-static/` and
  `/fixtures/` (one whole-season call); frozen pydantic result models with
  `ok/error` degradation, mirroring `sources/espn.py` + `sources/base.py`.
- `src/touchline/core/fpl.py` — pure, injected `now`:
  `build_fpl_facts(bootstrap, fixtures, config, *, now)` → bundle: `date`,
  `timezone`, `gameweek` (next unfinished event by deadline),
  `next_deadlines[3]`, `teams[20]`, `ticker` (§above, shaped exactly as
  fpl.json's so the brain copies wholesale), `players` (compaction: top-N
  per position by ownership — GK15/DEF45/MID55/FWD35 ≈150 — union all
  flagged `status!="a"` with own ≥0.5% or price ≥5.5; fields
  name/team/pos/price/ownership/form/points/status + news/chance only when
  non-empty ≈ 30 KB), `errors{bootstrap,fixtures}` (non-null errors → the
  brain must say so, never silently thin the page).
- `src/touchline/config.py` — frozen `FPLConfig` (`team_id: int|None`,
  `league_ids: []`, `horizon_gws: 6`), default-factory field on
  `TouchlineConfig`; `touchline.config.json` gains the matching `"fpl"`
  block.
- `src/touchline/cli.py` — `fpl` subparser mirroring `facts`.
- `tests/test_fpl.py` (+ trimmed fixtures under `tests/fixtures/fpl/`):
  client parse + degrade on 500; gameweek pick + IST deadline + ticker
  sort/opp/fdr; compaction keeps flagged/drops fringe. `tests/test_cli.py`
  addition for the subcommand.

**Brain:**
- `brain/validate-fpl.mjs` — clone of validate.mjs idiom (zero-dep,
  `fail()`, breadcrumb `where`, `!== undefined` guards) with the legality
  cross-checks above.
- `brain/fpl-prompt.md` — same skeleton as prompt.md: role (FPL
  co-manager, one page, one definitive call) → ground truth vs judgment
  (bundle verbatim for prices/flags/FDR; picks are judgment,
  **points-only, no club sentiment**; players outside the compacted bundle
  must be verified against the live API before writing in) → sources
  (old.reddit r/FantasyPL RSS, Google News RSS press-conference/injury
  queries, bundle `news` as injury baseline) → editorial rules (balanced
  conviction; anti-hype: pre-season stats are noise, template panic is
  noise, price-FOMO is not a transfer reason; every `bet:true` carries a
  researched reason; signals are triage ≤6; empty sections omitted, never
  padded) → file contract (living doc + log append-and-settle) → modes
  (day-0: full squad, no `moves`; weekly: settle log, 0–2 moves with hit
  math, captain/lineup call) → full schema example → "run
  `node brain/validate-fpl.mjs` before finishing".
- `brain/curate-fpl.sh` — line-for-line mirror of curate.sh: facts from
  `uv run touchline fpl`, same `claude -p` flags, diff-guard → stamp
  (the existing `{...d, generated_at}` one-liner works unchanged) →
  validate-or-quarantine (`brain/scratch/rejected-fpl-$TODAY.json`,
  restore) → commit `"fpl: $TODAY"` → push → deploy unless `--no-deploy`.
- `brain/auto.sh` — compute two freshness flags (digest latest date;
  fpl.json `generated_at` date, try/catch to empty) and run each due
  script with `|| echo "[auto] … failed"` guards so neither starves the
  other under `set -e`. Morning gate (≥07:00) applies to both;
  deadline-eve updates are manual/on-demand runs.

**Site:**
- `site/fpl/index.html` — about-page pattern: standalone, `../style.css?v=2`,
  theme pre-paint script verbatim, masthead links to `../`, strap =
  `daily digest · FPL planner`, `<main id="main">`, same footer,
  `<script src="app.js">`. Title `fpl · Touchline`.
- `site/fpl/app.js` — structure copied from site/app.js: own `esc()`,
  `loadJSON("../data/fpl.json")`, theme toggle duplicated (the about page
  already set this precedent; site/app.js stays untouched); one pure
  `xHTML(data)→string` per section, early-return `""`; sections: call
  header (eyebrow `GW1 · deadline …`, h1 = headline, reasoning),
  moves/chip/alternatives, squad boards by unit (C/V/bet pills, bench
  dimmed), watchlist (reuses `.players`/`.player` block), signals (reuses
  `.rumour` + `.heat` pill pattern), FDR ticker grid (new markup), plan,
  log (verdict → existing `.pill` w/l/d classes). Any failure or missing
  data → header + quiet `.empty` state. Everything through `esc()`.
- `site/style.css` — marked additions block: `--fdr1…--fdr5` tokens in
  **all four** theme blocks; `.fdr` grid; `.wl.*` status colors; bench
  dimming. Cache-bust `?v=2` in all three HTML files.
- `site/index.html` — one strap addition: `· FPL planner` link (about
  stays in the footer; no nav rebuild).

**Docs:** one Map line + the living-doc divergence note in AGENTS.md;
plan copy to `docs/superpowers/plans/2026-08-21-fpl-planner.md`.

## Day-0 execution (tonight, after build)

Authored **in this session by me** — not a headless `claude -p` run —
following fpl-prompt.md's own rules, validated by validate-fpl.mjs, so
it's steerable and the squad lands in chat. The headless pipeline takes
over tomorrow morning via auto.sh (its failure mode is safe: quarantine +
retry next hour).

Research protocol (all verified reachable):
1. Facts bundle from `uv run touchline fpl` (live prices, ownership,
   flags, FDR, deadlines).
2. Fixture runs GW1–6 from the ticker → which teams' assets to target.
3. Discourse sweep: r/FantasyPL hot/top-day RSS; Google News RSS for
   Thu/Fri press-conference injury roundups (all 20 clubs are doing GW1
   pressers right now); scout-site headlines via Google News.
4. For shortlisted players, `/api/element-summary/{id}/` `history_past`
   for last-season baselines (keyless) — priors come from fetched data,
   never from model memory (pool has changed massively).
5. Squad build: balanced conviction — premium core justified by fixtures
   + role security; 2–3 `bet:true` differentials each with a structural
   reason (minutes, set pieces, role change, fixture run); bench that
   actually plays; captaincy path for GW1–3; strictly points, no Chelsea
   thumb.

Deliverables before ~21:00 IST (2h buffer to the 23:00 deadline): squad +
reasoning in chat, live page at /fpl/, day-0 fpl.json with one open log
entry.

## Order & verification

1. Build in parallel tracks (Python / site / brain files are independent
   once the schema above is fixed).
2. Verify: `uv run pytest -q` · `uv run ruff check .` · real
   `uv run touchline fpl` output eyeballed (GW1 deadline, ticker sane,
   size ≲50 KB) · `node --check site/fpl/app.js` ·
   `node brain/validate-fpl.mjs` passes on a hand sample AND fails
   loudly on a deliberately broken squad · `node brain/validate.mjs`
   still green · local `python3 -m http.server` smoke of both pages,
   both themes, plus the seed-file empty state.
3. Commit all code (quarantine path sound before any brain edit).
4. Day-0 research + authoring (in-session), validate, deploy, check
   https://touchline-chelsea.pages.dev/fpl/ live, hand over squad.
5. Tomorrow: auto.sh's first scheduled fpl run exercises the headless
   path; check brain/auto.log.
