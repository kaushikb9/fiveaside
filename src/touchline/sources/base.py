"""Source interface and shared return container for match data sources."""

from typing import Protocol, runtime_checkable

from pydantic import BaseModel

from touchline.core.models import Fixture, Result, Standing


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

class LineupResult(BaseModel, frozen=True):
    """Who played in one match, per club, with the same degradation contract.

    `teams` is [{club, players: [{name, started}]}]. Anyone who did not get on
    the pitch is absent rather than listed as having played nothing.
    """

    ok: bool
    teams: list[dict]
    error: str | None = None
