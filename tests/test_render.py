from datetime import UTC, date, datetime

from terrace.core.digest import DailyDigest, MatchCard, MatchOfTheDay, ResultStory
from terrace.core.models import Competition, Fixture, MatchStatus, Result, Team
from terrace.render.markdown import render_markdown

COMPETITION = Competition(code="WC", name="FIFA World Cup")


def _team(name: str, code: str) -> Team:
    return Team(name=name, code=code)


def _result_story() -> ResultStory:
    result = Result(
        id="r1",
        competition=COMPETITION,
        kickoff=datetime(2026, 6, 13, 18, 0, tzinfo=UTC),
        home=_team("Brazil", "BRA"),
        away=_team("Argentina", "ARG"),
        home_score=2,
        away_score=1,
        winner="HOME",
        matchday=1,
        group="Group A",
    )
    return ResultStory(result=result, story="Brazil edged Argentina 2–1.")


def _match_card() -> MatchCard:
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
    return MatchCard(
        fixture=fixture,
        kickoff_ist=datetime(2026, 6, 14, 20, 30),
        kickoff_label="8:30 PM IST",
    )


def test_renders_header():
    digest = DailyDigest(
        digest_date=date(2026, 6, 14),
        yesterday=[],
        today=[],
        match_of_the_day=None,
    )
    out = render_markdown(digest)
    assert out.startswith("# Touchline — Sunday, 14 June 2026")


def test_renders_yesterday_story():
    digest = DailyDigest(
        digest_date=date(2026, 6, 14),
        yesterday=[_result_story()],
        today=[],
        match_of_the_day=None,
    )
    out = render_markdown(digest)
    assert "## Yesterday" in out
    assert "- Brazil edged Argentina 2–1." in out


def test_renders_today_match():
    card = _match_card()
    digest = DailyDigest(
        digest_date=date(2026, 6, 14),
        yesterday=[],
        today=[card],
        match_of_the_day=None,
    )
    out = render_markdown(digest)
    assert "## Today" in out
    assert "- 8:30 PM IST — France vs Germany" in out


def test_renders_match_of_the_day_when_set():
    card = _match_card()
    motd = MatchOfTheDay(card=card, reason="Prime-time pick: France vs Germany at 8:30 PM IST.")
    digest = DailyDigest(
        digest_date=date(2026, 6, 14),
        yesterday=[],
        today=[card],
        match_of_the_day=motd,
    )
    out = render_markdown(digest)
    assert "## Match of the day" in out
    assert "**France vs Germany** — Prime-time pick: France vs Germany at 8:30 PM IST." in out


def test_omits_match_of_the_day_section_when_none():
    digest = DailyDigest(
        digest_date=date(2026, 6, 14),
        yesterday=[],
        today=[],
        match_of_the_day=None,
    )
    out = render_markdown(digest)
    assert "Match of the day" not in out


def test_empty_state_messages():
    digest = DailyDigest(
        digest_date=date(2026, 6, 14),
        yesterday=[],
        today=[],
        match_of_the_day=None,
    )
    out = render_markdown(digest)
    assert "_Nothing finished yesterday._" in out
    assert "_No matches today._" in out
