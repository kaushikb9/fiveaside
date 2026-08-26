# Five-a-Side — state of play

Written 2026-08-24 as a handoff. **Read this, then `AGENTS.md`.** Together
they should be enough to pick the work up cold.

Live at **https://fiveaside.pages.dev**. Football and FPL for five friends.

---

## 1. The product

Three rooms under one shell, one nav, one theme.

| Room | URL | Job | Open to |
|---|---|---|---|
| **touchline** | `/` | What happened. The league. | everyone |
| **the gaffers** | `/gaffers/` | What we did about it. Five squads. | **the five, signed in** |
| **the locker room** | `/locker/` | What we know. Every player. | everyone |

The rule for deciding where anything goes: *touchline is what happened, the
gaffers is what we did about it, the locker room is what we know.* If a thing
doesn't fit one of the three, it is probably duplication.

**The join that makes it one product** rather than three tabs: any player name
anywhere opens their locker-room card, via one delegated listener in
`site/common.js`. Keep it that way.

### The five — frozen

| Nick | Club | Entry | Dot |
|---|---|---|---|
| Xabi | Chelsea | 7149204 | X |
| Sir Fergie | Man Utd | 58500 | SF |
| Mr CR7 | Man Utd | 522356 | C7 |
| The Special One | Chelsea | 6485401 | SO |
| Le Professeur | Arsenal | 4135179 | LP |

Renamed from Sir Alex / Ronaldo / Enzo / Arsene on 2026-08-24 and **frozen**.
They live in four places that must change together — `touchline.config.json`,
`site/common.js` (`FA.NICKS`, `FA.INITIALS`), `functions/api/stars.js`,
`brain/validate-fpl.mjs`. **Real names never appear anywhere.** Archived
mockups in `docs/superpowers/` keep the OLD names on purpose: rewriting a
signed-off review would make the record lie about what was reviewed.

---

## 2. How it is built

**Python produces facts, the brain produces judgment, the site produces
pixels.** That boundary is the point of the repo.

```
uv run touchline facts ─► prompt.md       ─► digests.json  (append-only)
uv run touchline fpl ─┬─► split-facts.mjs ─► players.json  (mechanical)
                      │                   ─► gaffers.json  (mechanical)
                      └─► fpl-prompt.md   ─► fpl.json      (judgment, living)
browser ──► /api/live (FPL proxy) · /api/stars (KV) · /api/auth · /api/private
```

### Which file may say what — the rule everything turns on

| File | Written by | Contains | Published? |
|---|---|---|---|
| `players.json` | `touchline fpl` | Every player, evidence only | public |
| `gaffers.json` | `touchline fpl` | Squads, picks, captaincy, chips | **private (KV)** |
| `fpl.json` | the brain | Judgment only | public **minus `people`** |
| `digests.json` | the brain | The league page, append-only | public |

If a value could be copied from the API it does not belong in `fpl.json` —
routing 600 player records through a model cost ~100k tokens a run to retype
numbers and invited errors. `fpl.json` is a **living document**: sections
replaced wholesale each run, except `log`, which is append-and-settle.

### Rules implemented once, which must not drift

- **Focus clubs are a rule, not a list.** Chelsea, Man Utd and Arsenal are
  permanent (that is who the five support). Until **GW10** the other two are
  seeded from `top_clubs`; from GW10 the rest is the real top six, recomputed
  weekly. `FA.focusClubs()` and `brain/prompt.md` describe the same rule.
- **The long game.** One weekend is not evidence. The gaffers room shows a
  guard that retires itself at GW6; the prompt forbids extrapolating a season
  from a gameweek.
- **A verdict is a hypothesis with a trigger** — four words (nailed / solid /
  watch / sack), a direction, one line of why, and what would change our mind,
  written before the fact.
- **Player news vs team news.** A signal with `player` attaches to that
  player's card; without one it is club-level and belongs in Team news. Seven
  of nine got this wrong once and the panel became a list of individuals.

---

## 3. What works today

- **touchline** — league table with focus clubs marked by rule, the week feed
  with one control that narrows it and dims the table together, team watch,
  around the top, elsewhere, rumours, links, and every earlier entry archived.
- **the gaffers** — a headline computed from the five squads alone, the
  long-game guard, chips ordered by current rank, the league table, **the
  pitch** (club kits, captain armband, gameweek navigation back to settled
  weeks and forward to fixtures), the weekly read, per-person watchlists with
  KV-backed stars, the roast slot, what the crowd missed, the chip clock, and
  **live scores on demand**.
