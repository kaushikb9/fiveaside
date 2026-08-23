import json
from datetime import UTC, datetime
from pathlib import Path

import httpx

from touchline.config import ClubConfig, TouchlineConfig
from touchline.core.fpl import _compact_players, _player_file, build_fpl_facts
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
    assert bundle["errors"] == {"bootstrap": None, "fixtures": None, "entry": None}


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


def test_player_file_carries_evidence_not_verdicts():
    records = _bundle()["player_file"]
    assert records, "the player file should not be empty"
    raya = next(r for r in records if r["name"] == "Raya")
    assert raya["team"] == "ARS" and raya["pos"] == "GK" and raya["price"] == 6.0
    assert raya["ownership"] == 36.4
    # evidence only — verdict, direction and trigger belong to the brain
    assert not {"verdict", "moved", "trigger"} & set(raya)
    # most-owned first, so the file opens on the players that matter
    assert records[0]["ownership"] >= records[-1]["ownership"]


def test_player_file_marks_penalty_takers_and_flags():
    records = _bundle()["player_file"]
    palmer = next(r for r in records if r["name"] == "Palmer")
    assert palmer["penalties"] is True
    raya = next(r for r in records if r["name"] == "Raya")
    assert "penalties" not in raya  # not a taker -> key absent, never False
    star = next(r for r in records if r["name"] == "InjuredStar")
    assert star["status"] == "d" and star["chance"] == 75


def test_captain_poll_carries_most_captained_without_inventing_shares():
    poll = _bundle()["captain_poll"]
    assert poll["most_captained"] == {"name": "Haaland", "team": "LIV", "ownership": 69.3}
    assert [r["name"] for r in poll["rows"]][0] == "Haaland"
    # ownership is a real number; no fabricated captaincy percentage anywhere
    assert all(set(r) == {"name", "team", "ownership"} for r in poll["rows"])


def test_live_gameweek_tracks_the_one_being_played():
    bundle = _bundle()
    # GW1 is in play (is_current) while GW2 is the one being planned for
    assert bundle["live_gameweek"] == {"id": 1, "finished": False}
    assert bundle["gameweek"]["id"] == 1


def test_entry_absent_degrades_to_none():
    bundle = _bundle()
    assert bundle["desk"] is None
    assert bundle["leagues"] == []
    assert bundle["errors"]["entry"] is None


def test_entry_and_league_parse_into_desk_and_rows():
    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if "bootstrap-static" in path:
            return httpx.Response(200, json=json.loads((FIXTURES / "bootstrap.json").read_text()))
        if "leagues-classic" in path:
            return httpx.Response(
                200,
                json={
                    "league": {"name": "FPL 26-27"},
                    "standings": {
                        "results": [
                            {
                                "rank": 1,
                                "entry_name": "Rival",
                                "player_name": "R",
                                "entry": 999,
                                "total": 70,
                                "event_total": 70,
                            },
                            {
                                "rank": 2,
                                "entry_name": "Wabi Sabi Xabi",
                                "player_name": "KB",
                                "entry": 7149204,
                                "total": 61,
                                "event_total": 61,
                            },
                        ]
                    },
                },
            )
        if "picks" in path:
            return httpx.Response(
                200,
                json={
                    "entry_history": {"event_transfers": 1},
                    "picks": [{"element": 40, "position": 1, "is_captain": True}],
                },
            )
        if "/entry/" in path:
            return httpx.Response(
                200,
                json={
                    "name": "Wabi Sabi Xabi",
                    "player_first_name": "Kaushik",
                    "player_last_name": "Bhat",
                    "summary_overall_rank": 1400000,
                    "summary_overall_points": 61,
                    "summary_event_points": 61,
                    "last_deadline_bank": 0,
                    "last_deadline_value": 1000,
                    "chips": [{"name": "wildcard"}],
                },
            )
        return httpx.Response(200, json=json.loads((FIXTURES / "fixtures.json").read_text()))

    config = TouchlineConfig(
        club=ClubConfig(name="Chelsea", code="CHE"),
        competitions=["PL"],
        timezone="Asia/Kolkata",
        fpl={"team_id": 7149204, "league_ids": [391164]},
    )
    client = _client_with(handler)
    entry = client.fetch_entry(7149204, event=1, league_ids=[391164])
    bundle = build_fpl_facts(
        client.fetch_bootstrap(), client.fetch_fixtures(), config, now=NOW, entry=entry
    )

    desk = bundle["desk"]
    assert desk["team_name"] == "Wabi Sabi Xabi"
    assert "manager" not in desk  # real names are dropped at the facts layer
    assert desk["entered"] is True
    assert desk["value"] == 100.0 and desk["bank"] == 0.0
    assert desk["chips_used"] == ["wildcard"]

    league = bundle["leagues"][0]
    assert league["name"] == "FPL 26-27"
    assert [r["is_owner"] for r in league["rows"]] == [False, True]


