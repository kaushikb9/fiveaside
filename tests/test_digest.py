from datetime import UTC, datetime
from pathlib import Path

from terrace.core.digest import (
    MatchCard,
    build_digest,
    format_ist,
    pick_match_of_the_day,
    result_story,
    to_ist,
)
from terrace.core.models import Competition, Fixture, MatchStatus, Result, Team

COMPETITION = Competition(code="WC", name="FIFA World Cup")


def _team(name: str, code: str) -> Team:
    return Team(name=name, code=code)


def _result(id_, home, away, home_score, away_score, winner, kickoff) -> Result:
    return Result(
        id=id_,
        competition=COMPETITION,
        kickoff=kickoff,
        home=_team(*home),
        away=_team(*away),
        home_score=home_score,
        away_score=away_score,
        winner=winner,
        matchday=1,
        group="Group A",
    )


def _fixture(id_, home, away, kickoff, status=MatchStatus.SCHEDULED) -> Fixture:
    return Fixture(
        id=id_,
        competition=COMPETITION,
        kickoff=kickoff,
        home=_team(*home),
        away=_team(*away),
        status=status,
        matchday=1,
        group="Group A",
    )


# -- to_ist / format_ist -----------------------------------------------------


def test_to_ist_converts_utc_to_ist():
    dt = datetime(2026, 6, 13, 15, 0, tzinfo=UTC)
    ist = to_ist(dt)
    assert ist.hour == 20
    assert ist.minute == 30


def test_to_ist_treats_naive_as_utc():
    naive = datetime(2026, 6, 13, 15, 0)
    aware = datetime(2026, 6, 13, 15, 0, tzinfo=UTC)
    assert to_ist(naive) == to_ist(aware)


def test_format_ist_label():
    dt = datetime(2026, 6, 13, 15, 0, tzinfo=UTC)
    assert format_ist(dt) == "8:30 PM IST"


def test_format_ist_midnight_is_twelve_am():
    # 18:30 UTC -> 00:00 IST (next day)
    dt = datetime(2026, 6, 13, 18, 30, tzinfo=UTC)
    assert format_ist(dt) == "12:00 AM IST"


def test_format_ist_noon_is_twelve_pm():
    # 06:30 UTC -> 12:00 IST
    dt = datetime(2026, 6, 13, 6, 30, tzinfo=UTC)
    assert format_ist(dt) == "12:00 PM IST"


def test_format_ist_morning_no_leading_zero():
    # 03:15 UTC -> 08:45 IST
    dt = datetime(2026, 6, 13, 3, 15, tzinfo=UTC)
    assert format_ist(dt) == "8:45 AM IST"


# -- result_story -------------------------------------------------------------


def test_result_story_draw():
    r = _result(
        "1",
        ("Argentina", "ARG"),
        ("Australia", "AUS"),
        1,
        1,
        "DRAW",
        datetime(2026, 6, 12, 13, 0, tzinfo=UTC),
    )
    assert result_story(r) == "Argentina and Australia drew 1–1."


def test_result_story_edged():
    r = _result(
        "2",
        ("Mexico", "MEX"),
        ("Canada", "CAN"),
        2,
        1,
        "HOME",
        datetime(2026, 6, 12, 16, 0, tzinfo=UTC),
    )
    assert result_story(r) == "Mexico edged Canada 2–1."


def test_result_story_beat():
    r = _result(
        "3",
        ("France", "FRA"),
        ("Denmark", "DEN"),
        3,
        1,
        "HOME",
        datetime(2026, 6, 12, 16, 0, tzinfo=UTC),
    )
    assert result_story(r) == "France beat Denmark 3–1."


def test_result_story_thrashed():
    r = _result(
        "4",
        ("Brazil", "BRA"),
        ("Wales", "WAL"),
        0,
        5,
        "AWAY",
        datetime(2026, 6, 12, 16, 0, tzinfo=UTC),
    )
    # AWAY won: Wales beat Brazil 5-0, margin 5 -> thrashed
    assert result_story(r) == "Wales thrashed Brazil 5–0."


# -- pick_match_of_the_day -----------------------------------------------------


def test_pick_match_of_the_day_empty_returns_none():
    assert pick_match_of_the_day([]) is None


def _card(id_, home, away, kickoff):
    fixture = _fixture(id_, home, away, kickoff)
    return MatchCard(
        fixture=fixture,
        kickoff_ist=to_ist(kickoff),
        kickoff_label=format_ist(kickoff),
    )


