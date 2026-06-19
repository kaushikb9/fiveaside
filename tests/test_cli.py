import subprocess
import sys
from datetime import UTC, datetime

from touchline.cli import main, run_digest
from touchline.core.models import Competition, Fixture, MatchStatus, NewsItem, Team
from touchline.sources.base import NewsResult, SourceResult

COMPETITION = Competition(code="WC", name="FIFA World Cup")


def _team(name: str, code: str) -> Team:
    return Team(name=name, code=code)


class _FakeSource:
    def __init__(self, result: SourceResult) -> None:
        self._result = result

    def fetch_matches(self, competition: str) -> SourceResult:
        return self._result


class _FakeNewsSource:
    """Fake NewsSource that returns a fixed NewsResult without hitting the network."""

    def __init__(self, result: NewsResult) -> None:
        self._result = result

    def fetch_news(self) -> NewsResult:
        return self._result


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


def _failed_source() -> _FakeSource:
    return _FakeSource(SourceResult(ok=False, fixtures=[], results=[], error="boom"))


NOW = datetime(2026, 6, 14, 12, 0, tzinfo=UTC)


def test_run_digest_ok_contains_header():
    out = run_digest(_ok_source(), now=NOW)
    assert "# Touchline" in out


def test_run_digest_failure_mode_does_not_crash():
    out = run_digest(_failed_source(), now=NOW)
    assert "# Touchline" in out
    assert "data was unavailable" in out
    assert "boom" in out


def test_cli_help_exits_zero():
    result = subprocess.run(
        [sys.executable, "-m", "touchline.cli", "digest", "--help"],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0
    assert "digest" in result.stdout


def test_main_with_no_command_prints_help_and_returns_2():
    assert main([]) == 2


# -- news_source wiring -------------------------------------------------------


def test_run_digest_news_source_none_produces_no_news_warning():
    """Default None news_source must not emit any news warning line."""
    out = run_digest(_ok_source(), now=NOW, news_source=None)
    assert "news was unavailable" not in out


def test_run_digest_with_ok_news_source_includes_headlines():
    """A successful news source whose headline mentions a fixture team appears in output."""
    # France vs Germany kicks off today (NOW=2026-06-14 12 UTC, fixture at 15 UTC)
    item = NewsItem(
        title="France vs Germany: preview",
        link="https://example.com/fra-ger",
        source="Sky Sports",
    )
    news_source = _FakeNewsSource(NewsResult(ok=True, items=[item]))

    out = run_digest(_ok_source(), now=NOW, news_source=news_source)

    assert "In the news" in out
    assert "[France vs Germany: preview](https://example.com/fra-ger)" in out
    assert "Sky Sports" in out


def test_run_digest_with_ok_news_source_no_matching_headlines_omits_in_the_news():
    """When no headline is relevant to today's fixtures, 'In the news' must NOT appear."""
    # The fixture is France vs Germany; this item mentions neither.
    item = NewsItem(
        title="Cricket: India beat Pakistan by 50 runs",
        link="https://example.com/cricket",
        source="ESPN",
    )
    news_source = _FakeNewsSource(NewsResult(ok=True, items=[item]))

    out = run_digest(_ok_source(), now=NOW, news_source=news_source)

    assert "In the news" not in out


def test_run_digest_failed_news_source_degrades_gracefully():
    """When news fetch returns ok=False, the digest still renders and appends a warning."""
    news_source = _FakeNewsSource(
        NewsResult(ok=False, items=[], error="RSS feed timed out")
    )

    out = run_digest(_ok_source(), now=NOW, news_source=news_source)

    # Digest still renders normally
    assert "# Touchline" in out
    # Warning line is appended
    assert "news was unavailable" in out
    assert "RSS feed timed out" in out
    # The match-source warning must NOT appear (match source was ok)
    assert "data was unavailable" not in out


def test_run_digest_failed_news_source_does_not_add_in_the_news():
    """A failed news fetch (items=[]) must produce no 'In the news' block."""
    news_source = _FakeNewsSource(
        NewsResult(ok=False, items=[], error="network error")
    )

    out = run_digest(_ok_source(), now=NOW, news_source=news_source)

    assert "In the news" not in out
