from datetime import UTC, datetime

from touchline.core.models import Competition, Fixture, MatchStatus, Result, Standing, Team
from touchline.sources.base import (
    MatchSource,
    SourceResult,
    StandingsResult,
    StandingsSource,
)
from touchline.sources.layered import LayeredSource, _norm

FR = Competition(code="FRIENDLIES", name="Club Friendlies")


def _fixture(id, home, away, kickoff, status=MatchStatus.SCHEDULED):
    return Fixture(
        id=id, competition=FR, kickoff=kickoff,
        home=Team(name=home), away=Team(name=away), status=status,
    )


def _result(id, home, away, kickoff, score=(1, 0)):
    return Result(
        id=id, competition=FR, kickoff=kickoff,
        home=Team(name=home), away=Team(name=away),
        home_score=score[0], away_score=score[1],
    )


class StubSource:
    def __init__(self, matches=None, standings=None):
        self._matches = matches or SourceResult(ok=True, fixtures=[], results=[])
        self._standings = standings or StandingsResult(ok=True, standings=[])
        self.requested: list[str] = []

    def fetch_matches(self, competition):
        self.requested.append(competition)
        return self._matches

    def fetch_standings(self, competition):
        return self._standings


def test_conforms_to_protocols():
    layered = LayeredSource(StubSource(), StubSource())
    assert isinstance(layered, MatchSource)
    assert isinstance(layered, StandingsSource)


def test_overlay_fills_matches_missing_from_primary():
    juventus = _fixture("espn-1", "Chelsea", "Juventus", datetime(2026, 8, 5, 16, 0, tzinfo=UTC))
    sydney = _result(
        "tsdb-1", "Chelsea", "Western Sydney Wanderers",
        datetime(2026, 7, 28, 9, 45, tzinfo=UTC), score=(6, 4),
    )
    sydney_fixture = _fixture(
        "tsdb-1", "Chelsea", "Western Sydney Wanderers",
        datetime(2026, 7, 28, 9, 45, tzinfo=UTC), status=MatchStatus.FINISHED,
    )
    primary = StubSource(SourceResult(ok=True, fixtures=[juventus], results=[]))
    overlay = StubSource(SourceResult(ok=True, fixtures=[sydney_fixture], results=[sydney]))

    res = LayeredSource(primary, overlay).fetch_matches("FRIENDLIES")
    assert res.ok
    # merged and sorted by kickoff: the overlay-only Sydney game lands first
    assert [f.id for f in res.fixtures] == ["tsdb-1", "espn-1"]
    assert [r.id for r in res.results] == ["tsdb-1"]
    assert primary.requested == overlay.requested == ["FRIENDLIES"]


def test_primary_wins_when_both_sources_carry_the_same_match():
    kickoff_espn = datetime(2026, 8, 5, 16, 0, tzinfo=UTC)
    kickoff_tsdb = datetime(2026, 8, 5, 17, 30, tzinfo=UTC)  # sources disagree on time
    espn_copy = _fixture("espn-1", "Chelsea", "Juventus", kickoff_espn)
    tsdb_copy = _fixture("tsdb-9", "Juventus", "Chelsea", kickoff_tsdb)
    primary = StubSource(SourceResult(ok=True, fixtures=[espn_copy], results=[]))
    overlay = StubSource(SourceResult(ok=True, fixtures=[tsdb_copy], results=[]))

    res = LayeredSource(primary, overlay).fetch_matches("FRIENDLIES")
    # same UTC day + same pair (home/away flipped) dedupes; primary's copy survives
    assert [f.id for f in res.fixtures] == ["espn-1"]


def test_name_normalization_bridges_source_spellings():
    assert _norm("AFC Bournemouth") == _norm("Bournemouth")
    assert _norm("Chelsea FC") == _norm("Chelsea")
    assert _norm("FC") == "fc"  # degenerate all-token name keeps its tokens


def test_failed_primary_still_serves_overlay_data():
    kickoff = datetime(2026, 7, 28, 9, 45, tzinfo=UTC)
    sydney = _fixture("tsdb-1", "Chelsea", "Western Sydney Wanderers", kickoff)
    primary = StubSource(SourceResult(ok=False, fixtures=[], results=[], error="espn down"))
    overlay = StubSource(SourceResult(ok=True, fixtures=[sydney], results=[]))

    res = LayeredSource(primary, overlay).fetch_matches("FRIENDLIES")
    assert res.ok
    assert [f.id for f in res.fixtures] == ["tsdb-1"]
    assert "espn down" in res.error


def test_both_failing_degrades_with_combined_error():
    primary = StubSource(SourceResult(ok=False, fixtures=[], results=[], error="espn down"))
    overlay = StubSource(SourceResult(ok=False, fixtures=[], results=[], error="tsdb down"))

    res = LayeredSource(primary, overlay).fetch_matches("FRIENDLIES")
    assert not res.ok
    assert "espn down" in res.error and "tsdb down" in res.error


def test_standings_come_from_primary_only():
    row = Standing(
        competition=Competition(code="PL", name="Premier League"),
        position=1, team=Team(name="Arsenal"),
        played=1, won=1, draw=0, lost=0, points=3, goals_for=2, goals_against=0,
    )
    primary = StubSource(standings=StandingsResult(ok=True, standings=[row]))
    res = LayeredSource(primary, StubSource()).fetch_standings("PL")
    assert res.ok
    assert [s.team.name for s in res.standings] == ["Arsenal"]
