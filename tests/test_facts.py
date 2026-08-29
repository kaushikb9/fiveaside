from datetime import UTC, datetime

from touchline.config import ClubConfig, TouchlineConfig
from touchline.core import facts as facts_module
from touchline.core.facts import build_facts
from touchline.core.models import Competition, Fixture, MatchStatus, Result, Standing, Team
from touchline.sources.base import SourceResult, StandingsResult

PL = Competition(code="PL", name="Premier League")
CHELSEA = Team(name="Chelsea", code="CHE", crest="https://crests.football-data.org/61.png")
ARSENAL = Team(name="Arsenal", code="ARS", crest="https://crests.football-data.org/57.png")
SPURS = Team(name="Tottenham", code="TOT")  # no crest — must pass through as None
VILLA = Team(name="Aston Villa", code="AVL", crest="https://crests.football-data.org/58.png")

CONFIG = TouchlineConfig(
    club=ClubConfig(name="Chelsea", code="CHE"),
    competitions=["PL"],
    timezone="Asia/Kolkata",
)

# 09:00 IST on Sun 16 Aug 2026 — a normal morning-coffee run.
NOW = datetime(2026, 8, 16, 3, 30, tzinfo=UTC)


def _result(id_, kickoff, home, away, hs, as_):
    return Result(
        id=id_, competition=PL, kickoff=kickoff, home=home, away=away,
        home_score=hs, away_score=as_,
    )


def _fixture(id_, kickoff, home, away, status=MatchStatus.SCHEDULED):
    return Fixture(id=id_, competition=PL, kickoff=kickoff, home=home, away=away, status=status)


def _standing(pos, team, points):
    return Standing(
        competition=PL, position=pos, team=team, played=1, won=1, draw=0,
        lost=0, points=points, goals_for=2, goals_against=1,
    )


def _bundle(fixtures=(), results=(), standings=(), m_err=None, s_err=None):
    return build_facts(
        [(
            "PL",
            SourceResult(
                ok=m_err is None, fixtures=list(fixtures), results=list(results), error=m_err
            ),
            StandingsResult(ok=s_err is None, standings=list(standings), error=s_err),
        )],
        CONFIG,
        now=NOW,
    )


def test_buckets_yesterday_today_and_upcoming():
    yesterday_r = _result("r1", datetime(2026, 8, 15, 14, 0, tzinfo=UTC), CHELSEA, ARSENAL, 2, 1)
    today_f = _fixture("f1", datetime(2026, 8, 16, 14, 0, tzinfo=UTC), SPURS, VILLA)
    upcoming_f = _fixture("f2", datetime(2026, 8, 18, 14, 0, tzinfo=UTC), VILLA, CHELSEA)
    far_f = _fixture("f3", datetime(2026, 9, 20, 14, 0, tzinfo=UTC), CHELSEA, SPURS)

    facts = _bundle(
        fixtures=[today_f, upcoming_f, far_f],
        results=[yesterday_r],
        standings=[_standing(1, CHELSEA, 3), _standing(2, ARSENAL, 0)],
    )

    assert facts["date"] == "2026-08-16"
    assert facts["timezone"] == "Asia/Kolkata"
    assert facts["club"] == {"name": "Chelsea", "code": "CHE"}

    comp = facts["competitions"][0]
    assert comp["code"] == "PL"
    assert comp["name"] == "Premier League"
    assert comp["yesterday_results"] == [
        {"home": "Chelsea", "away": "Arsenal", "score": "2–1", "date": "Sat 15 Aug",
         "competition": "PL", "club_involved": True,
         "home_crest": "https://crests.football-data.org/61.png",
         "away_crest": "https://crests.football-data.org/57.png"}
    ]
    assert comp["today_matches"] == [
        {"home": "Tottenham", "away": "Aston Villa", "kickoff_local": "19:30",
         "status": "SCHEDULED", "competition": "PL", "club_involved": False,
         "home_crest": None,
         "away_crest": "https://crests.football-data.org/58.png"}
    ]
    # form is derived from the results we hold, not carried by the source:
    # Chelsea beat Arsenal 2-1 yesterday, so one match deep the form is "W".
    assert comp["table"][0] == {
        "pos": 1, "team": "Chelsea", "played": 1, "points": 3, "gd": 1,
        "crest": "https://crests.football-data.org/61.png", "form": "W",
    }
    assert comp["table"][1]["team"] == "Arsenal"
    assert comp["table"][1]["form"] == "L"
    assert comp["club_position"] == {"pos": 1, "points": 3, "played": 1}
    assert comp["errors"] == {"matches": None, "standings": None}

    # No date ceiling: both f2 and f3 appear, ordered by kickoff.
    assert facts["club_upcoming"] == [
        {"opponent": "Aston Villa", "at_home": False,
         "kickoff_local": "Tue 18 Aug 19:30", "competition": "PL",
         "opponent_crest": "https://crests.football-data.org/58.png"},
        {"opponent": "Tottenham", "at_home": True,
         "kickoff_local": "Sun 20 Sep 19:30", "competition": "PL",
         "opponent_crest": None},
    ]


