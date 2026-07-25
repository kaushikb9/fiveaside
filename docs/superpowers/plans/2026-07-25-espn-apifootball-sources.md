# ESPN + api-football Sources Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add ESPN (primary, keyless) and api-football.com (backup, keyed) as config-selectable data sources behind touchline's existing `MatchSource`/`StandingsSource` protocols.

**Architecture:** Two new client modules in `src/touchline/sources/` mirroring `football_data.py`'s structure (module-level parse functions + a client class with `ok/error` degradation); one new `source` field in config; a three-entry registry in `cli.py`. Facts assembly, brain, validator, and site are untouched. Spec: `docs/superpowers/specs/2026-07-25-espn-apifootball-sources-design.md`.

**Tech Stack:** Python ≥3.12, httpx, pydantic v2, pytest with `httpx.MockTransport` + recorded JSON fixtures (existing pattern in `tests/test_football_data.py` — read it before starting any task).

## Global Constraints

- All Python via `uv run ...`; whole suite green (`uv run pytest -q`) and `uv run ruff check .` clean at the end of every task.
- Clients live in `src/touchline/sources/`, import only httpx + `touchline.core.models` + `touchline.sources.base` + stdlib; graceful degradation exactly like `FootballDataClient`: HTTP/JSON errors → `ok=False` result with `error` string; malformed individual records skipped, never sinking the batch.
- Competition codes stay the config codes (`PL`, `CL`); each client owns its mapping; unknown code → degraded result (`ok=False`, error mentioning the code), never an exception.
- Team names: missing/empty → `"TBD"` (same `_team` convention as football_data.py).
- Commit messages end with: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

## File Structure (end state)

```
src/touchline/sources/espn.py           # ESPNClient + parse functions
src/touchline/sources/api_football.py   # APIFootballClient + parse functions
src/touchline/config.py                 # + source: Literal[...] = "espn"
src/touchline/cli.py                    # + SOURCES registry
touchline.config.json                   # + "source": "espn"
brain/sources.md                        # reworded facts-bundle line
README.md                               # per-source token env vars
tests/fixtures/espn/scoreboard.json     # recorded 2026-07-25, trimmed
tests/fixtures/espn/standings.json      # recorded 2026-07-25, trimmed
tests/fixtures/api_football/fixtures.json    # hand-built per documented v3 shape
tests/fixtures/api_football/standings.json   # hand-built per documented v3 shape
tests/test_espn.py
tests/test_api_football.py
tests/test_config.py                    # + source-field tests
tests/test_cli.py                       # + registry test
```

---

### Task 1: ESPNClient

**Files:**
- Create: `src/touchline/sources/espn.py`
- Create: `tests/fixtures/espn/scoreboard.json`, `tests/fixtures/espn/standings.json`
- Test: `tests/test_espn.py`

**Interfaces:**
- Consumes: `Competition, Fixture, MatchStatus, Result, Standing, Team` from `touchline.core.models`; `SourceResult, StandingsResult` from `touchline.sources.base`.
- Produces: `touchline.sources.espn.ESPNClient(*, client: httpx.Client | None = None, timeout: float = 10.0, now_fn: Callable[[], datetime] | None = None)` with `fetch_matches(competition: str) -> SourceResult` and `fetch_standings(competition: str) -> StandingsResult`. Task 3 imports `ESPNClient` by this exact name.

- [ ] **Step 1: Record real fixtures.** Capture live responses and trim them (keep the wrapper structure; keep ~4 events / ~4 standings entries):

```bash
mkdir -p tests/fixtures/espn
curl -s "https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard?dates=20260520-20260530" -o /tmp/espn_sb_raw.json
curl -s "https://site.api.espn.com/apis/v2/sports/soccer/eng.1/standings" -o /tmp/espn_st_raw.json
python3 - <<'EOF'
import json
sb = json.load(open("/tmp/espn_sb_raw.json"))
sb["events"] = sb["events"][:4]
json.dump(sb, open("tests/fixtures/espn/scoreboard.json", "w"), indent=1)
st = json.load(open("/tmp/espn_st_raw.json"))
st["children"][0]["standings"]["entries"] = st["children"][0]["standings"]["entries"][:4]
st["children"] = st["children"][:1]
json.dump(st, open("tests/fixtures/espn/standings.json", "w"), indent=1)
EOF
```

Then MANUALLY EDIT `tests/fixtures/espn/scoreboard.json`: change one event's status to `{"type": {"name": "STATUS_SCHEDULED", "completed": false}}` (a scheduled fixture) and corrupt one event by deleting its `competitors` array (tests per-record tolerance). Note in a comment-free way which event ids you altered — you'll assert on them.

