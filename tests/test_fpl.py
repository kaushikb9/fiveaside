import json
from datetime import UTC, datetime
from pathlib import Path

import httpx

from touchline.config import ClubConfig, TouchlineConfig
from touchline.core.fpl import _compact_players, build_fpl_facts
from touchline.sources.fpl import FPLClient

FIXTURES = Path(__file__).parent / "fixtures" / "fpl"
NOW = datetime(2026, 8, 20, 18, 0, tzinfo=UTC)
CONFIG = TouchlineConfig(
    club=ClubConfig(name="Chelsea", code="CHE"),
    competitions=["PL"],
    timezone="Asia/Kolkata",
)


def _client_with(handler) -> FPLClient:
    transport = httpx.MockTransport(handler)
    return FPLClient(client=httpx.Client(transport=transport))


def _fixture_handler(request: httpx.Request) -> httpx.Response:
    if "bootstrap-static" in request.url.path:
        payload = json.loads((FIXTURES / "bootstrap.json").read_text())
    else:
        payload = json.loads((FIXTURES / "fixtures.json").read_text())
    return httpx.Response(200, json=payload)


def _bundle():
    client = _client_with(_fixture_handler)
    return build_fpl_facts(client.fetch_bootstrap(), client.fetch_fixtures(), CONFIG, now=NOW)


def test_fetch_bootstrap_parses_and_skips_corrupt():
    client = _client_with(_fixture_handler)
    res = client.fetch_bootstrap()
    assert res.ok
    assert len(res.events) == 3
    assert len(res.teams) == 4
    # 10 elements in fixture, one (id 99) missing required fields -> skipped
    assert len(res.elements) == 9
    assert all(e.web_name for e in res.elements)


def test_fetch_fixtures_parses_whole_season():
    client = _client_with(_fixture_handler)
    res = client.fetch_fixtures()
    assert res.ok
    assert len(res.fixtures) == 6
    assert any(f.event is None for f in res.fixtures)


def test_http_error_degrades():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500)

    client = _client_with(handler)
    boot = client.fetch_bootstrap()
    assert not boot.ok and boot.error
    assert boot.elements == []
    fix = client.fetch_fixtures()
    assert not fix.ok and fix.error


def test_build_picks_next_gameweek_and_formats_ist_deadline():
    bundle = _bundle()
    assert bundle["date"] == "2026-08-20"  # 18:00 UTC = 23:30 IST, still the 20th
    assert bundle["season"] == "2026/27"
    assert bundle["gameweek"] == {
        "id": 1,
        "deadline_utc": "2026-08-21T17:30:00Z",
        "deadline_local": "Fri 21 Aug, 23:00",
    }
    assert [d["gw"] for d in bundle["next_deadlines"]] == [2, 3]
    assert bundle["errors"] == {"bootstrap": None, "fixtures": None}


def test_build_after_deadline_rolls_to_next_gameweek():
    later = datetime(2026, 8, 22, 12, 0, tzinfo=UTC)
    client = _client_with(_fixture_handler)
    bundle = build_fpl_facts(client.fetch_bootstrap(), client.fetch_fixtures(), CONFIG, now=later)
    assert bundle["gameweek"]["id"] == 2
    assert bundle["ticker"]["from_gw"] == 2


def test_ticker_rows_sorted_by_easiest_run():
    ticker = _bundle()["ticker"]
    assert ticker["from_gw"] == 1
    assert ticker["gws"] == 6
    # ARS 2.5, LIV 2.5 (alpha tiebreak), CHE 4.0, HUL 4.5; null-event + far-future excluded
    assert [r["team"] for r in ticker["rows"]] == ["ARS", "LIV", "CHE", "HUL"]
    ars = ticker["rows"][0]
    assert ars["avg"] == 2.5
    assert ars["fixtures"] == [
        {"gw": 1, "opp": "CHE", "home": True, "fdr": 3},
        {"gw": 2, "opp": "HUL", "home": False, "fdr": 2},
    ]


def test_compaction_keeps_flagged_drops_fringe():
    client = _client_with(_fixture_handler)
    boot = client.fetch_bootstrap()
    short_names = {t.id: t.short_name for t in boot.teams}
    rows = _compact_players(boot.elements, short_names, top_n={1: 1, 2: 1, 3: 1, 4: 1})
    names = [r["name"] for r in rows]
    # top-1 per position by ownership + the flagged star; fringe players out
    assert names == ["Raya", "Gabriel", "InjuredStar", "Haaland"]
    star = next(r for r in rows if r["name"] == "InjuredStar")
    assert star["status"] == "d"
    assert star["chance"] == 75
    assert "Knee injury" in star["news"]
    raya = next(r for r in rows if r["name"] == "Raya")
    assert "status" not in raya and "news" not in raya
    haaland = next(r for r in rows if r["name"] == "Haaland")
    assert haaland["price"] == 15.5
    assert haaland["team"] == "LIV"
