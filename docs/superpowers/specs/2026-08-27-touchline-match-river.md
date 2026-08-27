# touchline: a calendar-driven match river across all competitions

**Status:** draft for KB sign-off · 2026-08-27
**Scope:** the touchline front page (`/`) only. The gaffers room is untouched.

---

## Context

touchline is KB's front page for following Premier League clubs. Following a
club means following it everywhere it plays, not only in the league: a Tuesday
Champions League tie or a January FA Cup third round is exactly the thing you
open the page for.

The page cannot show those matches at all today, and the reason is structural
rather than cosmetic.

## Current state (verified 2026-08-27)

`functions/api/matches.js` is built on the **FPL API**. It reads FPL `events`
(gameweeks) plus that gameweek's fixture list:

- `functions/api/matches.js:23` — `const API = "https://fantasy.premierleague.com/api"`
- `functions/api/matches.js:13-14` — returns `{ now: WEEK|null, next: WEEK|null }`,
  `WEEK = { gw, name, deadline, status, fixtures[] }`
- `site/app.js:120-133` — three tabs: Table, "This match week", "Next match week"
- `site/app.js:98-109` — `activeTab()`, a smart default that opens on scores
  when a match is live or finished within 26 hours, else the table

Two consequences, both observed:

1. **An FPL gameweek is a Premier League construct.** No cup or European tie
   exists inside one, so those matches cannot appear in either tab. There is no
   filter to loosen; the data model has no room for them.
2. **"Current" gameweek stays current from the last whistle until the next
   kickoff** (`functions/api/matches.js:16-19` says so explicitly, and it is the
   right call for FPL). So from Sunday evening to Friday the page shows a
   finished weekend and an empty midweek, which is precisely when European
   nights are being played.

What already works and must not regress: live in-play scores, goalscorer names
rendered as player-card links via `FA.linkPlayers`, crests, and the
degrade-never-crash behaviour (a dead sub-fetch drops its week, not the
response).

### What the sources can already do

| Capability | Where | Status |
|---|---|---|
| ±120/+45 day match window per competition, one request | `src/touchline/sources/espn.py:141-146` | already built |
| Competition slug map | `src/touchline/sources/espn.py:12` | 3 entries, one line each to add |
| Goalscorers | ESPN `competitions[].details[]` | richer than FPL — see below |
| PL club list | ESPN `eng.1` standings | already fetched for the table |

ESPN's scoreboard carries **more** than FPL: goal minute (`clock.displayValue`),
goal type (header / penalty), own goals, and cards. `functions/api/matches.js:40-42`
currently says "FPL reports who scored but never when, so the line is names and
counts — no invented clock." That constraint goes away.

## Decisions taken (KB, 2026-08-27)

| # | Decision | Choice |
|---|---|---|
| D1 | What replaces the tabs | **One chronological river**, date-grouped, today anchored |
| D2 | Score freshness | **Widen the live proxy** to ESPN, all competitions |
| D3 | Competitions | **PL, UCL, Europa, Conference, FA Cup, EFL Cup** |
| D4 | Window | **7 days back, 7 forward** |
| D5 | Which matches | **Only if a Premier League club is playing** |
| D6 | Layout | **Keep a two-tab strip**: Table \| Matches |

## Proposed change

### 1. `functions/api/matches.js` — rewritten against ESPN

```
GET /api/matches
  -> {
       updated: ISO8601,
       days: [
         { date: "2026-08-23",              // local date, Europe/London
           matches: [
             { id, competition: "UCL", competition_name: "Champions League",
               kickoff: ISO8601,
               status: "SCHEDULED"|"LIVE"|"FINISHED",
               minute: "67'"|null,           // LIVE only
               home: { name, short, crest, score|null },
               away: { name, short, crest, score|null },
               scorers: [ { name, team: "home"|"away", minute: "33'",
                            og: bool, pen: bool } ]
             } ]
         } ],
       errors: [ "EL: 502" ]                 // per-competition, never fatal
     }
```

- One ESPN scoreboard request per competition (6), `dates` bounded to the ±7 day
  window, `cf: { cacheTtl: 60, cacheEverything: true }` as today.
- **PL club filter (D5):** fetch `eng.1` standings once per request (same cache),
  take the 20 club names, keep a match only if either side is in that set. This
  is the one piece with no existing precedent — see Risks.
- **Degrade, never fail:** a dead competition drops its matches and appends to
  `errors[]`. All six dead still returns `200` with `days: []`.

### 2. `site/app.js` — the river

- Replace `weekPaneHTML` with `riverHTML(days)`: a date-grouped list, one heading
  per day (`SAT 23 AUG`), a `today` rule inserted between the last past day and
  the first future day.