- [ ] **Step 2: Write the failing tests** — read `tests/test_football_data.py` first and mirror its MockTransport pattern:

```python
# tests/test_espn.py
import json
from datetime import UTC, datetime
from pathlib import Path

import httpx

from touchline.core.models import MatchStatus
from touchline.sources.base import MatchSource, StandingsSource
from touchline.sources.espn import ESPNClient

FIXTURES = Path(__file__).parent / "fixtures" / "espn"
NOW = datetime(2026, 5, 30, 12, 0, tzinfo=UTC)


def _client_with(handler) -> ESPNClient:
    transport = httpx.MockTransport(handler)
    return ESPNClient(client=httpx.Client(transport=transport), now_fn=lambda: NOW)


def _fixture_handler(request: httpx.Request) -> httpx.Response:
    if "scoreboard" in request.url.path:
        payload = json.loads((FIXTURES / "scoreboard.json").read_text())
    else:
        payload = json.loads((FIXTURES / "standings.json").read_text())
    return httpx.Response(200, json=payload)


def test_conforms_to_protocols():
    client = _client_with(_fixture_handler)
    assert isinstance(client, MatchSource)
    assert isinstance(client, StandingsSource)


def test_fetch_matches_parses_results_and_fixtures():
    client = _client_with(_fixture_handler)
    res = client.fetch_matches("PL")
    assert res.ok
    # 4 events in fixture, 1 corrupted (skipped) -> 3 fixtures
    assert len(res.fixtures) == 3
    # finished events become Results with int scores; the STATUS_SCHEDULED one doesn't
    assert all(r.home_score >= 0 for r in res.results)
    assert len(res.results) == len(
        [f for f in res.fixtures if f.status == MatchStatus.FINISHED]
    )
    fixture = res.fixtures[0]
    assert fixture.competition.code == "PL"
    assert fixture.competition.name  # human name from leagues[0].name
    assert fixture.home.name != ""
    assert fixture.home.crest and fixture.home.crest.startswith("http")


def test_fetch_matches_requests_date_window():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        return httpx.Response(200, json={"leagues": [], "events": []})

    client = _client_with(handler)
    client.fetch_matches("PL")
    # NOW is 2026-05-30: window = 45 days back to 21 days forward
    assert "eng.1" in seen["url"]
    assert "dates=20260415-20260620" in seen["url"]


def test_fetch_standings_parses_rows():
    client = _client_with(_fixture_handler)
    res = client.fetch_standings("PL")
    assert res.ok
    assert len(res.standings) == 4
    row = res.standings[0]
    assert row.position >= 1
    assert row.played >= 0
    assert row.team.name != ""
    assert row.team.crest and row.team.crest.startswith("http")


def test_unknown_competition_degrades():
    client = _client_with(_fixture_handler)
    res = client.fetch_matches("BUNDESLIGA")
    assert not res.ok
    assert "BUNDESLIGA" in res.error
    st = client.fetch_standings("BUNDESLIGA")
    assert not st.ok


def test_http_error_degrades():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500)

    client = _client_with(handler)
    res = client.fetch_matches("PL")
    assert not res.ok and res.error
    st = client.fetch_standings("PL")
    assert not st.ok and st.error


def test_invalid_json_degrades():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"not json")

    client = _client_with(handler)
    res = client.fetch_matches("PL")
    assert not res.ok and "JSON" in res.error
```

Adjust the two count assertions (`== 3`, standings `== 4`) to match what your trimmed+edited fixtures actually contain — but keep one corrupted event proving tolerance.

- [ ] **Step 3: Run tests to verify they fail**

Run: `uv run pytest tests/test_espn.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'touchline.sources.espn'`

- [ ] **Step 4: Implement `src/touchline/sources/espn.py`**

