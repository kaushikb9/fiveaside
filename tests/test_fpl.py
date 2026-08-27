import json
from datetime import UTC, datetime
from pathlib import Path

import httpx

from touchline.config import ClubConfig, FPLConfig, TouchlineConfig
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


def test_player_file_holds_everyone_and_tags_who_owns_them():
    """The file is the spine every surface filters, so it holds every player —
    a missing record is a dead end in the UI."""
    client = _client_with(_fixture_handler)
    boot = client.fetch_bootstrap()
    short_names = {t.id: t.short_name for t in boot.teams}

    records = _player_file(boot.elements, short_names, None, {})
    assert len(records) == len(boot.elements)
    # even the 0.0%-owned fringe player has a record
    assert any(r["name"] == "FringeFit" for r in records)

    owned = _player_file(boot.elements, short_names, None, {33: ["Enzo"]})
    fringe = next(r for r in owned if r["name"] == "FringeFit")
    assert fringe["owned_by"] == ["Enzo"]


def test_player_file_is_evidence_only():
    client = _client_with(_fixture_handler)
    boot = client.fetch_bootstrap()
    short_names = {t.id: t.short_name for t in boot.teams}
    records = _player_file(boot.elements, short_names, None, {})
    star = next(r for r in records if r["name"] == "InjuredStar")
    assert star["status"] == "d" and star["chance"] == 75
    # the judgment layer lives in fpl.json, keyed by the same id
    assert all(not {"verdict", "moved", "trigger", "why"} & set(r) for r in records)
    assert all(isinstance(r["id"], int) for r in records)


def test_picks_carry_captaincy_multiplier_and_chip():
    """The multiplier is the chip's fingerprint and has to survive to the site.

    Bench slots come back with multiplier 0, a captain with 2, a triple
    captain with 3, and a bench-boosted bench with 1. Losing any of that makes
    a squad unscoreable: the pitch cannot show a (C) and the total cannot
    double the right player.
    """

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if "bootstrap-static" in path:
            return httpx.Response(200, json=json.loads((FIXTURES / "bootstrap.json").read_text()))
        if "picks" in path:
            return httpx.Response(
                200,
                json={
                    "active_chip": "bboost",
                    "entry_history": {
                        "event_transfers": 1,
                        "points_on_bench": 7,
                        "event_transfers_cost": 4,
                    },
                    "picks": [
                        {"element": 40, "position": 1, "is_captain": True, "multiplier": 2},
                        {"element": 41, "position": 2, "is_vice_captain": True, "multiplier": 1},
                        {"element": 42, "position": 12, "multiplier": 0},
                    ],
                },
            )
        if "/entry/" in path:
            return httpx.Response(
                200,
                json={
                    "name": "Wabi Sabi Xabi",
                    "summary_overall_points": 61,
                    "summary_event_points": 61,
                    "last_deadline_bank": 0,
                    "last_deadline_value": 1000,
                },
            )
        return httpx.Response(200, json=json.loads((FIXTURES / "fixtures.json").read_text()))

    config = TouchlineConfig(
        club=ClubConfig(name="Chelsea", code="CHE"),
        competitions=["PL"],
        fpl=FPLConfig(team_id=7149204),
    )
    client = _client_with(handler)
    entry = client.fetch_entry(7149204, event=1)
    desk = build_fpl_facts(
        client.fetch_bootstrap(), client.fetch_fixtures(), config, now=NOW, entry=entry
    )["desk"]

    captain, vice, benched = desk["picks"]
    assert captain["captain"] is True and captain["multiplier"] == 2
    assert vice["vice"] is True and "multiplier" not in vice  # 1 is the default, not noise
    assert benched["role"] == "bench" and benched["multiplier"] == 0

    assert desk["active_chip"] == "bboost"
    assert desk["bench_points"] == 7
    assert desk["transfers_cost"] == 4


