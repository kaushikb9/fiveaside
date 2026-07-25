"""Owner preferences: loading touchline.config.json."""

from pathlib import Path

from pydantic import BaseModel, Field


class ClubConfig(BaseModel, frozen=True):
    name: str
    code: str  # football-data.org team TLA, e.g. "CHE"
    subreddit: str | None = None


class FeedConfig(BaseModel, frozen=True):
    label: str
    url: str


class TouchlineConfig(BaseModel, frozen=True):
    club: ClubConfig
    competitions: list[str] = Field(min_length=1)
    timezone: str = "UTC"
    feeds: list[FeedConfig] = []
    voice: str = ""


def load_config(path: str | Path = "touchline.config.json") -> TouchlineConfig:
    return TouchlineConfig.model_validate_json(Path(path).read_text(encoding="utf-8"))
