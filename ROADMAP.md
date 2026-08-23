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

**All three rooms are built and live.** `touchline` at `/`, `the gaffers` at
`/gaffers/`, `the locker room` at `/locker/` — one shell, one nav, one theme
(Dugout light / Floodlit dark, Auto by default), and the seam that makes them
one product: any player name in the first two opens their locker-room card.

- **touchline** — the league table with focus clubs marked by rule, the week
  feed with one control that narrows it and dims the table together, team
  watch, around the top, elsewhere, rumours, and the links worth a click.
  Every earlier entry is in the archive behind a fold.
- **the gaffers** — a headline computed from the five squads alone, the
  long-game guard, five gaffer chips, the league table collapsed, the weekly
  read, **the pitch** (club kits, captain armband, gameweek navigation
  backwards to settled weeks and forwards to fixtures), per-person
  watchlists with KV-backed stars, the roast, what the crowd missed, and the
  chip clock.
- **the locker room** — the file (gated at >2% ownership, never dropping
  anyone the five own, with verdict-led rows and a live threshold control),
  the injury room, team news, and the fixture runs.
- **Live gameweek scores.** `/api/live` proxies the official API (which sends
  no CORS headers) and the gaffers room has a fetch-on-demand control:
  matches in play with the clock, and the pitch overridden with live points
  including provisional bonus. Never polls; degrades to the snapshot and says
  so.
- **`/api/stars`** is bound to a real KV namespace and verified end to end.
- **Editorial is written.** The gaffers brain produced five weekly reads, 36
  verdicts (weighted to `watch`, correctly for GW1), and two new doctrines —
  and declined to write a roast because GW1 is unfinished, which is the rule.
- **`brain/test/smoke.sh <url>`** runs 48 checks over the whole product —
  every room, both themes, every control, the card seam, and phone width.
  Green against production.

## 4. Known debt — read before building

1. **`gaffers.json` stores only the current gameweek's picks.** The pitch's
   back-step therefore pairs *this* week's squad with *that* week's points,
   and says so on the page. Fix: store picks per gameweek from
   `entry/{id}/event/{gw}/picks/`, which already returns everything needed.
   Captaincy and the multiplier now survive, so this is the last piece.
2. **The brain invents things it was never given.** It wrote the owner's real
   name into `fpl.json` from repository context, and it was live until
   2026-08-23. `validate-fpl.mjs` has a banned-key backstop now. Treat any
   fact in `fpl.json` as unverified unless a validator or a test checks it.
3. **Only 10 verdicts exist against 609 players.** The prompt asks for 25–50.
   Confirm the next run actually delivers, and that each carries a real
   trigger rather than "if he plays badly".
4. **The machine sleeps mid-run.** `pmset` has `sleep 1` on AC, so an
   unattended brain run dies unless wrapped in `caffeinate -dimsu`. `-i`
   alone is not enough. `auto.sh` should wrap its own runs.
5. **The Bus** — the set-and-forget reliability benchmark from the original
   dossier — is not built and not in the schema. It was never asked for again
   after the mockup rounds; say if it should come back.
6. **Reddit** is login-walled; `brain/sources.md` has the fallbacks.

## 5. Todos, end to end

1. **Per-gameweek picks** (debt 1) — unblocks an honest back-step, chip
   history, and any retro that compares what was picked with what scored.
2. **Verdict coverage** (debt 3) — the locker room is only as good as this.
3. **`auto.sh` wraps runs in `caffeinate`** (debt 4).
4. **The roast needs a settled gameweek.** GW1 finishes after the last match;
   the rule is post-gameweek only, so the first real one lands then.
5. **Retire `touchline-chelsea`** once these rooms have run for a week.
6. **Deferred by decision**: friend-facing team-ID entry, any auto-refresh or
   realtime behaviour, accounts/auth.

## 5b. Settled by review, 2026-08-23 — do not re-litigate

From KB's comment export (`docs/superpowers/comments/2026-08-23-rooms-comments.md`),
all built into the mockup:

- **One platform, three areas**, in this order: **touchline &rarr; the gaffers
  &rarr; the locker room**. Touchline becomes the front door; `/` is the
  gaffers today, so this is a move. The rule for what goes where: touchline is
  what happened, the gaffers is what we did about it, the locker room is what
  we know.
- **Theme is settled**: Dugout light, Floodlit dark, one design in two lights,
  Auto by default. Teamsheet archived.
- **Dropped entirely**: the wagers panel, and the captain poll. The poll is
  replaced by *what the crowd missed* — under 10% owned, sorted by points.
- **The player file** is gated at **>2% ownership** (125 players), never
  dropping anyone the five own, and opens on **ours**. KB: "we can recalibrate
  later if needed" — the number is a config knob, not a decision to redo.
- **Watchlists stay per-person**, stored in **KV keyed by `gaffer_id`**. This
  reverses the earlier "localStorage only" deferral: stars must survive across
  devices and the house list must be shared.
- **The league table collapses** behind a one-line summary; the gaffer chips
  carry team name and club colour instead.
- **Gaffer nicknames get their own visual treatment** in the gaffers room, and
  deliberately not in touchline, where "Enzo" means Enzo Maresca.
- **Focus clubs are a rule, not a list** (KB: "don't be static"). Three are
  permanent by allegiance — Chelsea, Manchester United, Arsenal, because that
  is who the five support. Until **GW10** the other two are seeded (Liverpool,
  Manchester City) because an early table is noise. **From GW10 the rest is the
  real top six, recomputed weekly**, so Spurs and Newcastle return by climbing
  rather than by decree. `FOCUS_FROM_GW = 10` and `FOCUS_TOP = 6` are the
  knobs; 7 is a legitimate setting for the second.
  This replaces the static `top_clubs` list in `touchline.config.json`, which
  becomes seed-only — `core/facts.py` has to compute the rest from the table.
- **The week is the primary feed.** Around the top and Elsewhere are secondary
  by design; a story that leads the week does not reappear below.
- **The XI is a pitch, not a list**, with gameweek navigation: step back to a
  settled week to see what it scored, forward to see who everyone plays and how
  hard (average FDR across the XI). The formation is derived from the picks.
- **Captaincy is parked** as a display feature, but see the note below: it and
  per-gameweek picks are now the same blocking gap.
- **This is a rebuild, not a migration.** KB: "we are building from scratch
  anyway, old rules from touchline don't matter." Do not preserve the old
  config shape, the old schema keys, or the old renderer for compatibility.
  **Name refactors happen last**, once the old apps are deprecated.
- **The roast** is "decent, will improvise later" — ship it, iterate on tone.

## 6. Open questions for KB

- **The file's ownership cut-off** is the one number still open. The mockup's
  control shows what each choice costs: 5% leaves 75 players, 2% leaves 125,
  10% leaves 56, everyone is 604. Squad members are never dropped either way.
  5% is the default until he says otherwise.
- Nothing outstanding from the review rounds. The next decisions are
  build-order ones.
- The Chelsea digest was split out on 2026-08-23 into its own repo,
  `~/Code/touchline-chelsea` (Pages project `touchline-chelsea`). It runs
  weekly on Mondays, carries no FPL and no league-wide sections, and exists
  only as a fallback — **retire it once the three rooms here are finished**.
  `touchline-pl` was deleted the same day.