def test_club_upcoming_limited_to_next_five():
    fixtures = [
        _fixture(f"f{i}", datetime(2026, 9, i + 1, 14, 0, tzinfo=UTC), CHELSEA, ARSENAL)
        for i in range(7)
    ]
    facts = _bundle(fixtures=fixtures)
    assert len(facts["club_upcoming"]) == 5
    assert facts["club_upcoming"][0]["kickoff_local"].startswith("Tue 01 Sep")


def test_non_club_rows_capped():
    # 15 non-club matches today + 1 club match today. The cap is a prompt-size
    # guard, not an editorial filter — a league page wants the whole slate.
    fixtures = [
        _fixture(f"n{i}", datetime(2026, 8, 16, 10 + (i % 8), i * 3 % 60, tzinfo=UTC), SPURS, VILLA)
        for i in range(15)
    ]
    fixtures.append(_fixture("club1", datetime(2026, 8, 16, 18, 0, tzinfo=UTC), CHELSEA, ARSENAL))
    facts = _bundle(fixtures=fixtures)
    today = facts["competitions"][0]["today_matches"]
    assert len(today) == 16  # all 15 plus the club match, under the 20 cap
    assert any(m["club_involved"] for m in today)


def test_club_form_is_newest_first_from_clubs_perspective():
    older_away_win = _result("r1", datetime(2026, 8, 8, 14, 0, tzinfo=UTC), VILLA, CHELSEA, 0, 2)
    newer_home_draw = _result("r2", datetime(2026, 8, 15, 14, 0, tzinfo=UTC), CHELSEA, SPURS, 1, 1)
    not_ours = _result("r3", datetime(2026, 8, 15, 16, 0, tzinfo=UTC), ARSENAL, VILLA, 3, 0)

    facts = _bundle(results=[older_away_win, newer_home_draw, not_ours])

    assert facts["club_form"] == [
        {"result": "D", "score": "1–1", "opponent": "Tottenham", "at_home": True,
         "competition": "PL", "date": "2026-08-15", "opponent_crest": None},
        {"result": "W", "score": "2–0", "opponent": "Aston Villa", "at_home": False,
         "competition": "PL", "date": "2026-08-08",
         "opponent_crest": "https://crests.football-data.org/58.png"},
    ]


def test_naive_kickoffs_are_treated_as_utc():
    r = _result("r1", datetime(2026, 8, 15, 14, 0), CHELSEA, ARSENAL, 1, 0)
    facts = _bundle(results=[r])
    assert len(facts["competitions"][0]["yesterday_results"]) == 1


def test_source_errors_are_surfaced_not_hidden():
    facts = _bundle(m_err="boom", s_err="kaboom")
    comp = facts["competitions"][0]
    assert comp["errors"] == {"matches": "boom", "standings": "kaboom"}
    assert comp["yesterday_results"] == []
    assert comp["table"] == []
    assert comp["club_position"] is None
    # No fixtures/results to source a name from — falls back to the code.
    assert comp["name"] == "PL"


def test_team_form_is_derived_from_results_oldest_to_newest():
    """No source returns per-team form, so it is computed from the matches.

    Guards the specific failure this replaced: the digest carried five-result
    form strings for teams that had played one match, because a model wrote
    them from memory instead of from the bundle.
    """
    d = lambda day: datetime(2026, 8, day, 14, 0, tzinfo=UTC)  # noqa: E731
    results = [
        _result("r1", d(1), CHELSEA, ARSENAL, 2, 1),   # CHE W, ARS L
        _result("r2", d(2), ARSENAL, SPURS, 1, 1),     # ARS D, TOT D
        _result("r3", d(3), SPURS, CHELSEA, 0, 3),     # TOT L, CHE W
        _result("r4", d(4), CHELSEA, VILLA, 0, 1),     # CHE L, AVL W
    ]
    form = facts_module._team_form(results)

    assert form["Chelsea"] == "WWL"      # oldest to newest, newest last
    assert form["Arsenal"] == "LD"
    assert form["Tottenham"] == "DL"
    assert form["Aston Villa"] == "W"
    # A team with no completed match is absent rather than blank-padded.
    assert "Brentford" not in form


def test_team_form_keeps_only_the_last_five():
    results = [
        _result(f"r{i}", datetime(2026, 8, i, 14, 0, tzinfo=UTC), CHELSEA, ARSENAL, 1, 0)
        for i in range(1, 9)
    ]
    form = facts_module._team_form(results)
    assert form["Chelsea"] == "WWWWW"
    assert len(form["Arsenal"]) == 5


def test_current_season_form_does_not_reach_back_into_last_season():
    last_season = _result(
        "old", datetime(2026, 5, 24, 14, 0, tzinfo=UTC), CHELSEA, ARSENAL, 3, 0
    )
    current_season = _result(
        "new", datetime(2026, 8, 15, 14, 0, tzinfo=UTC), CHELSEA, ARSENAL, 1, 0
    )

    facts = _bundle(
        results=[last_season, current_season],
        standings=[_standing(1, CHELSEA, 3), _standing(2, ARSENAL, 0)],
    )

    comp = facts["competitions"][0]
    assert comp["table"][0]["form"] == "W"
    assert facts["club_form"] == [
        {"result": "W", "score": "1–0", "opponent": "Arsenal", "at_home": True,
         "competition": "PL", "date": "2026-08-15", "opponent_crest": "https://crests.football-data.org/57.png"}
    ]
