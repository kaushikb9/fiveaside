"""Owner preferences: loading touchline.config.json."""

from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field


class ClubConfig(BaseModel, frozen=True):
    name: str
    code: str  # abbreviation for your configured source: ESPN abbreviation (default,
    # e.g. "MAN" for Man United), football-data.org TLA, or unused for
    # api-football (which has no codes — match `name` to its team name instead)
    crest: str | None = None  # URL of the club badge, shown in the site header
    subreddit: str | None = None
    thesportsdb_id: str | None = None  # TheSportsDB numeric team id (e.g. "133610"
    # for Chelsea) — required only by the espn+thesportsdb layered source


class FeedConfig(BaseModel, frozen=True):
    label: str
    url: str


class FPLConfig(BaseModel, frozen=True):
    team_id: int | None = None  # the owner's FPL entry id, once the season starts
    league_ids: list[int] = []  # mini-leagues to track
    horizon_gws: int = 6  # fixture-ticker lookahead


class TouchlineConfig(BaseModel, frozen=True):
    club: ClubConfig
    competitions: list[str] = Field(min_length=1)
    timezone: str = "UTC"
    feeds: list[FeedConfig] = []
    voice: str = ""
    source: Literal["espn", "api-football", "football-data", "espn+thesportsdb"] = "espn"
    fpl: FPLConfig = Field(default_factory=FPLConfig)


def load_config(path: str | Path = "touchline.config.json") -> TouchlineConfig:
    return TouchlineConfig.model_validate_json(Path(path).read_text(encoding="utf-8"))
