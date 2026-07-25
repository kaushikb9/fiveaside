from datetime import UTC, datetime

from touchline.config import ClubConfig, TouchlineConfig
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
        {"home": "Chelsea", "away": "Arsenal", "score": "2–1",
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
    assert comp["table"][0] == {
        "pos": 1, "team": "Chelsea", "played": 1, "points": 3, "gd": 1,
        "crest": "https://crests.football-data.org/61.png",
    }
    assert comp["club_position"] == {"pos": 1, "points": 3, "played": 1}
    assert comp["errors"] == {"matches": None, "standings": None}

    # Only f2 is within the 14-day horizon; f3 is beyond it.
    assert facts["club_upcoming"] == [
        {"opponent": "Aston Villa", "at_home": False,
         "kickoff_local": "Tue 18 Aug 19:30", "competition": "PL",
         "opponent_crest": "https://crests.football-data.org/58.png"}
    ]


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