```python
"""ESPN unofficial API client: matches + standings behind the source protocols."""

from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx

from touchline.core.models import Competition, Fixture, MatchStatus, Result, Standing, Team
from touchline.sources.base import SourceResult, StandingsResult

_LEAGUE_MAP = {"PL": "eng.1", "CL": "uefa.champions"}

_LIVE_STATUSES = {
    "STATUS_IN_PLAY",
    "STATUS_HALFTIME",
    "STATUS_FIRST_HALF",
    "STATUS_SECOND_HALF",
}

PAST_DAYS = 45
FUTURE_DAYS = 21

_TBD_NAME = "TBD"


def _team(payload: dict[str, Any]) -> Team:
    name = (payload.get("displayName") or "").strip()
    return Team(name=name or _TBD_NAME, code=payload.get("abbreviation"), crest=payload.get("logo"))


def _status(type_payload: dict[str, Any]) -> MatchStatus:
    if type_payload.get("completed"):
        return MatchStatus.FINISHED
    if type_payload.get("name") in _LIVE_STATUSES:
        return MatchStatus.LIVE
    return MatchStatus.SCHEDULED


def _parse_scoreboard(payload: dict[str, Any], competition: str) -> SourceResult:
    leagues = payload.get("leagues") or []
    name = (leagues[0].get("name") if leagues else None) or competition
    comp = Competition(code=competition, name=name)

    fixtures: list[Fixture] = []
    results: list[Result] = []

    for event in payload.get("events", []):
        try:
            comp_entry = (event.get("competitions") or [{}])[0]
            competitors = comp_entry.get("competitors") or []
            home = next((c for c in competitors if c.get("homeAway") == "home"), None)
            away = next((c for c in competitors if c.get("homeAway") == "away"), None)
            if home is None or away is None:
                continue
            status_payload = (comp_entry.get("status") or event.get("status") or {})
            status = _status(status_payload.get("type") or {})
            common = {
                "id": str(event["id"]),
                "competition": comp,
                "kickoff": event["date"],
                "home": _team(home.get("team") or {}),
                "away": _team(away.get("team") or {}),
            }
            fixtures.append(Fixture(status=status, **common))
            if status == MatchStatus.FINISHED:
                try:
                    home_score = int(home["score"])
                    away_score = int(away["score"])
                except (KeyError, TypeError, ValueError):
                    continue
                results.append(Result(home_score=home_score, away_score=away_score, **common))
        except (KeyError, TypeError, ValueError):
            continue

    return SourceResult(ok=True, fixtures=fixtures, results=results)


def _parse_standings(payload: dict[str, Any], competition: str) -> StandingsResult:
    comp = Competition(code=competition, name=payload.get("name") or competition)
    standings: list[Standing] = []

    children = payload.get("children") or []
    entries = (
        ((children[0].get("standings") or {}).get("entries") or []) if children else []
    )
    for entry in entries:
        try:
            stats = {s.get("name"): s.get("value") for s in entry.get("stats") or []}
            team_payload = entry.get("team") or {}
            logos = team_payload.get("logos") or []
            team = Team(
                name=(team_payload.get("displayName") or "").strip() or _TBD_NAME,
                code=team_payload.get("abbreviation"),
                crest=(logos[0].get("href") if logos else None),
            )
            standings.append(
                Standing(
                    competition=comp,
                    position=int(stats["rank"]),
                    team=team,
                    played=int(stats["gamesPlayed"]),
                    won=int(stats["wins"]),
                    draw=int(stats["ties"]),
                    lost=int(stats["losses"]),
                    points=int(stats["points"]),
                    goals_for=int(stats["pointsFor"]),
                    goals_against=int(stats["pointsAgainst"]),
                )
            )
        except (KeyError, TypeError, ValueError):
            continue

    return StandingsResult(ok=True, standings=standings)


class ESPNClient:
    """`MatchSource` + `StandingsSource` backed by ESPN's unofficial site API."""

    def __init__(
        self,
        *,
        base_url: str = "https://site.api.espn.com/apis",
        client: httpx.Client | None = None,
        timeout: float = 10.0,
        now_fn: Callable[[], datetime] | None = None,
    ) -> None:
        self.base_url = base_url
        self._client = client or httpx.Client(timeout=timeout)
        self._now_fn = now_fn or (lambda: datetime.now(UTC))

    def _league(self, competition: str) -> str | None:
        return _LEAGUE_MAP.get(competition)

    def fetch_matches(self, competition: str = "PL") -> SourceResult:
        league = self._league(competition)
        if league is None:
            error = f"ESPN source has no mapping for competition '{competition}'"
            return SourceResult(ok=False, fixtures=[], results=[], error=error)

        today = self._now_fn().date()
        window = (
            f"{today - timedelta(days=PAST_DAYS):%Y%m%d}-"
            f"{today + timedelta(days=FUTURE_DAYS):%Y%m%d}"
        )
        url = f"{self.base_url}/site/v2/sports/soccer/{league}/scoreboard"
        try:
            response = self._client.get(url, params={"dates": window, "limit": 200})
            response.raise_for_status()
            payload = response.json()
        except httpx.HTTPError as exc:
            return SourceResult(ok=False, fixtures=[], results=[], error=str(exc))
        except ValueError as exc:
            return SourceResult(ok=False, fixtures=[], results=[], error=f"invalid JSON: {exc}")

        try:
            return _parse_scoreboard(payload, competition)
        except (KeyError, TypeError, ValueError) as exc:
            return SourceResult(ok=False, fixtures=[], results=[], error=f"unexpected payload: {exc}")

    def fetch_standings(self, competition: str = "PL") -> StandingsResult:
        league = self._league(competition)
        if league is None:
            error = f"ESPN source has no mapping for competition '{competition}'"
            return StandingsResult(ok=False, standings=[], error=error)

        url = f"{self.base_url}/v2/sports/soccer/{league}/standings"
        try:
            response = self._client.get(url)
            response.raise_for_status()
            payload = response.json()
        except httpx.HTTPError as exc:
            return StandingsResult(ok=False, standings=[], error=str(exc))
        except ValueError as exc:
            return StandingsResult(ok=False, standings=[], error=f"invalid JSON: {exc}")

        try:
            return _parse_standings(payload, competition)
        except (KeyError, TypeError, ValueError) as exc:
            return StandingsResult(ok=False, standings=[], error=f"unexpected payload: {exc}")
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `uv run pytest tests/test_espn.py -v && uv run pytest -q && uv run ruff check .`
Expected: all PASS. If a fixture-shape assumption fails (e.g. standings stats values arrive as floats), fix the PARSER (e.g. `int(...)` already handles float values), not the recorded fixture.

- [ ] **Step 6: Commit**

```bash
git add src/touchline/sources/espn.py tests/fixtures/espn tests/test_espn.py
git commit -m "feat: ESPN source client (matches + standings)"
```

---

### Task 2: APIFootballClient

**Files:**
- Create: `src/touchline/sources/api_football.py`
- Create: `tests/fixtures/api_football/fixtures.json`, `tests/fixtures/api_football/standings.json`
- Test: `tests/test_api_football.py`

**Interfaces:**
- Consumes: same models/base imports as Task 1.
- Produces: `touchline.sources.api_football.APIFootballClient(key: str | None = None, *, client: httpx.Client | None = None, timeout: float = 10.0, now_fn: Callable[[], datetime] | None = None)` with `fetch_matches(competition) -> SourceResult` / `fetch_standings(competition) -> StandingsResult`. Key resolution: explicit arg, else `os.environ.get("API_FOOTBALL_KEY")`. Task 3 imports `APIFootballClient` by this exact name.

- [ ] **Step 1: Hand-build the fixtures** (documented v3 response shapes):

`tests/fixtures/api_football/fixtures.json`:

```json
{
  "response": [
    {
      "fixture": {"id": 1200001, "date": "2026-08-15T14:00:00+00:00", "status": {"short": "FT"}},
      "league": {"id": 39, "name": "Premier League", "round": "Regular Season - 1"},
      "teams": {
        "home": {"id": 49, "name": "Chelsea", "logo": "https://media.api-sports.io/football/teams/49.png"},
        "away": {"id": 48, "name": "West Ham", "logo": "https://media.api-sports.io/football/teams/48.png"}
      },
      "goals": {"home": 2, "away": 0}
    },
    {
      "fixture": {"id": 1200002, "date": "2026-08-22T19:00:00+00:00", "status": {"short": "NS"}},
      "league": {"id": 39, "name": "Premier League", "round": "Regular Season - 2"},
      "teams": {
        "home": {"id": 49, "name": "Chelsea", "logo": "https://media.api-sports.io/football/teams/49.png"},
        "away": {"id": 36, "name": "Fulham", "logo": "https://media.api-sports.io/football/teams/36.png"}
      },
      "goals": {"home": null, "away": null}
    },
    {
      "fixture": {"id": 1200003, "date": "2026-08-16T15:30:00+00:00", "status": {"short": "1H"}},
      "league": {"id": 39, "name": "Premier League", "round": "Regular Season - 1"},
      "teams": {
        "home": {"id": 34, "name": "Newcastle", "logo": "https://media.api-sports.io/football/teams/34.png"},
        "away": {"id": 40, "name": "Liverpool", "logo": "https://media.api-sports.io/football/teams/40.png"}
      },
      "goals": {"home": 0, "away": 0}
    },
    {
      "fixture": {"id": 1200004, "date": "2026-08-17T14:00:00+00:00", "status": {"short": "FT"}},
      "league": {"id": 39, "name": "Premier League", "round": "Regular Season - 1"},
      "teams": {"home": null, "away": {"id": 40, "name": "Liverpool", "logo": null}},
      "goals": {"home": 1, "away": 1}
    }
  ]
}
```

(The fourth entry is deliberately malformed — `teams.home: null` — to prove per-record tolerance.)

`tests/fixtures/api_football/standings.json`:

```json
{
  "response": [
    {
      "league": {
        "id": 39,
        "name": "Premier League",
        "standings": [
          [
            {"rank": 1, "team": {"id": 42, "name": "Arsenal", "logo": "https://media.api-sports.io/football/teams/42.png"}, "points": 3, "group": "Premier League", "all": {"played": 1, "win": 1, "draw": 0, "lose": 0, "goals": {"for": 2, "against": 0}}},
            {"rank": 2, "team": {"id": 49, "name": "Chelsea", "logo": "https://media.api-sports.io/football/teams/49.png"}, "points": 3, "group": "Premier League", "all": {"played": 1, "win": 1, "draw": 0, "lose": 0, "goals": {"for": 2, "against": 1}}},
            {"rank": 3, "team": {"id": 36, "name": "Fulham", "logo": null}, "points": 1, "group": "Premier League", "all": {"played": 1, "win": 0, "draw": 1, "lose": 0, "goals": {"for": 1, "against": 1}}}
          ]
        ]
      }
    }
  ]
}
```

- [ ] **Step 2: Write the failing tests**:

```python
# tests/test_api_football.py
import json
from datetime import UTC, datetime
from pathlib import Path

