"""Source interface and shared return container for match data sources."""

from typing import Protocol, runtime_checkable

from pydantic import BaseModel

from touchline.core.models import Fixture, MatchDetail, NewsItem, Result, Standing


class SourceResult(BaseModel, frozen=True):
    """Result of a source fetch, carrying graceful degradation to callers.

    On success: `ok=True`, populated `fixtures`/`results`, `error=None`.
    On failure: `ok=False`, empty lists, and a short human-readable `error`.
    """

    ok: bool
    fixtures: list[Fixture]
    results: list[Result]
    error: str | None = None


@runtime_checkable
class MatchSource(Protocol):
    """A source of fixtures and results for a given competition."""

    def fetch_matches(self, competition: str) -> SourceResult: ...


class NewsResult(BaseModel, frozen=True):
    """Result of a news fetch, carrying graceful degradation to callers.

    On success: ``ok=True``, populated ``items``, ``error=None``.
    On failure: ``ok=False``, empty list, and a short human-readable ``error``.
    """

    ok: bool
    items: list[NewsItem]
    error: str | None = None


@runtime_checkable
class NewsSource(Protocol):
    """A source of news headlines."""

    def fetch_news(self) -> NewsResult: ...


class StandingsResult(BaseModel, frozen=True):
    """Result of a standings fetch, carrying graceful degradation to callers.

    On success: ``ok=True``, populated ``standings``, ``error=None``.
    On failure: ``ok=False``, empty list, and a short human-readable ``error``.
    """

    ok: bool
    standings: list[Standing]
    error: str | None = None


@runtime_checkable
class StandingsSource(Protocol):
    """A source of competition group/league standings."""

    def fetch_standings(self, competition: str) -> StandingsResult: ...


class MatchDetailResult(BaseModel, frozen=True):
    """Result of a single-match detail fetch, with graceful degradation."""

    ok: bool
    detail: MatchDetail | None = None
    error: str | None = None


@runtime_checkable
class MatchDetailSource(Protocol):
    """A source that can fetch one match's detail by id."""

    def fetch_match_detail(self, match_id: str) -> MatchDetailResult: ...
