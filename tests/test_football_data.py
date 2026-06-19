import json
from pathlib import Path

import httpx
import pytest

from terrace.core.models import MatchStatus
from terrace.sources.base import MatchSource, SourceResult, StandingsSource
from terrace.sources.football_data import FootballDataClient

FIXTURE_PATH = Path(__file__).parent / "fixtures" / "football_data" / "wc_matches.json"
STANDINGS_FIXTURE_PATH = Path(__file__).parent / "fixtures" / "football_data" / "wc_standings.json"


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


def test_null_team_names_are_labeled_tbd_without_dropping_other_matches():
    payload = _load_fixture()

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=payload)

    client = _client_with_transport(handler)
    result = client.fetch_matches("WC")

    assert result.ok is True
    assert result.error is None

    # knockout match with a null `name` on homeTeam is parsed, not dropped
    null_name_match = next(f for f in result.fixtures if f.id == "1005")
    assert null_name_match.home.name == "TBD"
    assert null_name_match.home.code is None
    assert null_name_match.away.name == "Brazil"

    # knockout match with a wholly null homeTeam/awayTeam object is parsed too
    null_team_match = next(f for f in result.fixtures if f.id == "1006")
    assert null_team_match.home.name == "TBD"
    assert null_team_match.home.code is None
    assert null_team_match.away.name == "TBD"
    assert null_team_match.away.code is None

    # the presence of TBD matches must not suppress the rest of the payload
    assert len(result.fixtures) == len(payload["matches"])
    assert len(result.results) == 2
    mex_can = next(r for r in result.results if r.id == "1001")
    assert mex_can.home_score == 2
    assert mex_can.away_score == 1


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


# ---------------------------------------------------------------------------
# Standings tests
# ---------------------------------------------------------------------------


def test_fetch_standings_parses_fixture():
    payload = json.loads(STANDINGS_FIXTURE_PATH.read_text())

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v4/competitions/WC/standings"
        return httpx.Response(200, json=payload)

    client = _client_with_transport(handler)
    result = client.fetch_standings("WC")

    assert result.ok is True
    assert result.error is None

    # GROUP_A: 4 valid rows (malformed row missing `position` is skipped)
    # GROUP_B: 4 valid rows — total 8; HOME-type entry is not counted
    assert len(result.standings) == 8

    # Correct position and points for Mexico (pos 1, 6 pts in GROUP_A)
    mex = next(s for s in result.standings if s.team.name == "Mexico")
    assert mex.position == 1
    assert mex.points == 6
    assert mex.group == "GROUP_A"

    # All standings carry the correct competition code
    assert all(s.competition.code == "WC" for s in result.standings)

    # HOME-type group entries are not included
    assert all(s.team.name != "BAD_ROW_NO_POSITION" for s in result.standings)


def test_fetch_standings_skips_malformed_row_without_dropping_rest():
    payload = json.loads(STANDINGS_FIXTURE_PATH.read_text())

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=payload)

    client = _client_with_transport(handler)
    result = client.fetch_standings("WC")

    assert result.ok is True
    # The malformed row (missing `position`) is skipped, but the 8 valid rows remain
    assert len(result.standings) == 8
    group_a_rows = [s for s in result.standings if s.group == "GROUP_A"]
    # GROUP_A has 5 rows in fixture but 1 is malformed → 4 valid
    assert len(group_a_rows) == 4


def test_fetch_standings_degrades_on_http_error():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, json={"message": "boom"})

    client = _client_with_transport(handler)
    result = client.fetch_standings("WC")

    assert result.ok is False
    assert result.standings == []
    assert result.error is not None


def test_client_satisfies_standings_source_protocol():
    client = FootballDataClient(token="dummy")
    src: StandingsSource = client
    assert isinstance(src, StandingsSource)


def test_fetch_standings_degrades_on_network_error():
    """A low-level ConnectError is caught and returned as ok=False, not raised."""

    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused")

    client = _client_with_transport(handler)
    result = client.fetch_standings("WC")

    assert result.ok is False
    assert result.standings == []
    assert result.error is not None


def test_fetch_standings_degrades_on_invalid_json():
    """Non-JSON bodies are caught and returned as ok=False, not raised."""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200, content=b"not json", headers={"content-type": "application/json"}
        )

    client = _client_with_transport(handler)
    result = client.fetch_standings("WC")

    assert result.ok is False
    assert result.standings == []
    assert result.error is not None


def test_fetch_standings_filters_home_type_entries():
    """Only entries where type == 'TOTAL' contribute standings rows;
    HOME / AWAY entries must be silently ignored regardless of their contents."""
    payload = json.loads(STANDINGS_FIXTURE_PATH.read_text())

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=payload)

    client = _client_with_transport(handler)
    result = client.fetch_standings("WC")

    assert result.ok is True
    # The fixture's HOME-type GROUP_A block has rows for Mexico and USA whose
    # data differs from the TOTAL block (e.g. playedGames=1 vs 2).  We prove
    # none of those rows leaked in by checking that every Standing was built
    # from a TOTAL entry (playedGames >= 2 in the fixture, HOME entries have 1).
    assert all(s.played >= 2 for s in result.standings), (
        "HOME-type rows (playedGames=1) must not appear in the result"
    )


def test_fetch_standings_default_competition_is_wc():
    """Calling fetch_standings() with no arguments hits the WC endpoint."""
    payload = json.loads(STANDINGS_FIXTURE_PATH.read_text())
    seen_paths: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen_paths.append(request.url.path)
        return httpx.Response(200, json=payload)

    client = _client_with_transport(handler)
    result = client.fetch_standings()

    assert result.ok is True
    assert seen_paths == ["/v4/competitions/WC/standings"]
