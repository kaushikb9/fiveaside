import json
from datetime import UTC, datetime
from pathlib import Path

import httpx

from touchline.core.models import MatchStatus
from touchline.sources.api_football import APIFootballClient
from touchline.sources.base import MatchSource, StandingsSource

FIXTURES = Path(__file__).parent / "fixtures" / "api_football"
NOW = datetime(2026, 8, 20, 12, 0, tzinfo=UTC)


def _client_with(handler, key="test-key") -> APIFootballClient:
    transport = httpx.MockTransport(handler)
    return APIFootballClient(
        key, client=httpx.Client(transport=transport), now_fn=lambda: NOW
    )


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


def test_missing_key_degrades(monkeypatch):
    monkeypatch.delenv("API_FOOTBALL_KEY", raising=False)
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