- **the locker room** — fixture runs, then **the file** (gated at >2%
  ownership, never dropping anyone the five own, with the injury room folded
  in as the *injured / doubtful* filter), then club-level team news. Every
  table sorts by column.
- **The player card** — the game's flag and the editor's notes under "What we
  know", last five results, next five fixtures, ownership across the five, and
  the verdict with its trigger.
- **Both brains have run**: five weekly reads, 36 verdicts, today's league page.
- **`brain/test/smoke.sh <url>`** — 45 checks across every room, both themes,
  every control, the card seam, the door and phone width. Green.

---

## 4. Open, and why

### 4a. The gaffers door — invite codes

**Changed 2026-08-26.** Google sign-in is gone. It meant an OAuth client, a
Cloud Console, an email allowlist and a third party in the loop to identify
five people who already know each other, and it sat blocked on a client ID for
days. A code per gaffer does the same job with a KV key.

```
node brain/invite.mjs "Sir Fergie"     mint (replaces their old code)
node brain/invite.mjs --list           who has one, and whether they used it
node brain/invite.mjs --revoke <code>  kill one
node brain/invite.mjs --revoke-all     kill all of them
```

It prints the code and a `/gaffers/?i=CODE` link; either one signs them in on
any device for 30 days. The code is twelve Crockford base32 characters (no I,
L, O or U — 60 bits), stored at KV `invite:<CODE>` as `{ nick, issued,
last_used }`, re-read on **every** request, so revoking signs that person out
within a request rather than in 30 days. Ten wrong codes from one address buys
a ten-minute rest.

What is still true from before: the session is an HMAC-signed HttpOnly cookie,
`SESSION_SECRET` is a Pages secret, and the personal data is not published at
all — it lives in KV behind `/api/private`.

**Left to do:** mint the other four and send them out. Xabi's own code is the
only one that has to exist for the room to be usable.

### 4b. Form is Premier League only

The card's "Last five" comes from the FPL API's fixtures, which know about no
other competition — a midweek cup tie leaves a gap the strip cannot show.
Parked by KB on 2026-08-24. Fixing it needs a second fixtures source keyed to
the same clubs (`espn.py` and `thesportsdb.py` already fetch multi-competition
data for the digest — **the work is club identity**, since they name clubs
differently), a competition label per result, and a decision about whether
"last five" means five of any kind or five league games.

### 4c. Everything else

1. **`gaffers.json` stores only the current gameweek's picks**, so the pitch's
   back-step pairs this week's squad with that week's points, and says so.
   Fix: store picks per gameweek from `entry/{id}/event/{gw}/picks/`.
2. **Only 36 verdicts against 609 players.** The prompt asks for 25–50; check
   each carries a real trigger, not "if he plays badly".
3. **The roast has never been written** — correctly, because the rule is
   post-gameweek only and GW1 was unfinished. It should appear after the next
   settled gameweek.
4. **The fan voice is gone.** Reddit went fully login-walled on 2026-08-24, so
   "what fans are arguing about" is unsourced. An editorial problem, not
   plumbing — see `brain/sources.md` §2 for what has not been tried.
5. **The Bus** — the set-and-forget benchmark from the original dossier — was
   never rebuilt after the mockup rounds. Ask before building it.
6. **Retire `touchline-chelsea`** (its own repo, weekly, backup only) once
   these rooms have run for a week.

### 4d. Deferred by decision — do not build unless asked

Friend-facing team-ID entry, auto-refresh or realtime behaviour, accounts
beyond the five.

---

## 5. Settled by review — do not re-litigate

From KB's comment exports in `docs/superpowers/comments/`:

- **Front-door order**: touchline → the gaffers → the locker room.
- **Theme**: Dugout light, Floodlit dark — one design in two lights, Auto by
  default. Teamsheet archived.
- **Dropped**: the wagers panel, the captain poll (replaced by *what the crowd
  missed*, computed), the commons divider, the race, the single "call".
- **The file** opens on *ours*, gated at >2%, recalibratable.
- **Watchlists** are per person, in KV keyed by gaffer.
- **The Bus** is a set-and-forget reliability benchmark serviced monthly —
  never the crowd's team. "The crowd's favourite is useless and FOMO driven."
- **One signed call, not competing lanes.** "Don't want more FOMO."
- **Attention clarity** is the standing design bar. Four mockups were rejected
  at once for "too much going on".
- KB weights **rank protection over pure EV**.
- **BYOT and small**: five friends, no realtime, no accounts.

---

## 6. Open questions for KB

Nothing outstanding from the review rounds. The next decisions are build-order
ones, plus the one parked item above: what replaces the fan voice. The gaffers
door is no longer blocked — it needs four codes minted and sent, not a
decision.
