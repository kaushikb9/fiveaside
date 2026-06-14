from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from terrace.core.models import Competition, Result, Standing, Team

COMPETITION = Competition(code="WC", name="FIFA World Cup")
KICKOFF = datetime(2026, 6, 12, 16, 0, tzinfo=UTC)
HOME = Team(name="Mexico", code="MEX")
AWAY = Team(name="Canada", code="CAN")


def _result(home_score: int, away_score: int) -> Result:
    return Result(
        id="1",
        competition=COMPETITION,
        kickoff=KICKOFF,
        home=HOME,
        away=AWAY,
        home_score=home_score,
        away_score=away_score,
        winner=None,
        matchday=1,
        group="Group A",
    )


def _standing(goals_for: int, goals_against: int) -> Standing:
    return Standing(
        competition=COMPETITION,
        group="Group A",
        position=1,
        team=HOME,
        played=1,
        won=0,
        draw=0,
        lost=0,
        points=0,
        goals_for=goals_for,
        goals_against=goals_against,
    )


# -- winning_team / is_draw ---------------------------------------------------


def test_winning_team_home_win():
    r = _result(2, 1)
    assert r.winning_team is r.home
    assert r.is_draw is False


def test_winning_team_away_win():
    r = _result(0, 3)
    assert r.winning_team is r.away
    assert r.is_draw is False


def test_winning_team_draw():
    r = _result(1, 1)
    assert r.winning_team is None
    assert r.is_draw is True


# -- score validation -----------------------------------------------------------


def test_negative_home_score_raises():
    with pytest.raises(ValidationError):
        _result(-1, 0)


def test_negative_away_score_raises():
    with pytest.raises(ValidationError):
        _result(0, -1)


# -- goal_difference -------------------------------------------------------------


def test_goal_difference_positive():
    assert _standing(goals_for=5, goals_against=2).goal_difference == 3


def test_goal_difference_negative():
    assert _standing(goals_for=1, goals_against=4).goal_difference == -3


def test_goal_difference_zero():
    assert _standing(goals_for=2, goals_against=2).goal_difference == 0
