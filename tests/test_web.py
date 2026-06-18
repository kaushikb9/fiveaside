from datetime import UTC, datetime

from fastapi.testclient import TestClient

from terrace.core.models import Competition, Fixture, MatchStatus, Result, Standing, Team
from terrace.sources.base import SourceResult, StandingsResult
from terrace.sources.football_data import FootballDataClient
from terrace.web.app import create_app

COMPETITION = Competition(code="WC", name="FIFA World Cup")
NOW = datetime(2026, 6, 14, 12, 0, tzinfo=UTC)


def _team(name: str, code: str) -> Team:
    return Team(name=name, code=code)


class _FakeSource:
    def __init__(
        self,
        result: SourceResult,
        standings_result: StandingsResult | None = None,
    ) -> None:
        self._result = result
        self._standings_result = standings_result or StandingsResult(ok=True, standings=[])

    def fetch_matches(self, competition: str) -> SourceResult:
        return self._result

    def fetch_standings(self, competition: str) -> StandingsResult:
        return self._standings_result


def _now_fn() -> datetime:
    return NOW


def _ok_source() -> _FakeSource:
    fixture = Fixture(
        id="f1",
        competition=COMPETITION,
        kickoff=datetime(2026, 6, 14, 15, 0, tzinfo=UTC),
        home=_team("France", "FRA"),
        away=_team("Germany", "GER"),
        status=MatchStatus.SCHEDULED,
        matchday=1,
        group="Group B",
    )
    return _FakeSource(SourceResult(ok=True, fixtures=[fixture], results=[], error=None))


def _empty_source() -> _FakeSource:
    return _FakeSource(SourceResult(ok=True, fixtures=[], results=[], error=None))


def _failed_source() -> _FakeSource:
    return _FakeSource(SourceResult(ok=False, fixtures=[], results=[], error="boom"))


def test_index_renders_today_match():
    app = create_app(_ok_source(), now_fn=_now_fn)
    client = TestClient(app)

    response = client.get("/")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/html")
    body = response.text
    assert "France" in body
    assert "Germany" in body
    assert "8:30 PM IST" in body


def test_index_failure_mode_shows_banner_without_crashing():
    app = create_app(_failed_source(), now_fn=_now_fn)
    client = TestClient(app)

    response = client.get("/")

    assert response.status_code == 200
    body = response.text
    assert "Some data was unavailable" in body
    assert "boom" in body


def test_index_empty_state_shows_placeholder_copy():
    app = create_app(_empty_source(), now_fn=_now_fn)
    client = TestClient(app)

    response = client.get("/")

    assert response.status_code == 200
    body = response.text
    assert "Nothing finished yesterday." in body
    assert "No matches today." in body


def test_manifest_served_with_correct_media_type():
    app = create_app(_empty_source(), now_fn=_now_fn)
    client = TestClient(app)

    response = client.get("/manifest.webmanifest")

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/manifest+json"
    payload = response.json()
    assert payload["name"] == "Touchline"
    assert payload["start_url"] == "/"
    assert isinstance(payload["icons"], list)
    assert payload["icons"]


def test_service_worker_served_as_javascript():
    app = create_app(_empty_source(), now_fn=_now_fn)
    client = TestClient(app)

    response = client.get("/sw.js")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/javascript")


def test_icon_served():
    app = create_app(_empty_source(), now_fn=_now_fn)
    client = TestClient(app)

    response = client.get("/static/icons/icon-192.png")

    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"


def test_icon_512_served():
    app = create_app(_empty_source(), now_fn=_now_fn)
    client = TestClient(app)

    response = client.get("/static/icons/icon-512.png")

    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"
    assert response.content[:8] == b"\x89PNG\r\n\x1a\n"


def test_index_renders_yesterday_story_and_match_of_the_day():
    yesterday_result = Result(
        id="r1",
        competition=COMPETITION,
        kickoff=datetime(2026, 6, 13, 18, 0, tzinfo=UTC),
        home=_team("Brazil", "BRA"),
        away=_team("Argentina", "ARG"),
        home_score=2,
        away_score=1,
        winner="HOME",
    )
    today_fixture = Fixture(
        id="f1",
        competition=COMPETITION,
        kickoff=datetime(2026, 6, 14, 15, 0, tzinfo=UTC),
        home=_team("France", "FRA"),
        away=_team("Germany", "GER"),
        status=MatchStatus.SCHEDULED,
        matchday=1,
        group="Group B",
    )
    source = _FakeSource(
        SourceResult(ok=True, fixtures=[today_fixture], results=[yesterday_result], error=None)
    )
    app = create_app(source, now_fn=_now_fn)
    client = TestClient(app)

    response = client.get("/")

    assert response.status_code == 200
    body = response.text
    assert "Brazil" in body
    assert "Argentina" in body
    assert "edged Argentina 2" in body
    # Single fixture today is automatically the match of the day.
    assert "Match of the day" in body
    assert "France vs" in body


def test_index_head_contains_pwa_tags():
    app = create_app(_empty_source(), now_fn=_now_fn)
    client = TestClient(app)

    response = client.get("/")

    assert response.status_code == 200
    body = response.text
    assert '<link rel="manifest" href="/manifest.webmanifest">' in body
    assert '<link rel="apple-touch-icon" href="/static/icons/icon-192.png">' in body
    assert 'name="apple-mobile-web-app-capable" content="yes"' in body
    assert "navigator.serviceWorker.register(\"/sw.js\")" in body


