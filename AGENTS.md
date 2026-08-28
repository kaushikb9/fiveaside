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
  `split-league.mjs` sits between the facts CLI and the digest prompt and
  writes `site/data/table.json` — the full standings with real form —
  straight to disk; the brain never sees the table as its job.
  `split-facts.mjs` sits between the facts CLI and the FPL prompt: it writes
  the mechanical files straight to disk and hands the brain the remainder.
  The three `validate-*.mjs` files are the schema authorities.
- `src/touchline/core/squads.py` — the same join one level down: ESPN names a
  footballer "Patrick Dorgu", FPL says "Dorgu". Scoped to ONE SQUAD, which is
  the safety story — across the league a surname is a coin flip, inside a
  squad it is nearly always unique, and when it is not the answer is nothing.
- `src/touchline/core/clubs.py` — the join FPL and ESPN do not provide. FPL
  says Spurs and Man Utd, ESPN says Tottenham Hotspur and Manchester United;
  nothing bridges those automatically. Hand-written map for the cases no rule
  can reach, normaliser for the rest, and an ambiguous key resolves to
  NOTHING rather than guessing.
- `functions/` — Pages Functions, a **sibling** of `site/`, not inside it.
  `api/live.js` proxies the FPL API (which sends no CORS headers) for the
  gaffers room, `api/matches.js` does the same for the league room's two
  match-week tabs (this gameweek's scores and goalscorers, next gameweek's
  fixtures), `api/stars.js` is the KV-backed watchlist star — reads are open,
  writes take the gaffer from the session and never from the body — `api/auth.js` is
  invite-code sign-in for the gaffers room, and `api/private.js` serves the
  data that room needs. One KV namespace (`STARS`) holds all of it, keyed by
  prefix — `stars:`, `private:`, `invite:`, `throttle:`.
- `site/` — static, no framework, no build step, no CDNs. `common.js` loads
  first on every page and holds everything that must behave identically in
  all three rooms: theme, nicknames, kits, the focus-club rule, the player
  card. Every data-derived string goes through `esc()`. `digest.js` loads
  second on the two pages that draw digest entries — `/` and `/archive/` —
  so an entry from July draws exactly as this week's does, and `faces.js`
  loads second in the gaffers room: five inline-SVG caricatures of the
  football people the five are named after, drawn on one skeleton so they
  read as a set. Drawn, never fetched — same rule as the kits.

