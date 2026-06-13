"""Source interface and shared return container for match data sources."""

from typing import Protocol, runtime_checkable

from pydantic import BaseModel

from terrace.core.models import Fixture, Result


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