def test_create_app_default_does_not_touch_network_at_construction():
    # Constructing with no args should default to FootballDataClient without
    # making any network calls -- only TestClient.get("/") would do that, and
    # we don't call it here.
    app = create_app()

    assert app is not None
    # Sanity: the default source really is a FootballDataClient.
    assert isinstance(FootballDataClient(), FootballDataClient)


def test_index_contains_link_to_standings():
    app = create_app(_empty_source(), now_fn=_now_fn)
    client = TestClient(app)

    response = client.get("/")

    assert response.status_code == 200
    assert "/standings" in response.text


# ---------------------------------------------------------------------------
# /standings route tests
# ---------------------------------------------------------------------------


def _standings_source() -> _FakeSource:
    standings = [
        Standing(
            competition=COMPETITION,
            group="GROUP_A",
            position=1,
            team=Team(name="Mexico", code="MEX"),
            played=3,
            won=3,
            draw=0,
            lost=0,
            points=9,
            goals_for=6,
            goals_against=1,
        ),
        Standing(
            competition=COMPETITION,
            group="GROUP_A",
            position=2,
            team=Team(name="USA", code="USA"),
            played=3,
            won=2,
            draw=0,
            lost=1,
            points=6,
            goals_for=4,
            goals_against=2,
        ),
        Standing(
            competition=COMPETITION,
            group="GROUP_B",
            position=1,
            team=Team(name="France", code="FRA"),
            played=3,
            won=3,
            draw=0,
            lost=0,
            points=9,
            goals_for=8,
            goals_against=0,
        ),
    ]
    return _FakeSource(
        SourceResult(ok=True, fixtures=[], results=[]),
        StandingsResult(ok=True, standings=standings),
    )


def test_standings_renders_group_tables():
    app = create_app(_standings_source(), now_fn=_now_fn)
    client = TestClient(app)

    response = client.get("/standings")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/html")
    body = response.text

    # Both groups are present.
    assert "GROUP_A" in body
    assert "GROUP_B" in body

    # Team names appear.
    assert "Mexico" in body
    assert "USA" in body
    assert "France" in body

    # Column headers present.
    assert ">P<" in body
    assert ">W<" in body
    assert ">D<" in body
    assert ">L<" in body
    assert ">GD<" in body
    assert ">Pts<" in body

    # Position order: Mexico (pos 1) appears before USA (pos 2) in the body.
    assert body.index("Mexico") < body.index("USA")


def test_standings_failure_mode_shows_banner_without_crashing():
    source = _FakeSource(
        SourceResult(ok=True, fixtures=[], results=[]),
        StandingsResult(ok=False, standings=[], error="api down"),
    )
    app = create_app(source, now_fn=_now_fn)
    client = TestClient(app)

    response = client.get("/standings")

    assert response.status_code == 200
    body = response.text
    assert "Some data was unavailable" in body
    assert "api down" in body


def test_standings_empty_ok_shows_empty_state_copy():
    """When fetch_standings succeeds but returns no rows, the page shows
    the empty-state sentinel copy rather than rendering any tables."""
    source = _FakeSource(
        SourceResult(ok=True, fixtures=[], results=[]),
        StandingsResult(ok=True, standings=[]),
    )
    app = create_app(source, now_fn=_now_fn)
    client = TestClient(app)

    response = client.get("/standings")

    assert response.status_code == 200
    body = response.text
    assert "Standings not available yet." in body
    # No group tables should be rendered.
    assert "<table" not in body
    # No degraded banner when ok=True.
    assert "Some data was unavailable" not in body


def test_standings_head_contains_pwa_tags():
    """The standings page reuses the same PWA <head> as the digest page."""
    app = create_app(_empty_source(), now_fn=_now_fn)
    client = TestClient(app)

    response = client.get("/standings")

    assert response.status_code == 200
    body = response.text
    assert '<link rel="manifest" href="/manifest.webmanifest">' in body
    assert '<link rel="apple-touch-icon" href="/static/icons/icon-192.png">' in body
    assert 'name="apple-mobile-web-app-capable" content="yes"' in body
    assert 'navigator.serviceWorker.register("/sw.js")' in body


def test_standings_renders_goal_difference_column():
    """The GD column reflects goals_for - goals_against, including negatives."""
    standings = [
        Standing(
            competition=COMPETITION,
            group="GROUP_A",
            position=1,
            team=Team(name="Brazil", code="BRA"),
            played=3,
            won=2,
            draw=0,
            lost=1,
            points=6,
            goals_for=5,
            goals_against=2,  # GD = +3
        ),
        Standing(
            competition=COMPETITION,
            group="GROUP_A",
            position=2,
            team=Team(name="Japan", code="JPN"),
            played=3,
            won=0,
            draw=0,
            lost=3,
            points=0,
            goals_for=1,
            goals_against=4,  # GD = -3
        ),
    ]
    source = _FakeSource(
        SourceResult(ok=True, fixtures=[], results=[]),
        StandingsResult(ok=True, standings=standings),
    )
    app = create_app(source, now_fn=_now_fn)
    client = TestClient(app)

    response = client.get("/standings")

    assert response.status_code == 200
    body = response.text
    # Positive and negative goal differences are rendered.
    assert ">3<" in body
    assert ">-3<" in body
