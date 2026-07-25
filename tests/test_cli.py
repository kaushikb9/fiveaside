import json
from datetime import UTC, datetime

from touchline.cli import main, run_facts
from touchline.config import ClubConfig, TouchlineConfig
from touchline.core.models import Competition, Fixture, MatchStatus, Team
from touchline.sources.base import SourceResult, StandingsResult

PL = Competition(code="PL", name="Premier League")
CONFIG = TouchlineConfig(
    club=ClubConfig(name="Chelsea", code="CHE"),
    competitions=["PL", "CL"],
    timezone="Asia/Kolkata",
)
NOW = datetime(2026, 8, 16, 3, 30, tzinfo=UTC)


class FakeSource:
    def __init__(self):
        self.requested: list[str] = []

    def fetch_matches(self, competition: str) -> SourceResult:
        self.requested.append(competition)
        fixture = Fixture(
            id="f1", competition=PL, kickoff=datetime(2026, 8, 16, 14, 0, tzinfo=UTC),
            home=Team(name="Chelsea", code="CHE"), away=Team(name="Arsenal", code="ARS"),
            status=MatchStatus.SCHEDULED,
        )
        return SourceResult(ok=True, fixtures=[fixture], results=[])

    def fetch_standings(self, competition: str) -> StandingsResult:
        return StandingsResult(ok=True, standings=[])


def test_run_facts_returns_json_bundle_for_each_competition():
    source = FakeSource()
    out = run_facts(source, CONFIG, now=NOW)
    bundle = json.loads(out)
    assert source.requested == ["PL", "CL"]
    assert bundle["date"] == "2026-08-16"
    assert [c["code"] for c in bundle["competitions"]] == ["PL", "CL"]
    assert bundle["competitions"][0]["today_matches"][0]["club_involved"] is True


def test_main_without_command_prints_help_and_exits_2(capsys):
    assert main([]) == 2
    assert "facts" in capsys.readouterr().out


def test_main_facts_uses_config_path(tmp_path, capsys, monkeypatch):
    config_path = tmp_path / "touchline.config.json"
    config_path.write_text(
        json.dumps({"club": {"name": "Chelsea", "code": "CHE"}, "competitions": ["PL"]}),
        encoding="utf-8",
    )
    import touchline.cli as cli

    monkeypatch.setattr(cli, "FootballDataClient", lambda: FakeSource())
    assert main(["facts", "--config", str(config_path)]) == 0
    bundle = json.loads(capsys.readouterr().out)
    assert bundle["club"]["code"] == "CHE"
