import json
from datetime import UTC, datetime
from pathlib import Path

import httpx

from touchline.core.models import MatchStatus
from touchline.sources.base import MatchSource, StandingsSource
from touchline.sources.espn import ESPNClient, _status

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
    # 4 events in fixture: 2 finished, 1 scheduled, 1 corrupted (skipped) -> 3 fixtures
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


def test_fetch_matches_scheduled_event_has_no_result():
    client = _client_with(_fixture_handler)
    res = client.fetch_matches("PL")
    scheduled = next(f for f in res.fixtures if f.id == "740968")
    assert scheduled.status == MatchStatus.SCHEDULED
    assert all(r.id != "740968" for r in res.results)


def test_fetch_matches_corrupted_event_is_skipped():
    client = _client_with(_fixture_handler)
    res = client.fetch_matches("PL")
    assert all(f.id != "740969" for f in res.fixtures)
    assert all(r.id != "740969" for r in res.results)


def test_fetch_matches_requests_date_window():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        return httpx.Response(200, json={"leagues": [], "events": []})

    client = _client_with(handler)
    client.fetch_matches("PL")
    # NOW is 2026-05-30: window = 120 days back to 45 days forward
    assert "eng.1" in seen["url"]
    assert "dates=20260130-20260714" in seen["url"]


def test_friendlies_league_mapping():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        return httpx.Response(200, json={"leagues": [], "events": []})

    client = _client_with(handler)
    res = client.fetch_matches("FRIENDLIES")
    assert res.ok
    assert "club.friendly" in seen["url"]


def test_fetch_standings_parses_rows():
    client = _client_with(_fixture_handler)
    res = client.fetch_standings("PL")
    assert res.ok
    assert len(res.standings) == 4

    row = res.standings[0]
    assert row.position == 1
    assert row.team.name == "AFC Bournemouth"
    assert row.played == 34
    assert row.won == 20
    assert row.draw == 8
    assert row.lost == 6
    assert row.points == 68
    assert row.goals_for == 65
    assert row.goals_against == 30
    assert row.team.crest and row.team.crest.startswith("http")

    row2 = res.standings[1]
    assert row2.position == 2
    assert row2.team.name == "Arsenal"
    assert row2.played == 34
    assert row2.won == 18
    assert row2.draw == 9
    assert row2.lost == 7
    assert row2.points == 63
    assert row2.goals_for == 58
    assert row2.goals_against == 35


def test_status_maps_live_scheduled_finished():
    assert _status({"name": "STATUS_HALFTIME", "completed": False}) == MatchStatus.LIVE
    assert _status({"name": "STATUS_IN_PLAY", "completed": False}) == MatchStatus.LIVE
    assert _status({"completed": True}) == MatchStatus.FINISHED
    assert _status({"name": "STATUS_SCHEDULED", "completed": False}) == MatchStatus.SCHEDULED


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
