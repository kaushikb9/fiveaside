# Five-a-Side — state of play and what's left

Written 2026-08-23 as a handoff. Read this, then `AGENTS.md`, then
`new-ideas.md` (KB's brain dump) and
`docs/superpowers/mockups/2026-08-23-five-a-side-sketches.html` (the agreed
design, with his comments folded in).

---

## 1. What this is now

Football and FPL for **five friends**, not one person. It began as a Chelsea
digest, became KB's FPL planner, and is now a small group product. Live at
**https://fiveaside.pages.dev** (Cloudflare Pages project `fiveaside`).

Three rooms were agreed. **Two exist.**

| Room | URL | Job | Status |
|---|---|---|---|
| **the gaffers** | `/` | How the five are doing, what each should do next | partial |
| **touchline** | `/digest/` | What happened in the league since you last looked | working |
| **locker room** | `/locker/` | Everything we know about every player | **not built** |

The five, by nickname (real names are never used anywhere — see §4):

| Nick | Team | Club | Entry |
|---|---|---|---|
| Xabi | Wabi Sabi Xabi | Chelsea | 7149204 |
| Sir Alex | Youri kiddin' me! | Man Utd | 58500 |
| Ronaldo | Yogesh11 | Man Utd | 522356 |
| Enzo | WorldChamps | Chelsea | 6485401 |
| Arsene | IceMan | Arsenal | 4135179 |

Mini-league **FPL 26-27** (id `391164`) has 11 entries; the five are a subset
and the other six are context.

---

## 2. Architecture

**Python produces facts → the brain produces judgment → the site produces
pixels.** That boundary is the point of the repo; don't leak across it.

```
uv run touchline facts  ─► digest facts bundle ─► brain/prompt.md ─► digests.json
uv run touchline fpl ─┬─► brain/split-facts.mjs ─► players.json   (mechanical)
                      │                         ─► gaffers.json   (mechanical)
                      └─► trimmed bundle ───────► fpl-prompt.md ──► fpl.json (judgment)
                                    browser ────► /api/live       (Pages Function)
```

**Why the split matters.** The player file is ~600 records and the squads are
five more; routing them through an LLM cost ~106k tokens a run to copy numbers
verbatim. `brain/split-facts.mjs` writes them straight to disk and hands the
brain the remainder (~38KB). Mechanical facts must never go through the prompt
again.

**Files**

- `site/data/players.json` — every player, evidence only. Validator:
  `brain/validate-players.mjs`. Never brain-written.
- `site/data/gaffers.json` — five squads, picks, standings. Never brain-written.
  **No validator yet** (see todos).
- `site/data/fpl.json` — the brain's judgment. Validator: `brain/validate-fpl.mjs`.
  Living document: state replaced each run, `log[]` append-and-settle.
- `site/data/digests.json` — the league page. **Append-only**, 23 entries.
  Validator: `brain/validate.mjs`.
- `functions/api/live.js` — same-origin proxy of the FPL API (it sends no CORS
  headers), joining fixtures + picks + league server-side. `deploy.sh` asserts
  the Functions bundle uploaded.

**Verdict vocabulary (fixed, do not change without rewriting every record):**
`nailed` · `solid` · `watch` · `sack`, plus a direction `up`/`down`/`new`/`held`.
"Slipping" is a direction, not a rung. Every verdict carries a `why` (one plain
sentence) and a `trigger` (what would change our mind, written before the fact
so the retro can settle it).

---

## 3. What works today

- **touchline** (`/digest/`) is a genuine league page: top-level table (top six
  plus every followed club, focus-marked), a 5–8 item week feed tagged PL/FPL
  and attributed to clubs, one filter that narrows the feed *and* the table,
  `top_teams` for the six, `elsewhere` for everyone else, team watch, rumours.
  The brain produced a good one on 2026-08-23.
- **the gaffers** (`/`): gaffer selector (five chips, remembered), gameweek
  arrows, live fixtures, per-person desk and pitch, "the five" table with the
  other six behind a disclosure.
- **Live gameweek data** works: real scores with a clock, per-player live points,
  provisional bonus derived from live BPS, live mini-league.
- **The player card** opens from any player name on the gaffers page.
- **Brand**: Five-a-Side wordmark, five-player quincunx icon, room names in nav.
- 100 pytest, ruff clean, three validators green.

---

## 4. Known debt — read before building

1. **`fpl.json` is still single-person.** `watchlist`, `wagers`, `log`, `plan`
   are one shared set rendered under whichever gaffer is selected, which is
   misleading: they are all KB's. This is the single biggest correctness gap.
2. **Four-seams drift** (the repo's #1 recurring bug class, per AGENTS.md):
   - `race` and `season` in fpl.json are **dead data** — the renderer replaced
     `race` with the five-table from `gaffers.json`, but the prompt still
     instructs writing it and the validator still checks it.
   - `callHTML` and `raceHTML` in `site/app.js` are **orphaned functions**
     (`deskHTML` is transitively dead through `callHTML`).
   - The prompt still tells the brain to write `call`, `squad`, `desk` and
     `race`. `call` was explicitly dropped in the design; `desk`/`squad` are
     now superseded by `gaffers.json`.
3. **"The commons" divider is a leftover.** It was the public/personal seam of
   the sync gate, which was removed when the page became the group's. Everything
   on the page is common now, so the label is meaningless and should go — along
   with re-homing what sits under it (see todo 2).
4. **No validator for `gaffers.json`**, and no real-name backstop on it (the one
   in `validate-players.mjs` should be mirrored).
5. **Real names**: deleted at the facts layer in `core/fpl.py`, with a test
   (`test_real_names_never_reach_the_bundle`). Team names survive by design —
   "Yogesh11" contains a first name and that is KB's accepted call. Never
   reintroduce `player_name`, `manager`, or first/last name fields.
6. **Reddit** is unreliable from this pipeline (r/reddevils failed five retries
   on 2026-08-23). Fallbacks: FFScout via curl, Google News RSS, BBC/Guardian.

---

## 5. Todos, end to end

Ordered so each step is shippable on its own.

### A. Finish the rooms

1. **Build the locker room** (`/locker/`). A shell was started and deliberately
   removed rather than left broken — start clean.
   - Reads `players.json` + `fpl.json.verdicts`; reuse the player-card markup
     and CSS that already exist in `site/app.js` (`playerCardHTML`).
   - Sections: **injury room** (players with `status`/`news`, ours first),
     **the file** (filter chips: ours / nailed / solid / watch / sack / flagged,
     plus a search box — 604 rows needs a default view, suggest "ours"), and
     **fixture runs** moved here from the gaffers page.
   - Rows are verdict-led: word, then name, then one line of why.
2. **Kill "the commons"** on `/`. Move `signals` (team news) and `fixtureRuns`
   into the locker room; keep `captain_poll`, `bus` and `chips` on the gaffers
   page as decision aids. Delete the `commons-rule` divider and its CSS.
3. **Add the locker room to the nav** in all four page shells.

### B. Make it genuinely five-handed

4. **Per-person editorial in `fpl.json`.** Restructure to
   `people: [{ nick, watchlist[], wagers[], week: {worked, didnt, next} }]`
   with `doctrine` staying house-wide (agreed in the sketches; per-person
   ledger is an explicit trial that can collapse back to one).
   Update in one branch: schema → `validate-fpl.mjs` → `fpl-prompt.md` →
   `site/app.js`. This is the four-seams rule; do not do them separately.
5. **"What worked / what didn't / what's next"** — the three-block weekly read
   that replaces `call`. Per person, written post-gameweek.
6. **Delete `call`, `squad`, `desk`, `race`** from prompt, validator and
   renderer once (4) and (5) land, and remove the orphaned functions.

### C. The fun

7. **The roast.** The render slot already exists (`data.roast.text`). Rules are
   agreed and written in the sketches: post-gameweek only (never daily), only
   ever about a decision with the fact attached, never the same person twice
   running, and it must roast the machine too. Needs a settled gameweek to have
   material — GW1 settles after Chelsea–Fulham on Mon 24 Aug.
8. **Player-file ownership diffs** as roast fuel — the card already shows who
   owns whom; "four of five own Haaland, Sir Alex does not" writes itself.

### D. Hygiene

9. **Validator for `gaffers.json`** + real-name backstop.
10. **Verdict coverage**: only 10 verdicts exist against 604 players. The prompt
    asks for 25–50 covering everyone owned plus anyone in the news. Confirm the
    next brain run actually does it.
11. **`auto.sh`** runs both products hourly from 07:00 with independent
    freshness guards. Check `brain/auto.log` after the first run following any
    schema change — a rejected run quarantines to `brain/scratch/` and retries.
12. **Deferred by decision, do not build unless asked**: KV-backed ☆ stars
    (localStorage only for now), friend-facing team-ID entry, any auto-refresh
    or realtime behaviour, accounts/auth.

---

## 6. Open questions for KB

- The locker room's default view: everyone (604), or just the players the five
  own (38)? Recommend the latter, with filters to widen.
- Per-person ledgers were agreed as a trial. If five ledgers prove to be four
  too many, collapse to one house ledger — his call, after a few weeks.
- The Chelsea digest was split out on 2026-08-23 into its own repo,
  `~/Code/touchline-chelsea` (Pages project `touchline-chelsea`). It runs
  weekly on Mondays, carries no FPL and no league-wide sections, and exists
  only as a fallback — **retire it once the three rooms here are finished**.
  `touchline-pl` was deleted the same day.