import httpx

from touchline.core.models import MatchStatus
from touchline.sources.base import MatchSource, StandingsSource
from touchline.sources.api_football import APIFootballClient

FIXTURES = Path(__file__).parent / "fixtures" / "api_football"
NOW = datetime(2026, 8, 20, 12, 0, tzinfo=UTC)


def _client_with(handler, key="test-key") -> APIFootballClient:
    transport = httpx.MockTransport(handler)
    return APIFootballClient(key, client=httpx.Client(transport=transport), now_fn=lambda: NOW)


def _fixture_handler(request: httpx.Request) -> httpx.Response:
    if "fixtures" in request.url.path:
        payload = json.loads((FIXTURES / "fixtures.json").read_text())
    else:
        payload = json.loads((FIXTURES / "standings.json").read_text())
    return httpx.Response(200, json=payload)


def test_conforms_to_protocols():
    client = _client_with(_fixture_handler)
    assert isinstance(client, MatchSource)
    assert isinstance(client, StandingsSource)


def test_fetch_matches_parses_and_tolerates_bad_records():
    client = _client_with(_fixture_handler)
    res = client.fetch_matches("PL")
    assert res.ok
    assert len(res.fixtures) == 3  # 4 entries, 1 malformed
    statuses = {f.id: f.status for f in res.fixtures}
    assert statuses["1200001"] == MatchStatus.FINISHED
    assert statuses["1200002"] == MatchStatus.SCHEDULED
    assert statuses["1200003"] == MatchStatus.LIVE
    assert len(res.results) == 1
    result = res.results[0]
    assert (result.home_score, result.away_score) == (2, 0)
    assert result.home.name == "Chelsea"
    assert result.home.code is None  # api-football has no TLA
    assert result.home.crest.startswith("https://media.api-sports.io")
    assert result.competition.name == "Premier League"
    assert result.matchday == 1  # parsed from "Regular Season - 1"


