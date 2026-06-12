"""Competition-agnostic domain models.

Pure data: stdlib + pydantic only. No I/O, no network, no framework imports.
"""

from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field


class MatchStatus(StrEnum):
    SCHEDULED = "SCHEDULED"
    LIVE = "LIVE"
    FINISHED = "FINISHED"


class Competition(BaseModel):
    model_config = ConfigDict(frozen=True)

    code: str
    name: str
    season: str | None = None


class Team(BaseModel):
    model_config = ConfigDict(frozen=True)

    name: str
    code: str | None = None


class Fixture(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: str
    competition: Competition
    home: Team
    away: Team
    kickoff: datetime
    status: MatchStatus = MatchStatus.SCHEDULED
    matchday: int | None = None
    group: str | None = None


class Result(BaseModel):
    model_config = ConfigDict(frozen=True)

    fixture: Fixture
    home_score: int = Field(ge=0)
    away_score: int = Field(ge=0)

    @property
    def winner(self) -> Team | None:
        if self.home_score > self.away_score:
            return self.fixture.home
        if self.away_score > self.home_score:
            return self.fixture.away
        return None


class Standing(BaseModel):
    model_config = ConfigDict(frozen=True)

    competition: Competition
    team: Team
    played: int = Field(ge=0)
    won: int = Field(ge=0)
    draw: int = Field(ge=0)
    lost: int = Field(ge=0)
    goals_for: int
    goals_against: int
    points: int = Field(ge=0)
    position: int | None = None
    group: str | None = None

    @property
    def goal_difference(self) -> int:
        return self.goals_for - self.goals_against
