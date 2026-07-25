# ESPN + api-football sources — design

**Date:** 2026-07-25
**Status:** Approved (conversation, 2026-07-25). Motivation: the football-data.org
token returns 403 on every competition (subscription lapsed); ESPN's unofficial
API verified working today with no key.

## Decision

Config-selected source (no automatic failover): `touchline.config.json` gains
`"source": "espn" | "api-football" | "football-data"`, default `"espn"`.
The owner flips it by hand if the active source breaks. Everything downstream
of the source protocols (facts, brain, validator, site) is untouched.

## Components

### `sources/espn.py` — ESPNClient (primary)
- Implements `MatchSource` + `StandingsSource`.
- League map: `PL → eng.1`, `CL → uefa.champions` (unknown code → degraded
  result with a clear error, not an exception).
- `fetch_matches`: one GET
  `https://site.api.espn.com/apis/site/v2/sports/soccer/{league}/scoreboard?dates=YYYYMMDD-YYYYMMDD`
  spanning past 45 days (results + form) to next 21 days (fixtures beyond the
  14-day facts horizon). Injectable `now_fn` computes the window (tests pin it).
- Status: `type.completed == true → FINISHED`; else map
  `STATUS_SCHEDULED → SCHEDULED`, `STATUS_IN_PLAY/STATUS_HALFTIME/STATUS_FIRST_HALF/STATUS_SECOND_HALF → LIVE`,
  default SCHEDULED.
- Teams: `displayName` / `abbreviation` (code) / `logo` (crest).
- Competition name from `leagues[0].name`, fallback to our code.
- `fetch_standings`: GET
  `https://site.api.espn.com/apis/v2/sports/soccer/{league}/standings`;
  rows from `children[0].standings.entries`; stats by name (`rank`,
  `gamesPlayed`, `wins`, `ties`, `losses`, `points`, `pointsFor`,
  `pointsAgainst`); crest from `team.logos[0].href`.
- Degradation identical to FootballDataClient: `ok/error` containers,
  per-record tolerance, HTTP/JSON errors caught.
- Caveat (accepted): unofficial API; a breaking change means one thin digest,
  and the config switch is the mitigation.

### `sources/api_football.py` — APIFootballClient (backup)
- Base `https://v3.football.api-sports.io`, header `x-apisports-key` from env
  `API_FOOTBALL_KEY` (constructor override for tests).
- League map: `PL → 39`, `CL → 2`. Season year derived from `now_fn`:
  month ≥ 7 → current year, else previous year.
- `fetch_matches`: GET `/fixtures?league={id}&season={year}` (whole season,
  one call). Entry shape: `fixture.{id,date,status.short}`, `league.name`,
  `teams.{home,away}.{name,logo}`, `goals.{home,away}`.
  Status shorts: `NS/TBD/PST → SCHEDULED`; `1H/HT/2H/ET/BT/P/LIVE/INT/SUSP → LIVE`;
  `FT/AET/PEN → FINISHED`; default SCHEDULED.
- `fetch_standings`: GET `/standings?league={id}&season={year}`;
  rows at `response[0].league.standings[0]`:
  `{rank, team{name,logo}, all{played,win,draw,lose,goals{for,against}}, points, group}`.
- Team `code` is None (api-football has no TLA); crest from `logo`.
- Missing key → every fetch returns a degraded result telling the owner to set
  `API_FOOTBALL_KEY` (no crash).
- Known caveat (owner accepts): the free plan may not cover the current
  season; the owner is arranging a key.

### Config + wiring
- `TouchlineConfig.source: Literal["espn", "api-football", "football-data"] = "espn"`.
- `cli.py`: `SOURCES = {"espn": ESPNClient, "api-football": APIFootballClient, "football-data": FootballDataClient}`;
  instantiate `SOURCES[config.source]()`.
- Repo `touchline.config.json` gains `"source": "espn"`.
- `brain/sources.md` line 1 reworded: facts come from the configured source
  (ESPN by default), not "football-data.org" specifically.
- README self-hosting step 3 updated: token env vars are per-source
  (`FOOTBALL_DATA_TOKEN` / `API_FOOTBALL_KEY`; ESPN needs none).

## Testing
- ESPN: recorded real responses (captured 2026-07-25, trimmed) as
  `tests/fixtures/espn/scoreboard.json` + `standings.json`; tests mirror
  `test_football_data.py`: parsing, status mapping, crest/code passthrough,
  malformed-record tolerance, HTTP/JSON degradation, date-window computation
  with pinned `now_fn`.
- api-football: hand-built fixtures matching the documented v3 shape,
  same test dimensions plus season-derivation (Jul/Aug boundary) and
  missing-key degradation.
- Config: `source` default, valid values, invalid value rejected.

## Not building
Automatic failover; merging multiple sources; match-detail endpoints;
caching. Each returns only if the daily ritual actually needs it.