def test_fetch_matches_sends_key_league_and_season():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["key"] = request.headers.get("x-apisports-key")
        seen["url"] = str(request.url)
        return httpx.Response(200, json={"response": []})

    client = _client_with(handler)
    client.fetch_matches("PL")
    assert seen["key"] == "test-key"
    assert "league=39" in seen["url"]
    assert "season=2026" in seen["url"]  # NOW is Aug 2026 -> season 2026


def test_season_rolls_back_before_july():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        return httpx.Response(200, json={"response": []})

    client = APIFootballClient(
        "k",
        client=httpx.Client(transport=httpx.MockTransport(handler)),
        now_fn=lambda: datetime(2027, 2, 1, tzinfo=UTC),
    )
    client.fetch_matches("PL")
    assert "season=2026" in seen["url"]  # Feb 2027 is still the 2026-27 season


def test_fetch_standings_parses_rows():
    client = _client_with(_fixture_handler)
    res = client.fetch_standings("PL")
    assert res.ok
    assert len(res.standings) == 3
    top = res.standings[0]
    assert top.position == 1
    assert top.team.name == "Arsenal"
    assert top.points == 3
    assert top.goals_for == 2
    fulham = res.standings[2]
    assert fulham.team.crest is None  # null logo passes through


def test_missing_key_degrades():
    client = APIFootballClient(
        None, client=httpx.Client(transport=httpx.MockTransport(_fixture_handler))
    )
    res = client.fetch_matches("PL")
    assert not res.ok and "API_FOOTBALL_KEY" in res.error
    st = client.fetch_standings("PL")
    assert not st.ok and "API_FOOTBALL_KEY" in st.error