def test_entry_degrades_without_costing_the_bundle():
    def handler(request: httpx.Request) -> httpx.Response:
        if "/entry/" in request.url.path:
            return httpx.Response(500)
        return _fixture_handler(request)

    client = _client_with(handler)
    entry = client.fetch_entry(7149204, event=1, league_ids=[391164])
    assert not entry.ok and entry.error
    bundle = build_fpl_facts(
        client.fetch_bootstrap(), client.fetch_fixtures(), CONFIG, now=NOW, entry=entry
    )
    assert bundle["desk"] is None
    assert bundle["errors"]["entry"]
    assert bundle["player_file"]  # the rest of the bundle survives


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


def test_real_names_never_reach_the_bundle():
    """The API hands back real names; the facts layer must delete them.

    This is the guarantee behind "nicknames only" — the brain cannot leak what
    it was never given, so the check belongs here rather than in the prompt.
    """

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if "bootstrap-static" in path:
            return httpx.Response(200, json=json.loads((FIXTURES / "bootstrap.json").read_text()))
        if "leagues-classic" in path:
            return httpx.Response(
                200,
                json={
                    "league": {"name": "FPL 26-27"},
                    "standings": {
                        "results": [
                            {
                                "rank": 1,
                                "entry_name": "Wabi Sabi Xabi",
                                "player_name": "Reallife Name",
                                "entry": 7149204,
                                "total": 61,
                                "event_total": 61,
                            },
                            {
                                "rank": 2,
                                "entry_name": "Stranger FC",
                                "player_name": "Someone Else",
                                "entry": 999,
                                "total": 40,
                                "event_total": 40,
                            },
                        ]
                    },
                },
            )
        if "picks" in path:
            return httpx.Response(
                200, json={"entry_history": {}, "picks": [{"element": 40, "position": 1}]}
            )
        if "/entry/" in path:
            return httpx.Response(
                200,
                json={
                    "name": "Wabi Sabi Xabi",
                    "player_first_name": "Reallife",
                    "player_last_name": "Name",
                    "summary_overall_points": 61,
                },
            )
        return httpx.Response(200, json=json.loads((FIXTURES / "fixtures.json").read_text()))

    config = TouchlineConfig(
        club=ClubConfig(name="Chelsea", code="CHE"),
        competitions=["PL"],
        timezone="Asia/Kolkata",
        fpl={
            "team_id": 7149204,
            "league_ids": [391164],
            "people": [{"nick": "Xabi", "entry": 7149204, "club": "Chelsea", "owner": True}],
        },
    )
    client = _client_with(handler)
    entry = client.fetch_entry(7149204, event=1, league_ids=[391164])
    bundle = build_fpl_facts(
        client.fetch_bootstrap(),
        client.fetch_fixtures(),
        config,
        now=NOW,
        entry=entry,
        people={"Xabi": entry},
    )

    blob = json.dumps(bundle)
    assert "Reallife" not in blob and "Someone Else" not in blob
    # team names survive — they are the public identity; nicknames tag the group
    assert "Wabi Sabi Xabi" in blob and "Stranger FC" in blob
    row = next(r for r in bundle["leagues"][0]["rows"] if r["entry"] == 7149204)
    assert row["nick"] == "Xabi"
    assert "manager" not in row
    assert [s["nick"] for s in bundle["squads"]] == ["Xabi"]


def test_player_file_floor_never_drops_a_player_we_own():
    """An ownership floor keeps the file honest, but a squad member always has
    a record — otherwise tapping your own shirt opens nothing."""
    client = _client_with(_fixture_handler)
    boot = client.fetch_bootstrap()
    short_names = {t.id: t.short_name for t in boot.teams}

    # FringeFit sits at 0.0% ownership: below any sane floor.
    unfiltered = _player_file(boot.elements, short_names, None, {})
    assert all(r["name"] != "FringeFit" for r in unfiltered)

    # ...until one of us picks him, at which point he must appear.
    owned = _player_file(boot.elements, short_names, None, {33: ["Enzo"]})
    fringe = next(r for r in owned if r["name"] == "FringeFit")
    assert fringe["owned_by"] == ["Enzo"]


def test_player_file_keeps_flagged_players_below_the_floor():
    client = _client_with(_fixture_handler)
    boot = client.fetch_bootstrap()
    short_names = {t.id: t.short_name for t in boot.teams}
    records = _player_file(boot.elements, short_names, None, {})
    names = [r["name"] for r in records]
    # InjuredStar is 15% owned and doubtful -> in on both counts
    assert "InjuredStar" in names
    # FringeInjured is injured but 0.1% owned -> nobody needs that file
    assert "FringeInjured" not in names
