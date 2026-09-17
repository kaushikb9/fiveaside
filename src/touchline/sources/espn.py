"""ESPN unofficial API client: matches + standings behind the source protocols."""

from collections.abc import Callable
from datetime import UTC, date, datetime, timedelta
from typing import Any

import httpx

from touchline.core.models import Competition, Fixture, MatchStatus, Result, Standing, Team
from touchline.sources.base import LineupResult, SourceResult, StandingsResult

# A Premier League club's season is not one competition. Following a club means
# following it into the cups and into Europe, so every competition a PL side can
# actually be playing in on a given midweek has a slug here.
#
# Slugs verified against the live API on 2026-08-27, which is the only way to
# get them right: uefa.europa.conf is a DOT, not the underscore the others
# would lead you to guess, and uefa.europa_conf answers HTTP 400.
#
# A slug returning zero events is not a broken slug. On 2026-08-27 ESPN had
# 2026-27 loaded for eng.1 (380 fixtures) and eng.league_cup (76) but was still
# serving 2025-26 for the FA Cup and all three UEFA competitions, because those
# calendars are not published yet. Those competitions start appearing on their
# own; nothing here needs changing when they do.
_LEAGUE_MAP = {
    "PL": "eng.1",
    "CL": "uefa.champions",
    "EL": "uefa.europa",
    "UECL": "uefa.europa.conf",
    "FA": "eng.fa",
    "EFL": "eng.league_cup",
    "FRIENDLIES": "club.friendly",
}

_LIVE_STATUSES = {
    "STATUS_IN_PLAY",
    "STATUS_HALFTIME",
    "STATUS_FIRST_HALF",
    "STATUS_SECOND_HALF",
}

PAST_DAYS = 120
FUTURE_DAYS = 45

_TBD_NAME = "TBD"


def _months_covering(start: date, end: date) -> list[str]:
    """Every YYYYMM from start's month to end's month, inclusive."""
    out: list[str] = []
    year, month = start.year, start.month
    while (year, month) <= (end.year, end.month):
        out.append(f"{year:04d}{month:02d}")
        year, month = (year + 1, 1) if month == 12 else (year, month + 1)
    return out


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
        start = today - timedelta(days=PAST_DAYS)
        end = today + timedelta(days=FUTURE_DAYS)
        url = f"{self.base_url}/site/v2/sports/soccer/{league}/scoreboard"
        # ESPN stopped answering a date RANGE (dates=YYYYMMDD-YYYYMMDD) on or
        # before 2026-09-17 — every such call is a 400 — so the window is fetched
        # one month at a time and trimmed here. Same fix as monthsCovering() in
        # functions/api/matches.js, the other parser of this feed.
        payload: dict[str, Any] = {"leagues": [], "events": []}
        seen: set[str] = set()
        for month in _months_covering(start, end):
            try:
                response = self._client.get(url, params={"dates": month, "limit": 400})
                response.raise_for_status()
                page = response.json()
            except httpx.HTTPError as exc:
                return SourceResult(ok=False, fixtures=[], results=[], error=str(exc))
            except ValueError as exc:
                return SourceResult(
                    ok=False, fixtures=[], results=[], error=f"invalid JSON: {exc}"
                )
            if not payload["leagues"] and isinstance(page, dict):
                payload["leagues"] = page.get("leagues") or []
            for event in (page.get("events") or []) if isinstance(page, dict) else []:
                day = str(event.get("date", ""))[:10]
                if not (start.isoformat() <= day <= end.isoformat()):
                    continue
                key = str(event.get("id"))
                if key in seen:
                    continue
                seen.add(key)
                payload["events"].append(event)

        try:
            return _parse_scoreboard(payload, competition)
        except (KeyError, TypeError, ValueError) as exc:
            error = f"unexpected payload: {exc}"
            return SourceResult(ok=False, fixtures=[], results=[], error=error)

    def fetch_lineups(self, competition: str, event_id: str) -> LineupResult:
        """Who actually played in one match, per club.

        ESPN's scoreboard says a match happened; only the summary endpoint says
        who was on the pitch. One request per match, which is why callers must
        filter to matches that matter before asking.

        There is no minutes field anywhere in this payload — `starter`,
        `subIns` and `appearances` are the whole vocabulary. That is enough for
        the question being asked (did he play midweek) and not enough for the
        one it looks like it answers (how tired is he), so nothing downstream
        should claim minutes.
        """
        league = self._league(competition)
        if league is None:
            return LineupResult(ok=False, teams=[], error=f"no mapping for '{competition}'")

        url = f"{self.base_url}/site/v2/sports/soccer/{league}/summary"
        try:
            response = self._client.get(url, params={"event": event_id})
            response.raise_for_status()
            payload = response.json()
        except httpx.HTTPError as exc:
            return LineupResult(ok=False, teams=[], error=str(exc))
        except ValueError as exc:
            return LineupResult(ok=False, teams=[], error=f"invalid JSON: {exc}")

        teams: list[dict] = []
        for entry in payload.get("rosters") or []:
            club = ((entry.get("team") or {}).get("displayName") or "").strip()
            if not club:
                continue
            players = []
            for row in entry.get("roster") or []:
                athlete = row.get("athlete") or {}
                name = (athlete.get("displayName") or athlete.get("fullName") or "").strip()
                if not name:
                    continue
                stats = {st.get("name"): st.get("value") for st in (row.get("stats") or [])}
                started = bool(row.get("starter"))
                came_on = bool(stats.get("subIns"))
                if not started and not came_on:
                    continue  # an unused substitute did not play
                players.append({"name": name, "started": started})
            teams.append({"club": club, "players": players})

        return LineupResult(ok=True, teams=teams)

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