def test_unknown_competition_degrades():
    client = _client_with(_fixture_handler)
    res = client.fetch_matches("LIGA")
    assert not res.ok and "LIGA" in res.error


def test_http_error_degrades():
    client = _client_with(lambda request: httpx.Response(500))
    res = client.fetch_matches("PL")
    assert not res.ok and res.error
```

Note for `test_missing_key_degrades`: the client must not read a real env var during tests — construct with `key=None` AND clear the env inside the test with `monkeypatch.delenv("API_FOOTBALL_KEY", raising=False)` (add the `monkeypatch` fixture parameter).

- [ ] **Step 3: Run tests to verify they fail**

Run: `uv run pytest tests/test_api_football.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'touchline.sources.api_football'`

- [ ] **Step 4: Implement `src/touchline/sources/api_football.py`**

```python
"""api-football.com (api-sports.io v3) client behind the source protocols."""

import os
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

import httpx

from touchline.core.models import Competition, Fixture, MatchStatus, Result, Standing, Team
from touchline.sources.base import SourceResult, StandingsResult

_LEAGUE_MAP = {"PL": 39, "CL": 2}

_STATUS_MAP = {
    "NS": MatchStatus.SCHEDULED,
    "TBD": MatchStatus.SCHEDULED,
    "PST": MatchStatus.SCHEDULED,
    "1H": MatchStatus.LIVE,
    "HT": MatchStatus.LIVE,
    "2H": MatchStatus.LIVE,
    "ET": MatchStatus.LIVE,
    "BT": MatchStatus.LIVE,
    "P": MatchStatus.LIVE,
    "LIVE": MatchStatus.LIVE,
    "INT": MatchStatus.LIVE,
    "SUSP": MatchStatus.LIVE,
    "FT": MatchStatus.FINISHED,
    "AET": MatchStatus.FINISHED,
    "PEN": MatchStatus.FINISHED,
}

_TBD_NAME = "TBD"


def _team(payload: dict[str, Any]) -> Team:
    name = (payload.get("name") or "").strip()
    return Team(name=name or _TBD_NAME, code=None, crest=payload.get("logo"))


def _matchday(round_label: str | None) -> int | None:
    if not round_label:
        return None
    tail = round_label.rsplit("-", 1)[-1].strip()
    return int(tail) if tail.isdigit() else None


def _parse_fixtures(payload: dict[str, Any], competition: str) -> SourceResult:
    fixtures: list[Fixture] = []
    results: list[Result] = []
    comp_name = competition

    for entry in payload.get("response", []):
        try:
            fixture_payload = entry.get("fixture") or {}
            league = entry.get("league") or {}
            teams = entry.get("teams") or {}
            goals = entry.get("goals") or {}
            if league.get("name"):
                comp_name = league["name"]
            comp = Competition(code=competition, name=comp_name)
            home_payload = teams.get("home")
            away_payload = teams.get("away")
            if not home_payload or not away_payload:
                continue
            status = _STATUS_MAP.get(
                (fixture_payload.get("status") or {}).get("short", ""), MatchStatus.SCHEDULED
            )
            common = {
                "id": str(fixture_payload["id"]),
                "competition": comp,
                "kickoff": fixture_payload["date"],
                "home": _team(home_payload),
                "away": _team(away_payload),
                "matchday": _matchday(league.get("round")),
            }
            fixtures.append(Fixture(status=status, **common))
            if status == MatchStatus.FINISHED:
                home_score = goals.get("home")
                away_score = goals.get("away")
                if home_score is None or away_score is None:
                    continue
                results.append(
                    Result(home_score=int(home_score), away_score=int(away_score), **common)
                )
        except (KeyError, TypeError, ValueError):
            continue

    return SourceResult(ok=True, fixtures=fixtures, results=results)


def _parse_standings(payload: dict[str, Any], competition: str) -> StandingsResult:
    standings: list[Standing] = []
    response = payload.get("response") or []
    league = (response[0].get("league") or {}) if response else {}
    comp = Competition(code=competition, name=league.get("name") or competition)
    tables = league.get("standings") or []
    rows = tables[0] if tables else []

    for row in rows:
        try:
            record = row.get("all") or {}
            goals = record.get("goals") or {}
            standings.append(
                Standing(
                    competition=comp,
                    group=row.get("group"),
                    position=int(row["rank"]),
                    team=_team(row.get("team") or {}),
                    played=int(record["played"]),
                    won=int(record["win"]),
                    draw=int(record["draw"]),
                    lost=int(record["lose"]),
                    points=int(row["points"]),
                    goals_for=int(goals["for"]),
                    goals_against=int(goals["against"]),
                )
            )
        except (KeyError, TypeError, ValueError):
            continue

    return StandingsResult(ok=True, standings=standings)


