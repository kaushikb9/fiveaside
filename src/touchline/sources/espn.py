"""ESPN unofficial API client: matches + standings behind the source protocols."""

from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx

from touchline.core.models import Competition, Fixture, MatchStatus, Result, Standing, Team
from touchline.sources.base import SourceResult, StandingsResult

_LEAGUE_MAP = {"PL": "eng.1", "CL": "uefa.champions", "FRIENDLIES": "club.friendly"}

_LIVE_STATUSES = {
    "STATUS_IN_PLAY",
    "STATUS_HALFTIME",
    "STATUS_FIRST_HALF",
    "STATUS_SECOND_HALF",
}

PAST_DAYS = 120
FUTURE_DAYS = 45

_TBD_NAME = "TBD"


def _team(payload: dict[str, Any]) -> Team:
    name = (payload.get("displayName") or "").strip()
    return Team(name=name or _TBD_NAME, code=payload.get("abbreviation"), crest=payload.get("logo"))


def _status(type_payload: dict[str, Any]) -> MatchStatus:
    if type_payload.get("completed"):
        return MatchStatus.FINISHED
    if type_payload.get("name") in _LIVE_STATUSES:
        return MatchStatus.LIVE
    return MatchStatus.SCHEDULED


def _parse_scoreboard(payload: dict[str, Any], competition: str) -> SourceResult:
    leagues = payload.get("leagues") or []
    name = (leagues[0].get("name") if leagues else None) or competition
    comp = Competition(code=competition, name=name)

    fixtures: list[Fixture] = []
    results: list[Result] = []

    for event in payload.get("events", []):
        try:
            comp_entry = (event.get("competitions") or [{}])[0]
            competitors = comp_entry.get("competitors") or []
            home = next((c for c in competitors if c.get("homeAway") == "home"), None)
            away = next((c for c in competitors if c.get("homeAway") == "away"), None)
            if home is None or away is None:
                continue
            status_payload = comp_entry.get("status") or event.get("status") or {}
            status = _status(status_payload.get("type") or {})
            common = {
                "id": str(event["id"]),
                "competition": comp,
                "kickoff": event["date"],
                "home": _team(home.get("team") or {}),
                "away": _team(away.get("team") or {}),
            }
            fixtures.append(Fixture(status=status, **common))
            if status == MatchStatus.FINISHED:
                try:
                    home_score = int(home["score"])
                    away_score = int(away["score"])
                except (KeyError, TypeError, ValueError):
                    continue
                results.append(Result(home_score=home_score, away_score=away_score, **common))
        except (KeyError, TypeError, ValueError):
            continue

    return SourceResult(ok=True, fixtures=fixtures, results=results)


def _parse_standings(payload: dict[str, Any], competition: str) -> StandingsResult:
    comp = Competition(code=competition, name=payload.get("name") or competition)
    standings: list[Standing] = []

    children = payload.get("children") or []
    entries = ((children[0].get("standings") or {}).get("entries") or []) if children else []
    for entry in entries:
        try:
            stats = {s.get("name"): s.get("value") for s in entry.get("stats") or []}
            team_payload = entry.get("team") or {}
            logos = team_payload.get("logos") or []
            team = Team(
                name=(team_payload.get("displayName") or "").strip() or _TBD_NAME,
                code=team_payload.get("abbreviation"),
                crest=(logos[0].get("href") if logos else None),
            )
            standings.append(
                Standing(
                    competition=comp,
                    position=int(stats["rank"]),
                    team=team,
                    played=int(stats["gamesPlayed"]),
                    won=int(stats["wins"]),
                    draw=int(stats["ties"]),
                    lost=int(stats["losses"]),
                    points=int(stats["points"]),
                    goals_for=int(stats["pointsFor"]),
                    goals_against=int(stats["pointsAgainst"]),
                )
            )
        except (KeyError, TypeError, ValueError):
            continue

    return StandingsResult(ok=True, standings=standings)


class ESPNClient:
    """`MatchSource` + `StandingsSource` backed by ESPN's unofficial site API."""

    def __init__(
        self,
        *,
        base_url: str = "https://site.api.espn.com/apis",
        client: httpx.Client | None = None,
        timeout: float = 10.0,
        now_fn: Callable[[], datetime] | None = None,
    ) -> None:
        self.base_url = base_url
        self._client = client or httpx.Client(timeout=timeout)
        self._now_fn = now_fn or (lambda: datetime.now(UTC))

    def _league(self, competition: str) -> str | None:
        return _LEAGUE_MAP.get(competition)

    def fetch_matches(self, competition: str = "PL") -> SourceResult:
        league = self._league(competition)
        if league is None:
            error = f"ESPN source has no mapping for competition '{competition}'"
            return SourceResult(ok=False, fixtures=[], results=[], error=error)

        today = self._now_fn().date()
        window = (
            f"{today - timedelta(days=PAST_DAYS):%Y%m%d}-"
            f"{today + timedelta(days=FUTURE_DAYS):%Y%m%d}"
        )
        url = f"{self.base_url}/site/v2/sports/soccer/{league}/scoreboard"
        try:
            response = self._client.get(url, params={"dates": window, "limit": 200})
            response.raise_for_status()
            payload = response.json()
        except httpx.HTTPError as exc:
            return SourceResult(ok=False, fixtures=[], results=[], error=str(exc))
        except ValueError as exc:
            return SourceResult(ok=False, fixtures=[], results=[], error=f"invalid JSON: {exc}")

        try:
            return _parse_scoreboard(payload, competition)
        except (KeyError, TypeError, ValueError) as exc:
            error = f"unexpected payload: {exc}"
            return SourceResult(ok=False, fixtures=[], results=[], error=error)

    def fetch_standings(self, competition: str = "PL") -> StandingsResult:
        league = self._league(competition)
        if league is None:
            error = f"ESPN source has no mapping for competition '{competition}'"
            return StandingsResult(ok=False, standings=[], error=error)

        url = f"{self.base_url}/v2/sports/soccer/{league}/standings"
        try:
            response = self._client.get(url)
            response.raise_for_status()
            payload = response.json()
        except httpx.HTTPError as exc:
            return StandingsResult(ok=False, standings=[], error=str(exc))
        except ValueError as exc:
            return StandingsResult(ok=False, standings=[], error=f"invalid JSON: {exc}")

        try:
            return _parse_standings(payload, competition)
        except (KeyError, TypeError, ValueError) as exc:
            return StandingsResult(ok=False, standings=[], error=f"unexpected payload: {exc}")