def test_pick_match_of_the_day_ties_break_by_earliest_kickoff_then_id():
    # Both equally distant from 8 PM IST (one hour before, one after).
    earlier = _card(
        "2001",
        ("Spain", "ESP"),
        ("Germany", "GER"),
        datetime(2026, 6, 13, 13, 30, tzinfo=UTC),  # 7:00 PM IST
    )
    later = _card(
        "2002",
        ("Italy", "ITA"),
        ("Portugal", "POR"),
        datetime(2026, 6, 13, 15, 30, tzinfo=UTC),  # 9:00 PM IST
    )

    motd = pick_match_of_the_day([later, earlier])

    assert motd is not None
    assert motd.card.fixture.id == "2001"


def test_pick_match_of_the_day_single_card_reason_format():
    card = _card(
        "3001",
        ("Japan", "JPN"),
        ("Korea Republic", "KOR"),
        datetime(2026, 6, 13, 14, 30, tzinfo=UTC),  # 8:00 PM IST exactly
    )

    motd = pick_match_of_the_day([card])

    assert motd is not None
    assert motd.reason == "Prime-time pick: Japan vs Korea Republic at 8:00 PM IST."


# -- build_digest ---------------------------------------------------------------


def test_build_digest_splits_yesterday_and_today_and_picks_motd():
    results = [
        _result(
            "1001",
            ("Mexico", "MEX"),
            ("Canada", "CAN"),
            2,
            1,
            "HOME",
            datetime(2026, 6, 12, 16, 0, tzinfo=UTC),
        ),
        _result(
            "1002",
            ("Argentina", "ARG"),
            ("Australia", "AUS"),
            1,
            1,
            "DRAW",
            datetime(2026, 6, 12, 13, 0, tzinfo=UTC),
        ),
    ]
    fixtures = [
        _fixture(
            "1003",
            ("USA", "USA"),
            ("Wales", "WAL"),
            datetime(2026, 6, 13, 15, 0, tzinfo=UTC),
        ),
        _fixture(
            "1004",
            ("France", "FRA"),
            ("Denmark", "DEN"),
            datetime(2026, 6, 13, 18, 0, tzinfo=UTC),
        ),
    ]
    now = datetime(2026, 6, 13, 6, 0, tzinfo=UTC)  # 11:30 IST, 13 June

    digest = build_digest(fixtures, results, now=now)

    assert digest.digest_date.isoformat() == "2026-06-13"
    assert len(digest.yesterday) == 2
    assert len(digest.today) == 2
    assert digest.match_of_the_day is not None
    assert digest.match_of_the_day.card.fixture.home.name == "USA"
    assert digest.match_of_the_day.card.fixture.away.name == "Wales"
    assert digest.match_of_the_day.card.kickoff_label == "8:30 PM IST"
    assert "USA vs Wales" in digest.match_of_the_day.reason


def test_build_digest_handles_empty_inputs():
    now = datetime(2026, 6, 13, 6, 0, tzinfo=UTC)

    digest = build_digest([], [], now=now)

    assert digest.yesterday == []
    assert digest.today == []
    assert digest.match_of_the_day is None


def test_build_digest_includes_today_fixtures_of_any_status():
    fixtures = [
        _fixture(
            "4001",
            ("Brazil", "BRA"),
            ("Argentina", "ARG"),
            datetime(2026, 6, 13, 10, 0, tzinfo=UTC),
            status=MatchStatus.FINISHED,
        ),
        _fixture(
            "4002",
            ("Spain", "ESP"),
            ("Italy", "ITA"),
            datetime(2026, 6, 13, 12, 0, tzinfo=UTC),
            status=MatchStatus.LIVE,
        ),
    ]
    now = datetime(2026, 6, 13, 6, 0, tzinfo=UTC)

    digest = build_digest(fixtures, [], now=now)

    statuses = {card.fixture.status for card in digest.today}
    assert statuses == {MatchStatus.FINISHED, MatchStatus.LIVE}


def test_build_digest_yesterday_sorted_by_kickoff():
    results = [
        _result(
            "5001",
            ("Mexico", "MEX"),
            ("Canada", "CAN"),
            2,
            1,
            "HOME",
            datetime(2026, 6, 12, 18, 0, tzinfo=UTC),
        ),
        _result(
            "5002",
            ("Argentina", "ARG"),
            ("Australia", "AUS"),
            1,
            1,
            "DRAW",
            datetime(2026, 6, 12, 10, 0, tzinfo=UTC),
        ),
    ]
    now = datetime(2026, 6, 13, 6, 0, tzinfo=UTC)

    digest = build_digest([], results, now=now)

    assert [story.result.id for story in digest.yesterday] == ["5002", "5001"]


# -- purity --------------------------------------------------------------------


def test_digest_module_has_no_forbidden_imports():
    source = Path("src/terrace/core/digest.py").read_text()
    for forbidden in ("terrace.sources", "httpx", "fastapi", "import os", "from os"):
        assert forbidden not in source