class APIFootballClient:
    """`MatchSource` + `StandingsSource` backed by api-football.com v3."""

    def __init__(
        self,
        key: str | None = None,
        *,
        base_url: str = "https://v3.football.api-sports.io",
        client: httpx.Client | None = None,
        timeout: float = 10.0,
        now_fn: Callable[[], datetime] | None = None,
    ) -> None:
        self.key = key if key is not None else os.environ.get("API_FOOTBALL_KEY")
        self.base_url = base_url
        self._client = client or httpx.Client(timeout=timeout)
        self._now_fn = now_fn or (lambda: datetime.now(UTC))

    def _season(self) -> int:
        now = self._now_fn()
        return now.year if now.month >= 7 else now.year - 1

    def _precheck(self, competition: str) -> str | None:
        if not self.key:
            return "api-football key missing: set the API_FOOTBALL_KEY environment variable"
        if competition not in _LEAGUE_MAP:
            return f"api-football source has no mapping for competition '{competition}'"
        return None

    def _get(self, path: str, params: dict[str, Any]) -> dict[str, Any]:
        response = self._client.get(
            f"{self.base_url}{path}", params=params, headers={"x-apisports-key": self.key}
        )
        response.raise_for_status()
        return response.json()

    def fetch_matches(self, competition: str = "PL") -> SourceResult:
        error = self._precheck(competition)
        if error:
            return SourceResult(ok=False, fixtures=[], results=[], error=error)
        try:
            payload = self._get(
                "/fixtures", {"league": _LEAGUE_MAP[competition], "season": self._season()}
            )
        except httpx.HTTPError as exc:
            return SourceResult(ok=False, fixtures=[], results=[], error=str(exc))
        except ValueError as exc:
            return SourceResult(ok=False, fixtures=[], results=[], error=f"invalid JSON: {exc}")

        try:
            return _parse_fixtures(payload, competition)
        except (KeyError, TypeError, ValueError) as exc:
            return SourceResult(ok=False, fixtures=[], results=[], error=f"unexpected payload: {exc}")

    def fetch_standings(self, competition: str = "PL") -> StandingsResult:
        error = self._precheck(competition)
        if error:
            return StandingsResult(ok=False, standings=[], error=error)
        try:
            payload = self._get(
                "/standings", {"league": _LEAGUE_MAP[competition], "season": self._season()}
            )
        except httpx.HTTPError as exc:
            return StandingsResult(ok=False, standings=[], error=str(exc))
        except ValueError as exc:
            return StandingsResult(ok=False, standings=[], error=f"invalid JSON: {exc}")

        try:
            return _parse_standings(payload, competition)
        except (KeyError, TypeError, ValueError) as exc:
            return StandingsResult(ok=False, standings=[], error=f"unexpected payload: {exc}")
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `uv run pytest tests/test_api_football.py -v && uv run pytest -q && uv run ruff check .`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/touchline/sources/api_football.py tests/fixtures/api_football tests/test_api_football.py
git commit -m "feat: api-football backup source client"
```

---

### Task 3: Config field + CLI registry + docs

**Files:**
- Modify: `src/touchline/config.py` (add `source` field)
- Modify: `src/touchline/cli.py` (SOURCES registry)
- Modify: `touchline.config.json` (add `"source": "espn"`)
- Modify: `brain/sources.md` (item 1 wording)
- Modify: `README.md` (self-hosting step 3)
- Test: `tests/test_config.py`, `tests/test_cli.py` (extend both)

**Interfaces:**
- Consumes: `ESPNClient` (Task 1), `APIFootballClient` (Task 2), existing `FootballDataClient`, existing `TouchlineConfig`/`load_config`.
- Produces: `TouchlineConfig.source: Literal["espn", "api-football", "football-data"] = "espn"`; `cli.SOURCES: dict[str, type]`.

- [ ] **Step 1: Write the failing tests.** Append to `tests/test_config.py`:

```python
def test_source_defaults_to_espn(tmp_path):
    path = tmp_path / "touchline.config.json"
    path.write_text(
        json.dumps({"club": {"name": "Chelsea", "code": "CHE"}, "competitions": ["PL"]}),
        encoding="utf-8",
    )
    assert load_config(path).source == "espn"


