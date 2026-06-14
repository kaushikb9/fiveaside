"""Domain models for Touchline.

This module is pure: no I/O, no third-party clients beyond pydantic. Every
model is competition-agnostic -- nothing here hardcodes the World Cup.
"""

from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, Field


class MatchStatus(StrEnum):
    """Normalized match status, independent of any source's vocabulary."""

    SCHEDULED = "SCHEDULED"
    LIVE = "LIVE"
    FINISHED = "FINISHED"


class Team(BaseModel, frozen=True):
    name: str
    code: str | None = None


class Competition(BaseModel, frozen=True):
    code: str
    name: str


class Fixture(BaseModel, frozen=True):
    """An upcoming or in-progress/finished match, without a final score."""

    id: str
    competition: Competition
    kickoff: datetime
    home: Team
    away: Team
    status: MatchStatus
    matchday: int | None = None
    group: str | None = None


class Result(BaseModel, frozen=True):
    """A completed match with a final score."""

    id: str
    competition: Competition
    kickoff: datetime
    home: Team
    away: Team
    home_score: int = Field(ge=0)
    away_score: int = Field(ge=0)
    winner: str | None = None
    matchday: int | None = None
    group: str | None = None

    @property
    def winning_team(self) -> Team | None:
        if self.home_score > self.away_score:
            return self.home
        if self.away_score > self.home_score:
            return self.away
        return None

    @property
    def is_draw(self) -> bool:
        return self.home_score == self.away_score


class Standing(BaseModel, frozen=True):
    """A single row in a competition group/league table."""

    competition: Competition
    group: str | None = None
    position: int
    team: Team
    played: int
    won: int
    draw: int
    lost: int
    points: int
    goals_for: int
    goals_against: int

    @property
    def goal_difference(self) -> int:
        return self.goals_for - self.goals_against
