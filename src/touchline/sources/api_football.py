"""api-football.com (api-sports.io v3) client behind the source protocols."""

import os
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

import httpx

from touchline.core.models import (
    Competition,
    Fixture,
    MatchStatus,
    Result,
    Standing,
    Team,
)
from touchline.sources.base import SourceResult, StandingsResult

_LEAGUE_MAP = {"PL": 39, "CL": 2}

_STATUS_MAP = {
    "NS": MatchStatus.SCHEDULED,
    "TBD": MatchStatus.SCHEDULED,
    "PST": MatchStatus.SCHEDULED,
    "1H": MatchStatus.LIVE,
    "HT": MatchStatus.LIVE,
    "2H": MatchStatus.LIVE,
    "ET": MatchStatus.LIVE,
    "BT": MatchStatus.LIVE,
    "P": MatchStatus.LIVE,
    "LIVE": MatchStatus.LIVE,
    "INT": MatchStatus.LIVE,
    "SUSP": MatchStatus.LIVE,
    "FT": MatchStatus.FINISHED,
    "AET": MatchStatus.FINISHED,
    "PEN": MatchStatus.FINISHED,
}

_TBD_NAME = "TBD"


def _team(payload: dict[str, Any]) -> Team:
    name = (payload.get("name") or "").strip()
    return Team(name=name or _TBD_NAME, code=None, crest=payload.get("logo"))


def _matchday(round_label: str | None) -> int | None:
    if not round_label:
        return None
    tail = round_label.rsplit("-", 1)[-1].strip()
    return int(tail) if tail.isdigit() else None


def _parse_fixtures(payload: dict[str, Any], competition: str) -> SourceResult:
    fixtures: list[Fixture] = []
    results: list[Result] = []
    comp_name = competition

    for entry in payload.get("response", []):
        try:
            fixture_payload = entry.get("fixture") or {}
            league = entry.get("league") or {}
            teams = entry.get("teams") or {}
            goals = entry.get("goals") or {}
            if league.get("name"):
                comp_name = league["name"]
            comp = Competition(code=competition, name=comp_name)
            home_payload = teams.get("home")
            away_payload = teams.get("away")
            if not home_payload or not away_payload:
                continue
            status = _STATUS_MAP.get(
                (fixture_payload.get("status") or {}).get("short", ""),
                MatchStatus.SCHEDULED,
            )
            common = {
                "id": str(fixture_payload["id"]),
                "competition": comp,
                "kickoff": fixture_payload["date"],
                "home": _team(home_payload),
                "away": _team(away_payload),
                "matchday": _matchday(league.get("round")),
            }
            fixtures.append(Fixture(status=status, **common))
            if status == MatchStatus.FINISHED:
                home_score = goals.get("home")
                away_score = goals.get("away")
                if home_score is None or away_score is None:
                    continue
                results.append(
                    Result(
                        home_score=int(home_score),
                        away_score=int(away_score),
                        **common,
                    )
                )
        except (KeyError, TypeError, ValueError):
            continue

    return SourceResult(ok=True, fixtures=fixtures, results=results)


def _parse_standings(payload: dict[str, Any], competition: str) -> StandingsResult:
    standings: list[Standing] = []
    response = payload.get("response") or []
    league = (response[0].get("league") or {}) if response else {}
    comp = Competition(code=competition, name=league.get("name") or competition)
    tables = league.get("standings") or []
    rows = tables[0] if tables else []

    for row in rows:
        try:
            record = row.get("all") or {}
            goals = record.get("goals") or {}
            standings.append(
                Standing(
                    competition=comp,
                    group=row.get("group"),
                    position=int(row["rank"]),
                    team=_team(row.get("team") or {}),
                    played=int(record["played"]),
                    won=int(record["win"]),
                    draw=int(record["draw"]),
                    lost=int(record["lose"]),
                    points=int(row["points"]),
                    goals_for=int(goals["for"]),
                    goals_against=int(goals["against"]),
                )
            )
        except (KeyError, TypeError, ValueError):
            continue

    return StandingsResult(ok=True, standings=standings)


class APIFootballClient:
    """`MatchSource` + `StandingsSource` backed by api-football.com v3."""

    def __init__(
        self,
        key: str | None = None,
        *,
        base_url: str = "https://v3.football.api-sports.io",
        client: httpx.Client | None = None,
        timeout: float = 10.0,
        now_fn: Callable[[], datetime] | None = None,
    ) -> None:
        self.key = key if key is not None else os.environ.get("API_FOOTBALL_KEY")
        self.base_url = base_url
        self._client = client or httpx.Client(timeout=timeout)
        self._now_fn = now_fn or (lambda: datetime.now(UTC))

    def _season(self) -> int:
        now = self._now_fn()
        return now.year if now.month >= 7 else now.year - 1

    def _precheck(self, competition: str) -> str | None:
        if not self.key:
            return "api-football key missing: set the API_FOOTBALL_KEY environment variable"
        if competition not in _LEAGUE_MAP:
            return (
                f"api-football source has no mapping for competition '{competition}'"
            )
        return None

    def _get(self, path: str, params: dict[str, Any]) -> dict[str, Any]:
        response = self._client.get(
            f"{self.base_url}{path}",
            params=params,
            headers={"x-apisports-key": self.key},
        )
        response.raise_for_status()
        return response.json()

    def fetch_matches(self, competition: str = "PL") -> SourceResult:
        error = self._precheck(competition)
        if error:
            return SourceResult(ok=False, fixtures=[], results=[], error=error)
        try:
            payload = self._get(
                "/fixtures",
                {"league": _LEAGUE_MAP[competition], "season": self._season()},
            )
        except httpx.HTTPError as exc:
            return SourceResult(
                ok=False, fixtures=[], results=[], error=str(exc)
            )
        except ValueError as exc:
            return SourceResult(
                ok=False, fixtures=[], results=[], error=f"invalid JSON: {exc}"
            )

        try:
            return _parse_fixtures(payload, competition)
        except (KeyError, TypeError, ValueError) as exc:
            return SourceResult(
                ok=False, fixtures=[], results=[], error=f"unexpected payload: {exc}"
            )

    def fetch_standings(self, competition: str = "PL") -> StandingsResult:
        error = self._precheck(competition)
        if error:
            return StandingsResult(ok=False, standings=[], error=error)
        try:
            payload = self._get(
                "/standings",
                {"league": _LEAGUE_MAP[competition], "season": self._season()},
            )
        except httpx.HTTPError as exc:
            return StandingsResult(ok=False, standings=[], error=str(exc))
        except ValueError as exc:
            return StandingsResult(
                ok=False, standings=[], error=f"invalid JSON: {exc}"
            )

        try:
            return _parse_standings(payload, competition)
        except (KeyError, TypeError, ValueError) as exc:
            return StandingsResult(
                ok=False, standings=[], error=f"unexpected payload: {exc}"
            )
