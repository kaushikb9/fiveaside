"""TheSportsDB club-events client: the club's own next/last matches.

Uses the free public key, so no signup or secret is involved. The free tier
caps league-wide endpoints hard (5-row tables, truncated event lists), but the
per-team ``eventsnext``/``eventslast`` endpoints reliably carry tour friendlies
that ESPN's scoreboard misses entirely — which is exactly the gap this client
exists to fill. It is club-centric by design and implements only `MatchSource`.
"""

from datetime import UTC, datetime
from typing import Any

import httpx

from touchline.core.models import Competition, Fixture, MatchStatus, Result, Team
from touchline.sources.base import SourceResult

_LEAGUE_TO_CODE = {
    "English Premier League": "PL",
    "UEFA Champions League": "CL",
    "Club Friendlies": "FRIENDLIES",
}

_FINISHED_STATUSES = {"FT", "AET", "PEN", "Match Finished"}
_LIVE_STATUSES = {"1H", "2H", "HT", "ET", "BT", "P", "LIVE"}

_TBD_NAME = "TBD"


def _team(name: Any, badge: Any) -> Team:
    clean = (name or "").strip() if isinstance(name, str) else ""
    crest = badge if isinstance(badge, str) and badge.strip() else None
    return Team(name=clean or _TBD_NAME, crest=crest)


def _status(event: dict[str, Any]) -> MatchStatus:
    status = (event.get("strStatus") or "").strip()
    if status in _FINISHED_STATUSES:
        return MatchStatus.FINISHED
    if status in _LIVE_STATUSES:
        return MatchStatus.LIVE
    return MatchStatus.SCHEDULED


def _parse_events(events: list[dict[str, Any]], competition: str) -> SourceResult:
    comp = Competition(
        code=competition,
        name=next(
            (
                e["strLeague"]
                for e in events
                if _LEAGUE_TO_CODE.get(e.get("strLeague")) == competition
            ),
            competition,
        ),
    )

    fixtures: list[Fixture] = []
    results: list[Result] = []
    for event in events:
        try:
            if _LEAGUE_TO_CODE.get(event.get("strLeague")) != competition:
                continue
            # strTimestamp is naive UTC (e.g. "2026-07-28T09:45:00")
            kickoff = datetime.fromisoformat(event["strTimestamp"]).replace(tzinfo=UTC)
            status = _status(event)
            common = {
                "id": str(event["idEvent"]),
                "competition": comp,
                "kickoff": kickoff,
                "home": _team(event.get("strHomeTeam"), event.get("strHomeTeamBadge")),
                "away": _team(event.get("strAwayTeam"), event.get("strAwayTeamBadge")),
            }
            fixtures.append(Fixture(status=status, **common))
            if status == MatchStatus.FINISHED:
                try:
                    home_score = int(event["intHomeScore"])
                    away_score = int(event["intAwayScore"])
                except (KeyError, TypeError, ValueError):
                    continue
                results.append(Result(home_score=home_score, away_score=away_score, **common))
        except (KeyError, TypeError, ValueError):
            continue

    return SourceResult(ok=True, fixtures=fixtures, results=results)


class TheSportsDBClient:
    """`MatchSource` for the configured club's own events via TheSportsDB."""

    def __init__(
        self,
        team_id: str | None,
        *,
        base_url: str = "https://www.thesportsdb.com/api/v1/json/123",
        client: httpx.Client | None = None,
        timeout: float = 10.0,
    ) -> None:
        self.team_id = team_id
        self.base_url = base_url
        self._client = client or httpx.Client(timeout=timeout)

    def _events(self, path: str, key: str) -> tuple[list[dict[str, Any]], str | None]:
        try:
            response = self._client.get(f"{self.base_url}/{path}", params={"id": self.team_id})
            response.raise_for_status()
            payload = response.json()
        except httpx.HTTPError as exc:
            return [], f"{path}: {exc}"
        except ValueError as exc:
            return [], f"{path}: invalid JSON: {exc}"
        events = payload.get(key) if isinstance(payload, dict) else None
        return (events or []), None

    def fetch_matches(self, competition: str = "FRIENDLIES") -> SourceResult:
        if not self.team_id:
            error = (
                "thesportsdb team id missing: set club.thesportsdb_id in touchline.config.json"
            )
            return SourceResult(ok=False, fixtures=[], results=[], error=error)
        if competition not in _LEAGUE_TO_CODE.values():
            error = f"thesportsdb source has no mapping for competition '{competition}'"
            return SourceResult(ok=False, fixtures=[], results=[], error=error)

        upcoming, next_error = self._events("eventsnext.php", "events")
        played, last_error = self._events("eventslast.php", "results")
        errors = [e for e in (next_error, last_error) if e]
        if len(errors) == 2:
            return SourceResult(ok=False, fixtures=[], results=[], error="; ".join(errors))

        parsed = _parse_events(upcoming + played, competition)
        return parsed.model_copy(update={"error": "; ".join(errors) or None})