def test_form_merges_cup_ties_into_the_last_five():
    """ROADMAP 4b: a cup tie used to leave a gap the form strip could not show.

    Builds two league rows and one EFL Cup tie between them, and asserts the
    strip is the last five matches PLAYED, in date order, each saying which
    competition it was.
    """
    from datetime import datetime

    from touchline.core.fpl import _recent, other_competition_rows
    from touchline.sources.fpl import FPLFixture, FPLFixturesResult

    short_names = {1: "CHE", 2: "ARS"}
    fixtures = FPLFixturesResult(
        ok=True,
        fixtures=[
            FPLFixture(event=1, team_h=1, team_a=2, team_h_difficulty=3,
                       team_a_difficulty=3, team_h_score=2, team_a_score=1,
                       finished=True, kickoff_time="2026-08-15T14:00:00Z"),
            FPLFixture(event=2, team_h=2, team_a=1, team_h_difficulty=3,
                       team_a_difficulty=3, team_h_score=0, team_a_score=3,
                       finished=True, kickoff_time="2026-08-29T14:00:00Z"),
        ],
    )

    class _T:
        def __init__(self, name):
            self.name = name

    class _R:
        def __init__(self, home, away, hs, a_s, when):
            self.home, self.away = _T(home), _T(away)
            self.home_score, self.away_score = hs, a_s
            self.kickoff = when

    # A midweek cup tie, sitting between the two league games.
    other = other_competition_rows(
        {"EFL": [_R("Bradford City", "Chelsea", 1, 4, datetime(2026, 8, 22, 18, 45))]},
        [("Chelsea", "CHE"), ("Arsenal", "ARS")],
    )

    recent = _recent(fixtures, short_names, 5, other)
    che = recent["CHE"]

    assert [r["comp"] for r in che] == ["PL", "EFL", "PL"], "the cup tie sits in date order"
    assert [r["result"] for r in che] == ["W", "W", "W"]
    # The cup row keeps the opponent's real name; it has no FPL code to take.
    assert che[1]["opp"] == "Bradford City"
    assert che[1]["home"] is False and che[1]["gf"] == 4


def test_a_cup_tie_writes_a_row_only_for_the_club_we_follow():
    """Chelsea v Wrexham is Chelsea's match. Wrexham has no card to appear on."""
    from datetime import datetime

    from touchline.core.fpl import other_competition_rows

    class _T:
        def __init__(self, name):
            self.name = name

    class _R:
        def __init__(self, home, away):
            self.home, self.away = _T(home), _T(away)
            self.home_score, self.away_score = 1, 0
            self.kickoff = datetime(2026, 8, 22, 18, 45)

    rows = other_competition_rows({"EFL": [_R("Chelsea", "Wrexham")]}, [("Chelsea", "CHE")])
    assert list(rows) == ["CHE"]
    assert rows["CHE"][0]["opp"] == "Wrexham", "the opponent keeps its own name"
    assert rows["CHE"][0]["result"] == "W"


def test_a_tie_between_two_clubs_we_do_not_follow_is_not_an_error():
    """Most of the Champions League is not our business, and that is fine."""
    from datetime import datetime

    from touchline.core.fpl import other_competition_rows

    class _T:
        def __init__(self, name):
            self.name = name

    class _R:
        def __init__(self):
            self.home, self.away = _T("Bayern Munich"), _T("Real Madrid")
            self.home_score, self.away_score = 2, 1
            self.kickoff = datetime(2026, 8, 22, 19, 0)

    assert other_competition_rows({"CL": [_R()]}, [("Chelsea", "CHE")]) == {}


def test_form_does_not_reach_back_into_last_season():
    """ESPN's window is 120 days, which in August still contains May.

    Without a cutoff Arsenal's "last five" opened with three Champions League
    ties from the previous season above one league game from this one: true
    chronologically, useless as form beside a current-season table.
    """
    from datetime import datetime

    from touchline.core.fpl import other_competition_rows

    class _T:
        def __init__(self, name):
            self.name = name

    class _R:
        def __init__(self, when):
            self.home, self.away = _T("Arsenal"), _T("Paris Saint-Germain")
            self.home_score, self.away_score = 1, 1
            self.kickoff = when

    args = ({"CL": [_R(datetime(2026, 5, 30)), _R(datetime(2026, 9, 16))]},
            [("Arsenal", "ARS")])

    assert len(other_competition_rows(*args)["ARS"]) == 2, "no cutoff keeps both"

    kept = other_competition_rows(*args, since="2026-07-01")["ARS"]
    assert [r["date"] for r in kept] == ["2026-09-16"], "May belongs to last season"


def test_a_july_european_qualifier_still_counts():
    """The cutoff is 1 July, not the first league game, precisely for these."""
    from datetime import datetime

    from touchline.core.fpl import other_competition_rows

    class _T:
        def __init__(self, name):
            self.name = name

    class _R:
        def __init__(self):
            self.home, self.away = _T("Crystal Palace"), _T("Shakhtar Donetsk")
            self.home_score, self.away_score = 2, 1
            self.kickoff = datetime(2026, 7, 24)

    rows = other_competition_rows(
        {"UECL": [_R()]}, [("Crystal Palace", "CRY")], since="2026-07-01"
    )
    assert rows["CRY"][0]["date"] == "2026-07-24"
