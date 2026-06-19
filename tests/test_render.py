from datetime import UTC, date, datetime

from terrace.core.digest import DailyDigest, MatchCard, MatchOfTheDay, ResultStory
from terrace.core.models import Competition, Fixture, MatchStatus, NewsItem, Result, Team
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


# -- headline rendering --------------------------------------------------------


def _news_item(title: str, link: str, source: str = "BBC Sport") -> NewsItem:
    return NewsItem(title=title, link=link, source=source)


def test_renders_yesterday_headlines():
    item = _news_item("Brazil edge Argentina in thriller", "https://bbc.co.uk/sport/1")
    digest = DailyDigest(
        digest_date=date(2026, 6, 14),
        yesterday=[_result_story()],
        today=[],
        match_of_the_day=None,
        yesterday_headlines=[item],
    )
    out = render_markdown(digest)
    assert "**In the news**" in out
    assert "- [Brazil edge Argentina in thriller](https://bbc.co.uk/sport/1) — BBC Sport" in out


def test_renders_today_headlines():
    item = _news_item("France vs Germany: what to expect", "https://sky.com/sport/2", "Sky Sports")
    card = _match_card()
    digest = DailyDigest(
        digest_date=date(2026, 6, 14),
        yesterday=[],
        today=[card],
        match_of_the_day=None,
        today_headlines=[item],
    )
    out = render_markdown(digest)
    assert "**In the news**" in out
    assert "- [France vs Germany: what to expect](https://sky.com/sport/2) — Sky Sports" in out


def test_no_in_the_news_block_when_headlines_empty():
    digest = DailyDigest(
        digest_date=date(2026, 6, 14),
        yesterday=[_result_story()],
        today=[_match_card()],
        match_of_the_day=None,
        yesterday_headlines=[],
        today_headlines=[],
    )
    out = render_markdown(digest)
    assert "In the news" not in out


def test_no_in_the_news_block_when_headlines_defaulted():
    """DailyDigest constructed without headline fields → no 'In the news' block."""
    digest = DailyDigest(
        digest_date=date(2026, 6, 14),
        yesterday=[],
        today=[],
        match_of_the_day=None,
    )
    out = render_markdown(digest)
    assert "In the news" not in out


def test_renders_multiple_headlines_per_section():
    items = [
        _news_item(f"Headline {i}", f"https://example.com/{i}") for i in range(3)
    ]
    digest = DailyDigest(
        digest_date=date(2026, 6, 14),
        yesterday=[],
        today=[],
        match_of_the_day=None,
        today_headlines=items,
    )
    out = render_markdown(digest)
    for i in range(3):
        assert f"[Headline {i}](https://example.com/{i})" in out


def test_in_the_news_appears_after_match_content_in_yesterday_section():
    """'In the news' block must come AFTER the match story lines, not before."""
    item = _news_item("Brazil edge Argentina", "https://example.com/bra-arg")
    story = _result_story()
    digest = DailyDigest(
        digest_date=date(2026, 6, 14),
        yesterday=[story],
        today=[],
        match_of_the_day=None,
        yesterday_headlines=[item],
    )
    out = render_markdown(digest)
    story_pos = out.index("Brazil edged Argentina 2–1.")
    news_pos = out.index("In the news")
    assert story_pos < news_pos, (
        "'In the news' must appear after match story lines within the Yesterday section"
    )


def test_in_the_news_appears_after_match_content_in_today_section():
    """'In the news' block must come AFTER fixture lines in Today section."""
    item = _news_item("France vs Germany preview", "https://example.com/fra-ger")
    card = _match_card()
    digest = DailyDigest(
        digest_date=date(2026, 6, 14),
        yesterday=[],
        today=[card],
        match_of_the_day=None,
        today_headlines=[item],
    )
    out = render_markdown(digest)
    fixture_pos = out.index("France vs Germany")
    news_pos = out.index("In the news")
    assert fixture_pos < news_pos, (
        "'In the news' must appear after fixture lines within the Today section"
    )


def test_headline_format_is_markdown_link_dash_source():
    """Each headline renders as '- [title](link) — source' (em-dash, not hyphen)."""
    item = _news_item("Germany win", "https://example.com/ger", "Der Spiegel")
    digest = DailyDigest(
        digest_date=date(2026, 6, 14),
        yesterday=[],
        today=[],
        match_of_the_day=None,
        today_headlines=[item],
    )
    out = render_markdown(digest)
    # Exact format check: link markdown + em-dash separator + source name
    assert "- [Germany win](https://example.com/ger) — Der Spiegel" in out
