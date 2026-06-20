"""football-data.org v4 client: fixtures + results from the matches endpoint."""

import os
from typing import Any

import httpx
from pydantic import ValidationError

from touchline.core.models import (
    Competition,
    Fixture,
    HeadToHead,
    MatchDetail,
    MatchStatus,
    Referee,
    Result,
    Standing,
    Team,
)
from touchline.sources.base import MatchDetailResult, SourceResult, StandingsResult

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
    return Team(name=name.strip() or _TBD_NAME, code=payload.get("tla"), crest=payload.get("crest"))


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


def _parse_match_detail(match: dict[str, Any], h2h: dict[str, Any] | None) -> MatchDetail:
    comp_payload = match.get("competition") or {}
    comp = Competition(
        code=comp_payload.get("code", "WC"), name=comp_payload.get("name", "WC")
    )
    score = match.get("score") or {}
    full_time = score.get("fullTime") or {}
    half_time = score.get("halfTime") or {}

    referee: Referee | None = None
    refs = match.get("referees") or []
    main_ref = next((r for r in refs if (r.get("type") or "").upper() == "REFEREE"), None)
    main_ref = main_ref or (refs[0] if refs else None)
    if main_ref and main_ref.get("name"):
        referee = Referee(name=main_ref["name"], nationality=main_ref.get("nationality"))

    h2h_model: HeadToHead | None = None
    if h2h:
        agg = h2h.get("aggregates") or {}
        home = agg.get("homeTeam") or {}
        away = agg.get("awayTeam") or {}
        h2h_model = HeadToHead(
            total=agg.get("numberOfMatches", 0) or 0,
            home_wins=home.get("wins", 0) or 0,
            away_wins=away.get("wins", 0) or 0,
            draws=home.get("draws", 0) or 0,
        )

    return MatchDetail(
        id=str(match["id"]),
        competition=comp,
        home=_team(match.get("homeTeam") or {}),
        away=_team(match.get("awayTeam") or {}),
        kickoff=match["utcDate"],
        status=_STATUS_MAP.get(match.get("status", ""), MatchStatus.SCHEDULED),
        group=match.get("group"),
        matchday=match.get("matchday"),
        stage=match.get("stage"),
        home_score=full_time.get("home"),
        away_score=full_time.get("away"),
        ht_home=half_time.get("home"),
        ht_away=half_time.get("away"),
        winner=_WINNER_MAP.get(score.get("winner", "")),
        referee=referee,
        h2h=h2h_model,
    )


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

    def fetch_match_detail(self, match_id: str) -> MatchDetailResult:
        try:
            response = self._client.get(f"{self.base_url}/matches/{match_id}")
            response.raise_for_status()
            payload = response.json()
        except httpx.HTTPError as exc:
            return MatchDetailResult(ok=False, error=str(exc))
        except ValueError as exc:
            return MatchDetailResult(ok=False, error=f"invalid JSON: {exc}")

        match = payload.get("match", payload)  # some responses wrap the match; tolerate both

        # Head-to-head only matters for upcoming matches; fetch best-effort so a
        # failure (or rate limit) on it never sinks the page.
        h2h: dict[str, Any] | None = None
        if match.get("status", "") in ("SCHEDULED", "TIMED"):
            try:
                h2h_resp = self._client.get(
                    f"{self.base_url}/matches/{match_id}/head2head", params={"limit": 10}
                )
                h2h_resp.raise_for_status()
                h2h = h2h_resp.json()
            except (httpx.HTTPError, ValueError):
                h2h = None

        try:
            return MatchDetailResult(ok=True, detail=_parse_match_detail(match, h2h))
        except (KeyError, TypeError, ValueError) as exc:
            return MatchDetailResult(ok=False, error=f"unexpected payload: {exc}")
