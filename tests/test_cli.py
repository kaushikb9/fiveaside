import subprocess
import sys
from datetime import UTC, datetime

from terrace.cli import main, run_digest
from terrace.core.models import Competition, Fixture, MatchStatus, Team
from terrace.sources.base import SourceResult

COMPETITION = Competition(code="WC", name="FIFA World Cup")


def _team(name: str, code: str) -> Team:
    return Team(name=name, code=code)


class _FakeSource:
    def __init__(self, result: SourceResult) -> None:
        self._result = result

    def fetch_matches(self, competition: str) -> SourceResult:
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
        [sys.executable, "-m", "terrace.cli", "digest", "--help"],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0
    assert "digest" in result.stdout


def test_main_with_no_command_prints_help_and_returns_2():
    assert main([]) == 2
