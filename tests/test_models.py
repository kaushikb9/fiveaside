from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from terrace.core.models import (
    Competition,
    Fixture,
    MatchStatus,
    Result,
    Standing,
    Team,
)

COMPETITION = Competition(code="WC", name="FIFA World Cup 2026", season="2026")

HOME = Team(name="Brazil", code="BRA")
AWAY = Team(name="Argentina", code="ARG")

FIXTURE = Fixture(
    id="match-1",
    competition=COMPETITION,
    home=HOME,
    away=AWAY,
    kickoff=datetime(2026, 6, 14, 18, 0, tzinfo=UTC),
    status=MatchStatus.SCHEDULED,
    matchday=1,
    group="A",
)


def test_competition_construction():
    assert COMPETITION.code == "WC"
    assert COMPETITION.name == "FIFA World Cup 2026"
    assert COMPETITION.season == "2026"


def test_fixture_construction():
    assert FIXTURE.home == HOME
    assert FIXTURE.away == AWAY
    assert FIXTURE.competition == COMPETITION
    assert FIXTURE.status == MatchStatus.SCHEDULED


def test_result_winner_decisive():
    result = Result(fixture=FIXTURE, home_score=2, away_score=1)
    assert result.winner == HOME


def test_result_winner_draw():
    result = Result(fixture=FIXTURE, home_score=1, away_score=1)
    assert result.winner is None


def test_result_negative_score_raises():
    with pytest.raises(ValidationError):
        Result(fixture=FIXTURE, home_score=-1, away_score=0)


def test_standing_goal_difference():
    standing = Standing(
        competition=COMPETITION,
        team=HOME,
        played=3,
        won=2,
        draw=1,
        lost=0,
        goals_for=5,
        goals_against=2,
        points=7,
        position=1,
        group="A",
    )
    assert standing.goal_difference == 3


def test_standing_goal_difference_negative():
    standing = Standing(
        competition=COMPETITION,
        team=AWAY,
        played=3,
        won=0,
        draw=1,
        lost=2,
        goals_for=2,
        goals_against=5,
        points=1,
    )
    assert standing.goal_difference == -3


def test_result_winner_away():
    result = Result(fixture=FIXTURE, home_score=0, away_score=2)
    assert result.winner == AWAY


def test_standing_negative_played_raises():
    with pytest.raises(ValidationError):
        Standing(
            competition=COMPETITION,
            team=HOME,
            played=-1,
            won=0,
            draw=0,
            lost=0,
            goals_for=0,
            goals_against=0,
            points=0,
        )


def test_models_are_frozen():
    with pytest.raises(ValidationError):
        HOME.code = "ZZZ"