def test_source_accepts_known_values():
    for value in ("espn", "api-football", "football-data"):
        cfg = TouchlineConfig(
            club={"name": "Chelsea", "code": "CHE"}, competitions=["PL"], source=value
        )
        assert cfg.source == value


def test_source_rejects_unknown_value():
    with pytest.raises(ValidationError):
        TouchlineConfig(
            club={"name": "Chelsea", "code": "CHE"}, competitions=["PL"], source="fotmob"
        )
```

Append to `tests/test_cli.py`:

```python
def test_sources_registry_covers_all_config_values():
    from touchline.cli import SOURCES
    from touchline.sources.api_football import APIFootballClient
    from touchline.sources.espn import ESPNClient
    from touchline.sources.football_data import FootballDataClient

    assert SOURCES == {
        "espn": ESPNClient,
        "api-football": APIFootballClient,
        "football-data": FootballDataClient,
    }


def test_main_facts_instantiates_configured_source(tmp_path, capsys, monkeypatch):
    config_path = tmp_path / "touchline.config.json"
    config_path.write_text(
        json.dumps(
            {"club": {"name": "Chelsea", "code": "CHE"}, "competitions": ["PL"], "source": "espn"}
        ),
        encoding="utf-8",
    )
    import touchline.cli as cli

    monkeypatch.setitem(cli.SOURCES, "espn", lambda: FakeSource())
    assert main(["facts", "--config", str(config_path)]) == 0
    bundle = json.loads(capsys.readouterr().out)
    assert bundle["club"]["code"] == "CHE"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_config.py tests/test_cli.py -v`
Expected: new tests FAIL (`source` unknown field passes silently? no — pydantic ignores extras by default, so `test_source_defaults_to_espn` fails with AttributeError; registry import fails with ImportError).

- [ ] **Step 3: Implement.** In `src/touchline/config.py`: add `from typing import Literal` and the field on `TouchlineConfig`:

```python
    source: Literal["espn", "api-football", "football-data"] = "espn"
```

In `src/touchline/cli.py`: replace the `FootballDataClient` import and instantiation with:

```python
from touchline.sources.api_football import APIFootballClient
from touchline.sources.espn import ESPNClient
from touchline.sources.football_data import FootballDataClient

SOURCES: dict[str, type] = {
    "espn": ESPNClient,
    "api-football": APIFootballClient,
    "football-data": FootballDataClient,
}
```

and in `main()`'s facts branch:

```python
        config = load_config(args.config)
        print(run_facts(SOURCES[config.source](), config))
```

(The old `test_main_facts_uses_config_path` test monkeypatched `cli.FootballDataClient`; update it to `monkeypatch.setitem(cli.SOURCES, "espn", lambda: FakeSource())` — with no `source` in its config JSON the default "espn" applies.)

- [ ] **Step 4: Update config + docs.** `touchline.config.json`: add `"source": "espn",` as the first key. `brain/sources.md` item 1: replace "Free-tier football-data.org under the hood." with "Served by the source selected in `touchline.config.json` (`source`: ESPN by default; api-football or football-data.org selectable)." `README.md` self-hosting step 3: replace the football-data-token step with:

```markdown
3. Pick a data source in `touchline.config.json` (`"source"`): `espn` (default,
   no key needed), `api-football` (set `API_FOOTBALL_KEY`, from
   [api-football.com](https://www.api-football.com/)), or `football-data`
   (set `FOOTBALL_DATA_TOKEN`, from [football-data.org](https://www.football-data.org/)).
```

- [ ] **Step 5: Run the full suite + live smoke**

Run: `uv run pytest -q && uv run ruff check . && uv run touchline facts | head -25`
Expected: suite green; the smoke now hits ESPN keylessly and prints a bundle with real PL data (competitions[0].errors null, table populated).

- [ ] **Step 6: Commit**

```bash
git add src/touchline/config.py src/touchline/cli.py touchline.config.json brain/sources.md README.md tests/test_config.py tests/test_cli.py
git commit -m "feat: config-selectable data source (espn default, api-football backup)"
```

---

## Self-Review Notes

- **Spec coverage:** ESPN client → Task 1; api-football client → Task 2; config/wiring/docs (`source` field, registry, config json, sources.md, README) → Task 3. "Not building" items appear in no task.
- **Type consistency:** `ESPNClient`/`APIFootballClient` constructor signatures in Tasks 1–2 match Task 3's registry usage (`SOURCES[...]()`— zero-arg instantiation works because all params are optional). `run_facts(source, config)` unchanged from the existing CLI.
- **Note:** ESPN fixture counts in Task 1 tests are marked adjustable to the actual recorded data; everything else is exact.
