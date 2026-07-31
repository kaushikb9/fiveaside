"""Layer two match sources: a primary plus an overlay that fills its gaps.

Born from a concrete failure: ESPN's friendlies scoreboard carries most of the
preseason but skipped Chelsea's 2026 Sydney tour matches entirely, while
TheSportsDB's per-team feed had them (with scores). The overlay contributes
only matches the primary doesn't already know about; the primary always wins
when both sources carry the same match, and standings come from the primary
alone.
"""

import re
from datetime import UTC, date

from touchline.core.models import Fixture, Result
from touchline.sources.base import (
    MatchSource,
    SourceResult,
    StandingsResult,
    StandingsSource,
)

# Dropped when normalizing team names so "AFC Bournemouth" (ESPN) and
# "Bournemouth" (TheSportsDB) dedupe to the same key.
_STRIP_TOKENS = {"afc", "fc", "cf", "cfc"}


def _norm(name: str) -> str:
    tokens = re.sub(r"[^a-z0-9]+", " ", name.lower()).split()
    kept = [t for t in tokens if t not in _STRIP_TOKENS]
    return " ".join(kept or tokens)


def _key(match: Fixture | Result) -> tuple[date, frozenset[str]]:
    """Same-day + same-pair identity across sources.

    Uses the UTC calendar date (sources disagree on exact kickoff times) and an
    unordered team pair (neutral-venue tour games can have home/away flipped).
    """
    return (
        match.kickoff.astimezone(UTC).date(),
        frozenset({_norm(match.home.name), _norm(match.away.name)}),
    )


def _merge_errors(*errors: str | None) -> str | None:
    parts = [e for e in errors if e]
    return "; ".join(parts) or None


class LayeredSource:
    """`MatchSource` + `StandingsSource` combining a primary source with an overlay."""

    def __init__(self, primary: MatchSource | StandingsSource, overlay: MatchSource) -> None:
        self.primary = primary
        self.overlay = overlay

    def fetch_matches(self, competition: str) -> SourceResult:
        base = self.primary.fetch_matches(competition)
        extra = self.overlay.fetch_matches(competition)

        seen = {_key(f) for f in base.fixtures} | {_key(r) for r in base.results}
        fixtures = sorted(
            list(base.fixtures) + [f for f in extra.fixtures if _key(f) not in seen],
            key=lambda f: f.kickoff,
        )
        results = sorted(
            list(base.results) + [r for r in extra.results if _key(r) not in seen],
            key=lambda r: r.kickoff,
        )
        return SourceResult(
            ok=base.ok or extra.ok,
            fixtures=fixtures,
            results=results,
            error=_merge_errors(base.error, extra.error),
        )

    def fetch_standings(self, competition: str) -> StandingsResult:
        return self.primary.fetch_standings(competition)