**The league room shows one entry.** `/` renders only the newest digest;
`/archive/` renders every earlier one, folded shut, and is linked from the
footer and from a line under the entry. Entries are still appended to
`digests.json` as before — nothing stopped being written, it stopped being
shown, because nobody reads backwards through a week-in-review. Its table,
this match week and next match week are **one panel with three tabs**, not
three panels: the table is local from `digests.json`, the two match weeks
come from `/api/matches`, and losing that feed costs the two tabs, never the
page. The default tab is the table unless a match is live or finished in the
last 26 hours, in which case the scores lead.

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
uv run touchline facts | node brain/split-league.mjs >/dev/null   # rewrite site/data/table.json
node --check site/common.js site/digest.js site/app.js site/archive/app.js \
             site/gaffers/app.js site/locker/app.js functions/api/*.js brain/*.mjs
node brain/invite.mjs --list     # who has a gaffers code (add --local for dev)
./brain/curate.sh --no-deploy      # league room, full run without publishing
./brain/curate-fpl.sh --no-deploy  # gaffers room, ditto
./deploy.sh                      # stamp assets, split private, push to KV, deploy
node brain/test/stars.mjs        # /api/stars auth — stubbed KV, no wrangler
node brain/test/matches.mjs      # /api/matches — stubbed ESPN, real captured payload
node brain/test/split-facts.mjs  # the deadline-lock fallback
brain/test/smoke.sh https://fiveaside.pages.dev/   # 87 signed in, 77 signed out
cd site && python3 -m http.server # local preview — /api/* 404s and the page
                                  # degrades honestly, which is worth seeing
```

**Wrap any long unattended run in `caffeinate -dimsu`.** This machine has
`pmset sleep 1` on AC and two brain runs died mid-response before that was
added; `-i` alone is not enough, it only blocks idle sleep. `auto.sh` does it.

## Rules that have bitten before

- **Person and voice, settled 2026-08-28.** "We" and "our" mean THE FIVE,
  never the brain and never the page — the audit that set this found "we"
  meaning two different groups in adjacent nav items ("the gaffers, what we
  did about it" vs "the locker room, what we know"). The machine is called
  **the brain** or referred to impersonally. **"You"** is the gaffer reading;
  the gaffers room already knows `who === FA.myNick()` and every heading that
  names a gaffer goes through `whose()` / `whom()`. Another gaffer is named by
  nickname. Both prompts carry the rule so the brain does not write "the
  trigger we wrote" about itself.
- **`owned_by` dies in the same outage as the squads.** It is built from them,
  so a deadline lock empties it for every player: cards read "nobody in the
  five", owner dots vanish, and a player who is in the file only BECAUSE one
  of the five owns him drops out of it. `split-facts.mjs` carries the last
  known owners forward alongside the squads.
- **FPL takes its entry endpoints down around EVERY deadline.**
  `entry/{id}/event/{gw}/picks/` answers 503 for every gameweek, not just the
  new one, and the mini-league goes with it. The bundle honestly reports no
  squads; `split-facts.mjs` must never write that through, because five squads
  becoming zero is not news, it is an outage. It carries the last squads and
  league forward, marks `people_stale`, and keeps `people_as_of` pinned to when
  they were real so repeated locks do not creep the date to today. This happens
  weekly — it is the normal case, not an edge one.
- **A room that throws mid-render leaves the static "Loading…" on screen**,
  which reads as a slow network and is a dead page. `render()` in the gaffers
  room catches and reports; every panel that reads a squad guards against not
  having one. If you add a panel there, guard it.
- **Sources disagree about name ORDER, not only spelling.** FPL files Ao
  Tanaka as `first_name: "Tanaka", second_name: "Ao"`. `squads.py` indexes both
  directions; without it the surname check compares the wrong halves and
  rejects a real player as an impostor.
- **A cup tie is where academy players appear, and they are not in FPL.** Hull
  fielded Babajide David, who has no FPL record; a bare surname fallback would
  have credited his appearance to somebody else's David. The fallback requires
  the given names to agree on their first letter.
- **A feed's "fixtures" are not all in the future.** ESPN was still listing
  last season's FA Cup final as unplayed in late August, which put a 16 May
  match in a card headed "next". Filter on the clock, not on the field name.
- **Nothing anywhere reports MINUTES.** ESPN's summary carries `starter`,
  `subIns` and `appearances`. `validate-players.mjs` rejects a `minutes` field
  on an appearance and an `fdr` on a cup fixture, because both could only have
  been invented — the same failure as the fabricated form column.
- **A club name is not a key until it has been joined.** FPL and ESPN name the
  same twenty clubs differently and share no id. `core/clubs.py` owns that
  join; `tests/test_clubs.py` pins every current club's ESPN spelling and is
  the diff to update on promotion or relegation. Its rule: an ambiguous key
  resolves to nothing. "Manchester City" and "Manchester United" both reduce
  to "manchester", and crediting one club's cup exit to the other is worse
  than a visible gap.
- **A cup tie has no gameweek.** Anything keyed on `gw` silently excludes
  every match that is not a league match — that is exactly how form came to be
  league-only. `recent` rows carry `comp` always, `gw` for league rows and
  `date` for the rest.
- **ESPN's match window is 120 days**, which in August still contains May.
  Scope to the season (from 1 July) or last season's finals turn up as this
  season's form.
- **faces.js has to load wherever a player card can open**, which is every
  room. It was on `/gaffers/` alone for half a day while `common.js` claimed
  otherwise, so the drawn owners quietly became initials everywhere else.
- **ESPN 403s browsers and accepts curl.** The bot rules run the wrong way
  round, measured against the live API on 2026-08-27: no User-Agent 403, the
  Cloudflare-Workers default 403, a normal desktop browser UA 403,
  `curl/8.7.1` 200. `functions/api/matches.js` sets `user-agent: curl/8.7.1`
  deliberately; it reads like decoration and is the opposite. If the river
  empties out, read `errors[]` in the response — it carries the status.
- **ESPN sends `score: "0"` for a fixture that has not kicked off.** Trust it
  and every upcoming match renders as a goalless draw. A score exists only
  once `status` says the match has been played.
- **ESPN's team abbreviations are per-competition and disagree with
  themselves.** Manchester United came back `MAN` in the league feed and `MNU`
  in the EFL Cup feed, so one club wore two codes on one page. `FA.clubAbbr`
  keys off the canonical full name and falls back to the feed only for clubs
  we do not carry.
- **The front page's match window is the CALENDAR, not an FPL gameweek.** A
  gameweek is a Premier League construct: a European tie or a cup round cannot
  live inside one, and "current" stays current from the last whistle to the
  next kickoff, which is exactly the midweek those matches are played. The
  gaffers room still runs on gameweeks and should — that is what FPL scores.
- **The brain wrote a form column out of memory, and the schema allowed it.**
  No source we fetch returns per-team form: football-data and ESPN both give
  standings without it, and `Standing` has no such field. The digest still
  carried `form: "DWLDW"` for clubs that had played one match — five results
  from one game — for exactly the five allegiance clubs a model recognises.
  Form is now computed in `facts.py::_team_form` from the results we already
  hold and published in `site/data/table.json`; `validate.mjs` REJECTS a
  table row that carries `form`. If a column has no source, it has no place
  in the file, and "the validator permits it" is not a source.
- **The league table is a fact, so it does not go through the brain.** Asked
  for "the top four rows plus the club's own", the model returned positions
  1-6, 8, 10 and 17 — a table with holes in it. `split-league.mjs` writes all
  20 rows verbatim. The brain keeps `table.note`, which is a reading, and the
  archive keeps each entry's historical copy.
- **Club names are shortened for DISPLAY only.** `FA.club()` maps
  "Manchester City" to "Man City" at the moment of printing. Never shorten a
  value that is stored, keyed or compared — `data-club` attributes and
  `FA.ALLEGIANCE` match on the full name, and shortening a key is how a rule
  silently stops matching.
- **Player names are not unique, and the card is addressed by id.** Fourteen
  surnames are shared across the 614 — two Palmers, two Wilsons, three
  Phillipses — and two of the collisions are players the five own. A card
  index keyed by name with last-write-wins hands each shared surname to
  whoever sits later in the file, which is reliably the lesser player:
  clicking Chelsea's Palmer opened Ipswich's goalkeeper on 2026-08-27. Any
  new link to a player carries `data-pid` and `FA.openCard` takes an element
  id. `FA.linkPlayers` is the one caller that cannot — prose has no id — so
  it resolves a shared name to the five's own first, then the most owned,
  and writes the chosen id into the link.
- **Whose list is a server question.** `/api/stars` used to take the gaffer
  from the POST body, so starring a player while looking at somebody else's
  squad wrote to THEIR watchlist. Since 2026-08-27 the gaffer comes from the
  session cookie and a body that names one is ignored. The client-side rule
  is the same shape: `FA.toggleStar(playerId)` takes no gaffer, and
  `FA.myNick()` (who is holding the phone) is never the same variable as
  `who` (whose room is on screen). `brain/test/stars.mjs` pins this shut.
- **The gaffers room already knows who you are.** `/api/private` returns the
  session, so it seeds `FA.setSession()` instead of letting `common.js` ask
  `/api/auth` again. A second round trip there races the first render, and
  the failure is silent and wrong rather than loud: your own star buttons
  disappear and your own watchlist is labelled "theirs".
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
- **`FA.linkPlayers()` rewrites its own output, so its guard has to cover
  three places, not one.** It loops over every known name longest-first and
  splices an `<a>` in; a later pass for "Potter" matched inside the
  `data-player="Lewis-Potter"` an earlier pass had written — a quote is not a
  word character and neither is a hyphen — and spliced a tag into the
  attribute, which rendered as `Lewis-Potter">Lewis-Potter`. The lookarounds
  exclude `"`, `=` and `-` as well as word characters and tag brackets. Any
  new name source (goalscorers, squads) will hit this the first time a
  double-barrelled name shows up.
- **The gaffers door is an invite code, not an identity provider.** Google
  sign-in was replaced on 2026-08-26: it needed a Cloud Console, an OAuth
  client and an email allowlist to identify five people who already know each
  other, and it shipped a login wall with no button for weeks because the
  client ID was never set. Codes live at KV `invite:<CODE>` and are re-read on
  **every** request — a session that outlives the code it was minted from is a
  revoke button that does nothing. Mint with `node brain/invite.mjs "<nick>"`.
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
holds `stars:<gaffer>`, `private:gaffers` / `private:people`, `invite:<CODE>`
and short-lived `throttle:<ip>` counters. `SESSION_SECRET` is set as a Pages
secret; with it or the KV binding missing, `/api/auth` answers 503 and the
gaffers room says the door has no lock fitted rather than showing a dead
button.

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
