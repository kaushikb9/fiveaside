import json
from datetime import UTC, datetime
from pathlib import Path

import httpx
from fastapi.testclient import TestClient

from touchline.core.models import Competition, MatchDetail, MatchStatus, Team
from touchline.sources.base import MatchDetailResult
from touchline.sources.football_data import FootballDataClient, _parse_match_detail
from touchline.web.app import create_app

FX = Path(__file__).parent / "fixtures" / "match_detail"
FINISHED = json.loads((FX / "finished.json").read_text())
SCHEDULED = json.loads((FX / "scheduled.json").read_text())
H2H = json.loads((FX / "h2h.json").read_text())


def _client(handler) -> FootballDataClient:
    return FootballDataClient(
        token="x", client=httpx.Client(transport=httpx.MockTransport(handler))
    )


# ---- pure parsing ----

def test_parse_finished_has_scores_and_referee():
    d = _parse_match_detail(FINISHED, None)
    assert d.is_finished
    assert d.home_score == FINISHED["score"]["fullTime"]["home"]
    assert d.away_score == FINISHED["score"]["fullTime"]["away"]
    assert d.ht_home == FINISHED["score"]["halfTime"]["home"]
    assert d.winner in ("HOME", "AWAY", "DRAW")
    # referee present in the recorded fixture
    assert d.referee is not None and d.referee.name


def test_parse_scheduled_with_h2h():
    d = _parse_match_detail(SCHEDULED, H2H)
    assert not d.is_finished
    assert d.h2h is not None
    agg = H2H["aggregates"]
    assert d.h2h.total == agg["numberOfMatches"]
    assert d.h2h.home_wins == agg["homeTeam"]["wins"]
    assert d.h2h.draws == agg["homeTeam"]["draws"]


# ---- client fetch (routing two endpoints) ----

def test_fetch_match_detail_finished_one_call():
    calls = []

    def handler(req: httpx.Request) -> httpx.Response:
        calls.append(req.url.path)
        return httpx.Response(200, json=FINISHED)

    res = _client(handler).fetch_match_detail("537327")
    assert res.ok and res.detail.is_finished
    assert all("head2head" not in p for p in calls)  # no H2H for finished matches


def test_fetch_match_detail_scheduled_fetches_h2h():
    def handler(req: httpx.Request) -> httpx.Response:
        if req.url.path.endswith("/head2head"):
            return httpx.Response(200, json=H2H)
        return httpx.Response(200, json=SCHEDULED)

    res = FootballDataClient(
        token="x", client=httpx.Client(transport=httpx.MockTransport(handler))
    ).fetch_match_detail("999")
    assert res.ok and res.detail.h2h is not None and res.detail.h2h.total > 0


def test_fetch_match_detail_degrades_on_http_error():
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(429, json={"message": "rate limited"})

    res = _client(handler).fetch_match_detail("1")
    assert res.ok is False and res.detail is None and res.error


def test_h2h_failure_does_not_sink_the_page():
    def handler(req: httpx.Request) -> httpx.Response:
        if req.url.path.endswith("/head2head"):
            return httpx.Response(403, json={"message": "nope"})
        return httpx.Response(200, json=SCHEDULED)

    res = FootballDataClient(
        token="x", client=httpx.Client(transport=httpx.MockTransport(handler))
    ).fetch_match_detail("999")
    assert res.ok and res.detail is not None and res.detail.h2h is None  # best-effort H2H


# ---- web route ----

class _FakeDetailSource:
    def __init__(self, result: MatchDetailResult):
        self._r = result

    def fetch_match_detail(self, match_id: str) -> MatchDetailResult:
        return self._r


def _detail(**kw) -> MatchDetail:
    base = dict(
        id="1", competition=Competition(code="WC", name="WC"),
        home=Team(name="Brazil", code="BRA"), away=Team(name="Spain", code="ESP"),
        kickoff=datetime(2026, 6, 25, 18, 0, tzinfo=UTC),
    )
    base.update(kw)
    return MatchDetail(**base)


def test_route_renders_finished_match():
    detail = _detail(status=MatchStatus.FINISHED, home_score=2, away_score=1,
                     ht_home=1, ht_away=0, winner="HOME")
    app = create_app(source=_FakeDetailSource(MatchDetailResult(ok=True, detail=detail)),
                     now_fn=lambda: datetime(2026, 6, 26, 12, 0, tzinfo=UTC))
    body = TestClient(app).get("/match/1").text
    assert "Brazil" in body and "Spain" in body
    assert "2–1" in body
    assert "Half-time" in body


def test_route_renders_upcoming_with_countdown_and_h2h():
    from touchline.core.models import HeadToHead
    detail = _detail(h2h=HeadToHead(total=4, home_wins=2, away_wins=1, draws=1))
    app = create_app(source=_FakeDetailSource(MatchDetailResult(ok=True, detail=detail)),
                     now_fn=lambda: datetime(2026, 6, 23, 12, 0, tzinfo=UTC))
    body = TestClient(app).get("/match/1").text
    assert "Head to head" in body
    assert "in 2 days" in body  # 23rd -> 25th


def test_route_degrades_when_detail_missing():
    app = create_app(source=_FakeDetailSource(MatchDetailResult(ok=False, error="boom")))
    body = TestClient(app).get("/match/1").text
    assert "unavailable" in body and "boom" in body
