"""football-data.org v4 client: fixtures + results from the matches endpoint."""

import os
from typing import Any

import httpx
from pydantic import ValidationError

from touchline.core.models import Competition, Fixture, MatchStatus, Result, Standing, Team
from touchline.sources.base import SourceResult, StandingsResult

_STATUS_MAP = {
    "SCHEDULED": MatchStatus.SCHEDULED,
    "TIMED": MatchStatus.SCHEDULED,
    "IN_PLAY": MatchStatus.LIVE,
    "PAUSED": MatchStatus.LIVE,
    "FINISHED": MatchStatus.FINISHED,
}

_WINNER_MAP = {
    "HOME_TEAM": "HOME",
    "AWAY_TEAM": "AWAY",
    "DRAW": "DRAW",
}

_TBD_NAME = "TBD"


def _team(payload: dict[str, Any]) -> Team:
    name = payload.get("name") or ""
    return Team(name=name.strip() or _TBD_NAME, code=payload.get("tla"))


def _parse_matches(payload: dict[str, Any], competition: str) -> SourceResult:
    comp_payload = payload.get("competition") or {}
    comp = Competition(
        code=comp_payload.get("code", competition),
        name=comp_payload.get("name", competition),
    )

    fixtures: list[Fixture] = []
    results: list[Result] = []

    for match in payload.get("matches", []):
        status = _STATUS_MAP.get(match.get("status", ""), MatchStatus.SCHEDULED)
        home = _team(match.get("homeTeam") or {})
        away = _team(match.get("awayTeam") or {})
        common = {
            "id": str(match["id"]),
            "competition": comp,
            "kickoff": match["utcDate"],
            "home": home,
            "away": away,
            "matchday": match.get("matchday"),
            "group": match.get("group"),
        }

        fixtures.append(Fixture(status=status, **common))

        if status == MatchStatus.FINISHED:
            full_time = (match.get("score") or {}).get("fullTime") or {}
            home_score = full_time.get("home")
            away_score = full_time.get("away")
            if home_score is not None and away_score is not None:
                winner = _WINNER_MAP.get((match.get("score") or {}).get("winner", ""))
                results.append(
                    Result(
                        home_score=home_score,
                        away_score=away_score,
                        winner=winner,
                        **common,
                    )
                )

    return SourceResult(ok=True, fixtures=fixtures, results=results)


def _parse_standings(payload: dict[str, Any], competition: str) -> StandingsResult:
    comp_payload = payload.get("competition") or {}
    comp = Competition(
        code=comp_payload.get("code", competition),
        name=comp_payload.get("name", competition),
    )

    standings: list[Standing] = []

    for group_entry in payload.get("standings", []):
        if group_entry.get("type") != "TOTAL":
            continue
        group = group_entry.get("group")
        for row in group_entry.get("table", []):
            try:
                standings.append(
                    Standing(
                        competition=comp,
                        group=group,
                        position=row["position"],
                        team=_team(row.get("team") or {}),
                        played=row["playedGames"],
                        won=row["won"],
                        draw=row["draw"],
                        lost=row["lost"],
                        points=row["points"],
                        goals_for=row["goalsFor"],
                        goals_against=row["goalsAgainst"],
                    )
                )
            except (KeyError, TypeError, ValueError, ValidationError):
                continue

    return StandingsResult(ok=True, standings=standings)


class FootballDataClient:
    """`MatchSource` backed by football-data.org v4."""

    def __init__(
        self,
        token: str | None = None,
        *,
        base_url: str = "https://api.football-data.org/v4",
        client: httpx.Client | None = None,
        timeout: float = 10.0,
    ) -> None:
        self.token = token or os.environ.get("FOOTBALL_DATA_TOKEN")
        self.base_url = base_url
        self._client = client or httpx.Client(
            headers={"X-Auth-Token": self.token} if self.token else {},
            timeout=timeout,
        )

    def fetch_matches(self, competition: str = "WC") -> SourceResult:
        try:
            response = self._client.get(f"{self.base_url}/competitions/{competition}/matches")
            response.raise_for_status()
            payload = response.json()
        except httpx.HTTPError as exc:
            return SourceResult(ok=False, fixtures=[], results=[], error=str(exc))
        except ValueError as exc:
            return SourceResult(ok=False, fixtures=[], results=[], error=f"invalid JSON: {exc}")

        try:
            return _parse_matches(payload, competition)
        except (KeyError, TypeError, ValueError) as exc:
            error = f"unexpected payload: {exc}"
            return SourceResult(ok=False, fixtures=[], results=[], error=error)

    def fetch_standings(self, competition: str = "WC") -> StandingsResult:
        try:
            response = self._client.get(f"{self.base_url}/competitions/{competition}/standings")
            response.raise_for_status()
            payload = response.json()
        except httpx.HTTPError as exc:
            return StandingsResult(ok=False, standings=[], error=str(exc))
        except ValueError as exc:
            return StandingsResult(ok=False, standings=[], error=f"invalid JSON: {exc}")

        try:
            return _parse_standings(payload, competition)
        except (KeyError, TypeError, ValueError) as exc:
            error = f"unexpected payload: {exc}"
            return StandingsResult(ok=False, standings=[], error=error)
