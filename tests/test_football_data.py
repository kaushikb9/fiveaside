import json
from pathlib import Path

import httpx
import pytest

from terrace.core.models import MatchStatus
from terrace.sources.base import MatchSource, SourceResult
from terrace.sources.football_data import FootballDataClient

FIXTURE_PATH = Path(__file__).parent / "fixtures" / "football_data" / "wc_matches.json"


def _load_fixture() -> dict:
    return json.loads(FIXTURE_PATH.read_text())


def _client_with_transport(handler) -> FootballDataClient:
    transport = httpx.MockTransport(handler)
    return FootballDataClient(token="dummy", client=httpx.Client(transport=transport))


def test_fetch_matches_parses_fixtures_and_results():
    payload = _load_fixture()

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v4/competitions/WC/matches"
        return httpx.Response(200, json=payload)

    client = _client_with_transport(handler)
    result = client.fetch_matches("WC")

    assert result.ok is True
    assert result.error is None
    assert len(result.fixtures) == len(payload["matches"])
    assert len(result.results) == 2  # only FINISHED matches with a score

    # one asserted result winner/score
    mex_can = next(r for r in result.results if r.id == "1001")
    assert mex_can.home_score == 2
    assert mex_can.away_score == 1
    assert mex_can.winner == "HOME"

    # one asserted fixture group value
    usa_wal = next(f for f in result.fixtures if f.id == "1003")
    assert usa_wal.group == "Group A"


def test_status_mapping():
    payload = _load_fixture()

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=payload)

    client = _client_with_transport(handler)
    result = client.fetch_matches("WC")

    timed = next(f for f in result.fixtures if f.id == "1003")
    assert timed.status == MatchStatus.SCHEDULED

    finished = next(f for f in result.fixtures if f.id == "1001")
    assert finished.status == MatchStatus.FINISHED


@pytest.mark.parametrize("status_code", [429, 500])
def test_fetch_matches_degrades_on_http_error(status_code):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(status_code, json={"message": "boom"})

    client = _client_with_transport(handler)
    result = client.fetch_matches("WC")

    assert result.ok is False
    assert result.fixtures == []
    assert result.results == []
    assert result.error is not None


def test_fetch_matches_does_not_raise_on_network_error():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused")

    client = _client_with_transport(handler)
    result = client.fetch_matches("WC")

    assert result.ok is False
    assert isinstance(result, SourceResult)
    assert result.error is not None


def test_client_satisfies_match_source_protocol():
    client = FootballDataClient(token="dummy")
    src: MatchSource = client
    assert isinstance(src, MatchSource)


def test_fetch_matches_degrades_on_invalid_json():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200, content=b"not json", headers={"content-type": "application/json"}
        )

    client = _client_with_transport(handler)
    result = client.fetch_matches("WC")

    assert result.ok is False
    assert result.fixtures == []
    assert result.results == []
    assert result.error is not None


def test_finished_match_without_score_is_fixture_only():
    payload = _load_fixture()
    # A FINISHED match with no fullTime score should still become a Fixture,
    # but must NOT be promoted to a Result.
    payload["matches"].append(
        {
            "id": "1005",
            "utcDate": "2026-06-14T12:00:00Z",
            "status": "FINISHED",
            "matchday": 1,
            "group": "Group D",
            "homeTeam": {"name": "Spain", "tla": "ESP"},
            "awayTeam": {"name": "Japan", "tla": "JPN"},
            "score": {"winner": None, "fullTime": {"home": None, "away": None}},
        }
    )

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=payload)

    client = _client_with_transport(handler)
    result = client.fetch_matches("WC")

    assert result.ok is True
    assert any(f.id == "1005" for f in result.fixtures)
    assert all(r.id != "1005" for r in result.results)


def test_fetch_matches_falls_back_to_passed_competition_code_when_missing():
    payload = _load_fixture()
    del payload["competition"]

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=payload)

    client = _client_with_transport(handler)
    result = client.fetch_matches("WC")

    assert result.ok is True
    assert result.fixtures[0].competition.code == "WC"
    assert result.fixtures[0].competition.name == "WC"


def test_fetch_matches_default_competition_is_wc():
    payload = _load_fixture()
    seen_paths = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen_paths.append(request.url.path)
        return httpx.Response(200, json=payload)

    client = _client_with_transport(handler)
    result = client.fetch_matches()

    assert result.ok is True
    assert seen_paths == ["/v4/competitions/WC/matches"]