- Panel keeps a two-tab strip (D6): `Table` and `Matches`.
- `activeTab()` logic survives unchanged in spirit: open on `Matches` when any
  match is live or finished within 26 hours, else `Table`.
- Competition shown per row as a short tag (`PL`, `UCL`, `EL`, `FA`, `EFL`).
- Club names print through `FA.club()`, which already exists.
- Goalscorers keep `FA.linkPlayers`, and now carry a real minute.

### 3. Python facts layer — cup awareness for the brain (small, separable)

- `src/touchline/sources/espn.py:12` — add four slugs to `_LEAGUE_MAP`:
  `eng.fa`, `eng.league_cup`, `uefa.europa`, `uefa.europa_conf`.
- `touchline.config.json` `competitions` — add the four codes.
- Effect: the digest prose can mention a cup tie. **No** change to
  `site/data/table.json`, which stays Premier League only per KB's earlier call
  (`split-league.mjs` already picks `code === "PL"` explicitly).

## Acceptance criteria

1. On a Wednesday in a European week, `/` shows that night's UCL fixtures
   involving PL clubs, above the fold of the Matches tab.
2. A completed match shows its score; a live match shows score plus minute; a
   scheduled match shows local kickoff time.
3. Bayern v Real Madrid does **not** appear. Chelsea v Benfica does.
4. Goalscorer names remain clickable and open the correct player card
   (`data-pid`, per today's fix).
5. The Table tab is unchanged: 20 rows, Premier League, real form.
6. With all six ESPN competitions returning 502, `/api/matches` returns HTTP 200,
   `days: []`, `errors.length === 6`, and the page renders the Table tab with a
   plain "no matches" note rather than an error.
7. `brain/test/smoke.sh` passes with no reduction in check count.
8. The gaffers room still runs on FPL gameweeks, unchanged.

## Testing plan

| Layer | What | Count |
|---|---|---|
| Unit (py) | `_LEAGUE_MAP` resolves all 6 codes; unknown code still errors cleanly | +2 |
| Unit (py) | `build_facts` buckets a cup result into `competitions[]` | +1 |
| Fixture | ESPN scoreboard parse: scorer minute, own goal, penalty | +3 |
| Integration | `/api/matches` PL-club filter keeps/drops the right ties | +2 |
| Integration | all-competitions-fail returns 200 with `errors[]` | +1 |
| Smoke (live) | Matches tab renders, today rule present, comp tags present | +4 |

## Rollback

`functions/api/matches.js` and `site/app.js` are the only shipped surfaces; both
are a single `git revert` of one commit. The Python competition additions are
additive and independently revertable (two lines). No data migration, no KV
write, no schema change.

## Effort

| Component | CC |
|---|---|
| `matches.js` rewrite against ESPN + filter | ~45 min |
| `app.js` river + tabs + mockup round | ~45 min |
| Python competitions + tests | ~15 min |
| Smoke checks + live verification | ~20 min |

## Files

| File | Change |
|---|---|
| `functions/api/matches.js` | rewritten: ESPN, 6 competitions, ±7d, PL filter |
| `site/app.js:98-146` | river replaces two week panes; two-tab strip |
| `src/touchline/sources/espn.py:12` | +4 competition slugs |
| `touchline.config.json` | +4 competition codes |
| `tests/test_espn.py` | scorer/minute/own-goal parse |
| `brain/test/smoke.sh` | +4 checks |

## Out of scope

- The gaffers room and anything FPL-gameweek shaped.
- "Around the top" / "Elsewhere" allegiance panels (KB deferred these earlier today).
- The league table's source, contents or PL-only scope.
- Any change to `site/data/table.json` or `split-league.mjs`.

## Risks

1. **The PL-club filter needs a club list.** Deriving it from `eng.1` standings
   adds a 7th request per call. Alternative: read the 20 names from
   `site/data/table.json`, which the Function can fetch from its own origin and
   which is already correct. Cheaper, and one less external dependency —
   **recommend this**, flagging it as a deviation from the obvious approach.
2. **Two parsers of the same ESPN payload** — Python (`espn.py`) for the brain,
   JS (`matches.js`) for the page. They serve different consumers and neither
   can reuse the other across the runtime boundary. Acceptable, but worth naming
   so nobody later "fixes" it into a shared abstraction that cannot exist.
3. **ESPN is an unofficial API.** It is already the configured source
   (`touchline.config.json: "source": "espn+thesportsdb"`), so this adds
   exposure, not a new dependency.
4. **Pre-season.** `FRIENDLIES` stays in the Python config as today, but the
   river does not include it (D3), so July will be sparse. Deliberate.

## Open question for KB

The mockup. D6 keeps a tab strip, so the Matches tab needs a look before it is
built — row density, where the competition tag sits, how the today rule reads on
a 390px phone. That is a static mockup round before any change to `site/app.js`.
