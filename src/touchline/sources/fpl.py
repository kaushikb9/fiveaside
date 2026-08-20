"""Official FPL API client: bootstrap + fixtures for the fantasy facts bundle.

Keyless and unofficial-but-stable (https://fantasy.premierleague.com/api).
Not a MatchSource — fantasy data has its own shapes, so it gets its own
result containers with the same ok/error degradation contract.
"""

from typing import Any

import httpx
from pydantic import BaseModel, ValidationError


class FPLEvent(BaseModel, frozen=True):
    id: int
    name: str = ""
    deadline_time: str  # ISO-8601 UTC, e.g. "2026-08-21T17:30:00Z"
    finished: bool = False
    is_next: bool = False


class FPLTeam(BaseModel, frozen=True):
    id: int
    name: str
    short_name: str


class FPLElement(BaseModel, frozen=True):
    id: int
    web_name: str
    team: int  # FPLTeam.id
    element_type: int  # 1 GK, 2 DEF, 3 MID, 4 FWD
    now_cost: int  # tenths of £m (75 = £7.5m)
    selected_by_percent: str  # "69.3"
    status: str  # a=available, d=doubtful, i=injured, s=suspended, u=unavailable, n=not in squad
    news: str = ""
    chance_of_playing_next_round: int | None = None
    form: str = ""
    total_points: int = 0


class FPLFixture(BaseModel, frozen=True):
    event: int | None = None  # gameweek id; None while unscheduled
    team_h: int
    team_a: int
    team_h_difficulty: int
    team_a_difficulty: int


class FPLBootstrapResult(BaseModel, frozen=True):
    """Result of a bootstrap-static fetch, carrying graceful degradation to callers.

    On success: `ok=True`, populated lists, `error=None`.
    On failure: `ok=False`, empty lists, and a short human-readable `error`.
    """

    ok: bool
    events: list[FPLEvent]
    teams: list[FPLTeam]
    elements: list[FPLElement]
    error: str | None = None


class FPLFixturesResult(BaseModel, frozen=True):
    """Result of a whole-season fixtures fetch, same degradation contract."""

    ok: bool
    fixtures: list[FPLFixture]
    error: str | None = None


def _parse_items(model: type[BaseModel], items: list[Any]) -> list[Any]:
    """Validate each payload item, skipping corrupt entries rather than failing the fetch."""
    parsed = []
    for item in items:
        try:
            parsed.append(model.model_validate(item))
        except ValidationError:
            continue
    return parsed


class FPLClient:
    """Client for the two public FPL endpoints the fantasy bundle needs."""

    def __init__(
        self,
        *,
        base_url: str = "https://fantasy.premierleague.com/api",
        client: httpx.Client | None = None,
        timeout: float = 15.0,
    ) -> None:
        self.base_url = base_url
        self._client = client or httpx.Client(timeout=timeout)

    def _get_json(self, path: str) -> tuple[Any, str | None]:
        try:
            response = self._client.get(f"{self.base_url}{path}")
            response.raise_for_status()
            return response.json(), None
        except httpx.HTTPError as exc:
            return None, str(exc)
        except ValueError as exc:
            return None, f"invalid JSON: {exc}"

    def fetch_bootstrap(self) -> FPLBootstrapResult:
        payload, error = self._get_json("/bootstrap-static/")
        if error is not None:
            return FPLBootstrapResult(ok=False, events=[], teams=[], elements=[], error=error)
        if not isinstance(payload, dict):
            error = "unexpected payload: not an object"
            return FPLBootstrapResult(ok=False, events=[], teams=[], elements=[], error=error)
        return FPLBootstrapResult(
            ok=True,
            events=_parse_items(FPLEvent, payload.get("events") or []),
            teams=_parse_items(FPLTeam, payload.get("teams") or []),
            elements=_parse_items(FPLElement, payload.get("elements") or []),
        )

    def fetch_fixtures(self) -> FPLFixturesResult:
        payload, error = self._get_json("/fixtures/")
        if error is not None:
            return FPLFixturesResult(ok=False, fixtures=[], error=error)
        if not isinstance(payload, list):
            return FPLFixturesResult(ok=False, fixtures=[], error="unexpected payload: not a list")
        return FPLFixturesResult(ok=True, fixtures=_parse_items(FPLFixture, payload))
