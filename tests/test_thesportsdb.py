import json
from datetime import UTC, datetime
from pathlib import Path

import httpx

from touchline.core.models import MatchStatus
from touchline.sources.base import MatchSource
from touchline.sources.thesportsdb import TheSportsDBClient

FIXTURES = Path(__file__).parent / "fixtures" / "thesportsdb"


def _client_with(handler, team_id="133610") -> TheSportsDBClient:
    transport = httpx.MockTransport(handler)
    return TheSportsDBClient(team_id, client=httpx.Client(transport=transport))


def _fixture_handler(request: httpx.Request) -> httpx.Response:
    if "eventsnext" in request.url.path:
        payload = json.loads((FIXTURES / "eventsnext.json").read_text())
    else:
        payload = json.loads((FIXTURES / "eventslast.json").read_text())
    return httpx.Response(200, json=payload)


def test_conforms_to_match_source_protocol():
    client = _client_with(_fixture_handler)
    assert isinstance(client, MatchSource)


def test_friendlies_include_next_and_last_events():
    client = _client_with(_fixture_handler)
    res = client.fetch_matches("FRIENDLIES")
    assert res.ok
    # upcoming + played friendlies (corrupted skipped); scoreless-FT stays a fixture
    assert [f.id for f in res.fixtures] == ["2414272", "2413990", "2413501"]
    assert [r.id for r in res.results] == ["2413990"]

    upcoming = res.fixtures[0]
    assert upcoming.status == MatchStatus.SCHEDULED
    assert upcoming.kickoff == datetime(2026, 8, 1, 9, 45, tzinfo=UTC)
    assert upcoming.home.name == "Chelsea"
    assert upcoming.away.name == "Tottenham Hotspur"
    assert upcoming.away.crest and upcoming.away.crest.startswith("http")
    assert upcoming.competition.code == "FRIENDLIES"
    assert upcoming.competition.name == "Club Friendlies"

    played = res.results[0]
    assert played.home_score == 6
    assert played.away_score == 4
    assert played.away.name == "Western Sydney Wanderers"


def test_events_filtered_by_competition():
    client = _client_with(_fixture_handler)
    res = client.fetch_matches("PL")
    assert res.ok
    # only the PL events from the payloads, not the friendlies
    assert [f.id for f in res.fixtures] == ["2494100", "2413500"]
    assert [r.id for r in res.results] == ["2413500"]
    assert res.fixtures[0].competition.name == "English Premier League"


def test_finished_event_without_scores_yields_no_result():
    client = _client_with(_fixture_handler)
    res = client.fetch_matches("FRIENDLIES")
    # same convention as the ESPN parser: the fixture survives, the result is dropped
    assert all(r.id != "2413501" for r in res.results)
    assert any(f.id == "2413501" for f in res.fixtures)


def test_missing_team_id_degrades():
    client = _client_with(_fixture_handler, team_id=None)
    res = client.fetch_matches("FRIENDLIES")
    assert not res.ok
    assert "thesportsdb_id" in res.error


def test_unknown_competition_degrades():
    client = _client_with(_fixture_handler)
    res = client.fetch_matches("BUNDESLIGA")
    assert not res.ok
    assert "BUNDESLIGA" in res.error


def test_both_endpoints_failing_degrades():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500)

    client = _client_with(handler)
    res = client.fetch_matches("FRIENDLIES")
    assert not res.ok
    assert "eventsnext.php" in res.error and "eventslast.php" in res.error


def test_one_endpoint_failing_keeps_the_other_and_notes_error():
    def handler(request: httpx.Request) -> httpx.Response:
        if "eventslast" in request.url.path:
            return httpx.Response(500)
        return _fixture_handler(request)

    client = _client_with(handler)
    res = client.fetch_matches("FRIENDLIES")
    assert res.ok
    assert [f.id for f in res.fixtures] == ["2414272"]
    assert res.results == []
    assert "eventslast.php" in res.error


def test_invalid_json_degrades():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"not json")

    client = _client_with(handler)
    res = client.fetch_matches("FRIENDLIES")
    assert not res.ok and "JSON" in res.error
