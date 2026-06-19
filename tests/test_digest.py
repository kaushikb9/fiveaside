from datetime import UTC, datetime
from pathlib import Path

from touchline.core.digest import (
    MatchCard,
    WhatToWatch,
    build_digest,
    format_ist,
    fun_fact,
    pick_match_of_the_day,
    pick_what_to_watch,
    relevant_headlines,
    result_story,
    to_ist,
)
from touchline.core.models import Competition, Fixture, MatchStatus, NewsItem, Result, Team

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


# -- relevant_headlines --------------------------------------------------------


def _news_item(title: str, link: str, source: str = "BBC Sport", published=None) -> NewsItem:
    return NewsItem(title=title, link=link, source=source, published=published)


def test_relevant_headlines_empty_news_returns_empty():
    assert relevant_headlines([], ["England"]) == []


def test_relevant_headlines_empty_teams_returns_empty():
    item = _news_item("England win", "http://example.com/1")
    assert relevant_headlines([item], []) == []


def test_relevant_headlines_whitespace_only_teams_returns_empty():
    item = _news_item("England win", "http://example.com/1")
    assert relevant_headlines([item], ["  ", ""]) == []


def test_relevant_headlines_no_matches_returns_empty():
    item = _news_item("Cricket: India beat Pakistan", "http://example.com/1")
    assert relevant_headlines([item], ["England", "Germany"]) == []


def test_relevant_headlines_basic_match():
    item = _news_item("England score late winner", "http://example.com/1")
    result = relevant_headlines([item], ["England"])
    assert len(result) == 1
    assert result[0].title == "England score late winner"


def test_relevant_headlines_case_insensitive():
    item = _news_item("ENGLAND qualify for final", "http://example.com/1")
    result = relevant_headlines([item], ["England"])
    assert len(result) == 1


def test_relevant_headlines_ranked_by_score_descending():
    # two_teams mentions both England and France → score 2
    # one_team mentions only England → score 1
    two_teams = _news_item(
        "England vs France: preview",
        "http://example.com/2",
        published=datetime(2026, 6, 10, 12, 0, tzinfo=UTC),
    )
    one_team = _news_item(
        "England face tough draw",
        "http://example.com/1",
        published=datetime(2026, 6, 12, 12, 0, tzinfo=UTC),
    )
    result = relevant_headlines([one_team, two_teams], ["England", "France"])
    assert result[0].link == "http://example.com/2"  # higher score first
    assert result[1].link == "http://example.com/1"


def test_relevant_headlines_same_score_sorted_by_published_descending():
    older = _news_item(
        "England train ahead of match",
        "http://example.com/old",
        published=datetime(2026, 6, 10, 10, 0, tzinfo=UTC),
    )
    newer = _news_item(
        "England manager speaks out",
        "http://example.com/new",
        published=datetime(2026, 6, 12, 10, 0, tzinfo=UTC),
    )
    result = relevant_headlines([older, newer], ["England"])
    assert result[0].link == "http://example.com/new"  # newer first


def test_relevant_headlines_none_published_sorts_last():
    with_date = _news_item(
        "England win",
        "http://example.com/dated",
        published=datetime(2026, 6, 10, 10, 0, tzinfo=UTC),
    )
    no_date = _news_item("England qualify", "http://example.com/nodated", published=None)
    result = relevant_headlines([no_date, with_date], ["England"])
    assert result[0].link == "http://example.com/dated"
    assert result[1].link == "http://example.com/nodated"


def test_relevant_headlines_cap_at_limit():
    items = [
        _news_item(f"England news {i}", f"http://example.com/{i}") for i in range(10)
    ]
    result = relevant_headlines(items, ["England"], limit=3)
    assert len(result) == 3


def test_relevant_headlines_deduplicates_by_link():
    # Same link appears twice in the input — should appear only once in output.
    item_a = _news_item(
        "England vs France: match report",
        "http://example.com/same",
        published=datetime(2026, 6, 12, 10, 0, tzinfo=UTC),
    )
    item_b = NewsItem(
        title="England vs France: match report",
        link="http://example.com/same",
        source="Sky Sports",
        published=datetime(2026, 6, 11, 10, 0, tzinfo=UTC),
    )
    result = relevant_headlines([item_a, item_b], ["England", "France"])
    assert len(result) == 1
    assert result[0].link == "http://example.com/same"


def test_relevant_headlines_original_index_tiebreak():
    # Same score, both published=None → original list order preserved.
    first = _news_item("England hope", "http://example.com/first")
    second = _news_item("England aim", "http://example.com/second")
    result = relevant_headlines([first, second], ["England"])
    assert result[0].link == "http://example.com/first"


# -- build_digest with news ----------------------------------------------------


def test_build_digest_news_none_yields_empty_headlines():
    now = datetime(2026, 6, 13, 6, 0, tzinfo=UTC)
    digest = build_digest([], [], now=now, news=None)
    assert digest.yesterday_headlines == []
    assert digest.today_headlines == []


def test_build_digest_news_empty_list_yields_empty_headlines():
    now = datetime(2026, 6, 13, 6, 0, tzinfo=UTC)
    digest = build_digest([], [], now=now, news=[])
    assert digest.yesterday_headlines == []
    assert digest.today_headlines == []


def test_build_digest_news_none_still_renders():
    """Digest with news=None renders without error."""
    now = datetime(2026, 6, 13, 6, 0, tzinfo=UTC)
    digest = build_digest([], [], now=now, news=None)
    from touchline.render.markdown import render_markdown

    output = render_markdown(digest)
    assert "# Touchline" in output


def test_build_digest_attaches_relevant_headlines():
    results = [
        _result(
            "R1",
            ("Mexico", "MEX"),
            ("Canada", "CAN"),
            2,
            1,
            "HOME",
            datetime(2026, 6, 12, 16, 0, tzinfo=UTC),
        )
    ]
    fixtures = [
        _fixture(
            "F1",
            ("France", "FRA"),
            ("Germany", "GER"),
            datetime(2026, 6, 13, 15, 0, tzinfo=UTC),
        )
    ]
    news = [
        _news_item("Mexico stun Canada", "http://example.com/mex"),
        _news_item("France prepare for Germany clash", "http://example.com/fra"),
        _news_item("Cricket: no relevance", "http://example.com/cricket"),
    ]
    now = datetime(2026, 6, 13, 6, 0, tzinfo=UTC)

    digest = build_digest(fixtures, results, now=now, news=news)

    assert len(digest.yesterday_headlines) == 1
    assert digest.yesterday_headlines[0].title == "Mexico stun Canada"
    assert len(digest.today_headlines) == 1
    assert digest.today_headlines[0].title == "France prepare for Germany clash"


# -- relevant_headlines additional edge cases ----------------------------------


def test_relevant_headlines_ignores_summary_field():
    """Only the title is searched; a team name in the summary must NOT cause a match."""
    item = NewsItem(
        title="Cricket: day-night test in progress",
        link="http://example.com/cricket",
        source="BBC Sport",
        summary="England prepare for the upcoming tournament",  # team name here only
    )
    result = relevant_headlines([item], ["England"])
    assert result == [], "Summary must not be used for relevance scoring"


def test_relevant_headlines_custom_limit_one():
    """limit=1 returns exactly the top-ranked item even when many match."""
    items = [
        _news_item(f"England update {i}", f"http://example.com/{i}") for i in range(5)
    ]
    result = relevant_headlines(items, ["England"], limit=1)
    assert len(result) == 1


def test_relevant_headlines_score_counts_distinct_teams_only():
    """Repeating the same team name in a title scores only 1, not 2."""
    # "England" appears twice in the title, but the *distinct* team set has size 1,
    # so the score should be 1, not 2.
    item_repeated = _news_item("England beat England B", "http://example.com/eng-vs-engb")
    item_normal = _news_item("England beat France", "http://example.com/eng-vs-fra")
    result = relevant_headlines(
        [item_repeated, item_normal], ["England", "France"], limit=3
    )
    # item_normal scores 2 (mentions both England and France) → ranked first
    assert result[0].link == "http://example.com/eng-vs-fra"


def test_relevant_headlines_dedup_keeps_highest_ranked():
    """When the same link appears twice, the higher-ranked occurrence is kept."""
    # item_b has the same link as item_a but appears later (lower original index).
    # item_a has score 1 (England only); item_b also has score 1 but no published date.
    # Both items have the same link; only one should appear and it should be the
    # higher-ranked one (item_a, published date sorts it before item_b).
    item_a = _news_item(
        "England qualify",
        "http://example.com/same",
        published=datetime(2026, 6, 12, 10, 0, tzinfo=UTC),
    )
    item_b = NewsItem(
        title="England qualify",
        link="http://example.com/same",
        source="Sky Sports",
        published=None,
    )
    result = relevant_headlines([item_a, item_b], ["England"])
    assert len(result) == 1
    # The dated version (item_a) sorts before the undated one → it wins dedup
    assert result[0].source == "BBC Sport"


# -- fun_fact ------------------------------------------------------------------


def test_fun_fact_empty_inputs_returns_none():
    assert fun_fact([], []) is None


def test_fun_fact_cards_only_returns_match_count_plural():
    cards = [
        _card("C1", ("Spain", "ESP"), ("Germany", "GER"), datetime(2026, 6, 13, 15, 0, tzinfo=UTC)),
        _card("C2", ("France", "FRA"), ("Italy", "ITA"), datetime(2026, 6, 13, 18, 0, tzinfo=UTC)),
    ]
    assert fun_fact(cards, []) == "2 matches on the card today."


def test_fun_fact_cards_only_singular():
    cards = [
        _card("C1", ("Spain", "ESP"), ("Germany", "GER"), datetime(2026, 6, 13, 15, 0, tzinfo=UTC)),
    ]
    assert fun_fact(cards, []) == "1 match on the card today."


def test_fun_fact_results_win_branch_wins_over_match_count():
    """When results are present, biggest-win branch takes priority over match-count."""
    cards = [
        _card("C1", ("Spain", "ESP"), ("Germany", "GER"), datetime(2026, 6, 13, 15, 0, tzinfo=UTC)),
    ]
    results = [
        _result(
            "R1",
            ("Brazil", "BRA"),
            ("Japan", "JPN"),
            4,
            0,
            "HOME",
            datetime(2026, 6, 12, 16, 0, tzinfo=UTC),
        )
    ]
    fact = fun_fact(cards, results)
    assert fact is not None
    assert fact.startswith("Biggest win so far:")
    assert "Brazil" in fact
    assert "4–0" in fact
    assert "Japan" in fact


def test_fun_fact_biggest_win_picks_largest_margin():
    results = [
        _result(
            "R1",
            ("Mexico", "MEX"),
            ("Canada", "CAN"),
            2,
            1,
            "HOME",
            datetime(2026, 6, 12, 16, 0, tzinfo=UTC),
        ),
        _result(
            "R2",
            ("Brazil", "BRA"),
            ("South Korea", "KOR"),
            5,
            0,
            "HOME",
            datetime(2026, 6, 12, 18, 0, tzinfo=UTC),
        ),
    ]
    fact = fun_fact([], results)
    assert fact is not None
    assert "Brazil" in fact
    assert "5–0" in fact


def test_fun_fact_skips_draws_for_biggest_win():
    """All draws → no biggest-win fact, falls through to cards branch."""
    cards = [
        _card("C1", ("Spain", "ESP"), ("Germany", "GER"), datetime(2026, 6, 13, 15, 0, tzinfo=UTC)),
    ]
    results = [
        _result(
            "R1",
            ("Mexico", "MEX"),
            ("Canada", "CAN"),
            1,
            1,
            "DRAW",
            datetime(2026, 6, 12, 16, 0, tzinfo=UTC),
        )
    ]
    fact = fun_fact(cards, results)
    # All results are draws → falls through to card-count branch
    assert fact == "1 match on the card today."


# -- pick_what_to_watch --------------------------------------------------------


def test_pick_what_to_watch_empty_cards_returns_none():
    assert pick_what_to_watch([], []) is None


def test_pick_what_to_watch_returns_wtw_instance():
    cards = [
        _card("C1", ("Spain", "ESP"), ("Germany", "GER"), datetime(2026, 6, 13, 15, 0, tzinfo=UTC)),
    ]
    result = pick_what_to_watch(cards, [])
    assert isinstance(result, WhatToWatch)
    assert result.card.fixture.id == "C1"


def test_pick_what_to_watch_both_teams_in_form_take():
    home_team = ("Brazil", "BRA")
    away_team = ("Argentina", "ARG")
    cards = [
        _card("C1", home_team, away_team, datetime(2026, 6, 13, 15, 0, tzinfo=UTC)),
    ]
    results = [
        _result(
            "R1",
            home_team,
            ("Japan", "JPN"),
            2,
            0,
            "HOME",
            datetime(2026, 6, 12, 14, 0, tzinfo=UTC),
        ),
        _result(
            "R2",
            ("Spain", "ESP"),
            away_team,
            0,
            1,
            "AWAY",
            datetime(2026, 6, 12, 16, 0, tzinfo=UTC),
        ),
    ]
    wtw = pick_what_to_watch(cards, results)
    assert wtw is not None
    assert "Brazil" in wtw.take
    assert "Argentina" in wtw.take
    assert "back of wins" in wtw.take
    assert "8:30 PM IST" in wtw.take  # kickoff_label included


def test_pick_what_to_watch_matchday_take():
    cards = [
        _card("C1", ("Spain", "ESP"), ("Germany", "GER"), datetime(2026, 6, 13, 15, 0, tzinfo=UTC)),
    ]
    wtw = pick_what_to_watch(cards, [])
    assert wtw is not None
    # matchday=1 is set by _card/_fixture helper
    assert "Matchday 1" in wtw.take
    assert "Spain" in wtw.take
    assert "Germany" in wtw.take
    assert "8:30 PM IST" in wtw.take


def test_pick_what_to_watch_fallback_take_when_no_matchday():
    """Fixture with matchday=None → fallback take."""
    fixture = Fixture(
        id="F99",
        competition=COMPETITION,
        kickoff=datetime(2026, 6, 13, 15, 0, tzinfo=UTC),
        home=_team("USA", "USA"),
        away=_team("Wales", "WAL"),
        status=MatchStatus.SCHEDULED,
        matchday=None,
    )
    card = MatchCard(
        fixture=fixture,
        kickoff_ist=to_ist(datetime(2026, 6, 13, 15, 0, tzinfo=UTC)),
        kickoff_label=format_ist(datetime(2026, 6, 13, 15, 0, tzinfo=UTC)),
    )
    wtw = pick_what_to_watch([card], [])
    assert wtw is not None
    assert "pick of today's slate" in wtw.take
    assert "USA" in wtw.take
    assert "Wales" in wtw.take


def test_pick_what_to_watch_tiebreak_earliest_kickoff():
    """When scores are equal, earliest kickoff_ist wins; then fixture.id."""
    # matchday=1 for both, no results → equal scores; earlier kickoff should win
    earlier = _card(
        "A001",
        ("Spain", "ESP"),
        ("Germany", "GER"),
        datetime(2026, 6, 13, 13, 0, tzinfo=UTC),  # 6:30 PM IST
    )
    later = _card(
        "A002",
        ("France", "FRA"),
        ("Italy", "ITA"),
        datetime(2026, 6, 13, 16, 0, tzinfo=UTC),  # 9:30 PM IST
    )
    wtw = pick_what_to_watch([later, earlier], [])
    assert wtw is not None
    assert wtw.card.fixture.id == "A001"


def test_pick_what_to_watch_tiebreak_fixture_id_when_same_kickoff():
    """When score and kickoff are equal, fixture.id (ascending) breaks the tie."""
    ko = datetime(2026, 6, 13, 15, 0, tzinfo=UTC)
    card_b = _card("B002", ("Brazil", "BRA"), ("Japan", "JPN"), ko)
    card_a = _card("A001", ("Spain", "ESP"), ("Germany", "GER"), ko)
    wtw = pick_what_to_watch([card_b, card_a], [])
    assert wtw is not None
    assert wtw.card.fixture.id == "A001"


def test_pick_what_to_watch_higher_matchday_wins_over_lower():
    """Higher matchday → higher score → wins even with later kickoff."""
    low_day = Fixture(
        id="F1",
        competition=COMPETITION,
        kickoff=datetime(2026, 6, 13, 12, 0, tzinfo=UTC),
        home=_team("Mexico", "MEX"),
        away=_team("Canada", "CAN"),
        status=MatchStatus.SCHEDULED,
        matchday=1,
    )
    high_day = Fixture(
        id="F2",
        competition=COMPETITION,
        kickoff=datetime(2026, 6, 13, 16, 0, tzinfo=UTC),
        home=_team("Brazil", "BRA"),
        away=_team("Argentina", "ARG"),
        status=MatchStatus.SCHEDULED,
        matchday=3,
    )
    cards = [
        MatchCard(
            fixture=low_day,
            kickoff_ist=to_ist(low_day.kickoff),
            kickoff_label=format_ist(low_day.kickoff),
        ),
        MatchCard(
            fixture=high_day,
            kickoff_ist=to_ist(high_day.kickoff),
            kickoff_label=format_ist(high_day.kickoff),
        ),
    ]
    wtw = pick_what_to_watch(cards, [])
    assert wtw is not None
    assert wtw.card.fixture.id == "F2"


def test_pick_what_to_watch_attaches_fun_fact():
    cards = [
        _card("C1", ("Spain", "ESP"), ("Germany", "GER"), datetime(2026, 6, 13, 15, 0, tzinfo=UTC)),
    ]
    wtw = pick_what_to_watch(cards, [])
    assert wtw is not None
    # With cards and no results → match-count fun_fact
    assert wtw.fun_fact == "1 match on the card today."


def test_build_digest_sets_what_to_watch():
    fixtures = [
        _fixture(
            "T1",
            ("Spain", "ESP"),
            ("Germany", "GER"),
            datetime(2026, 6, 13, 15, 0, tzinfo=UTC),
        )
    ]
    now = datetime(2026, 6, 13, 6, 0, tzinfo=UTC)
    digest = build_digest(fixtures, [], now=now)
    assert digest.what_to_watch is not None
    assert digest.what_to_watch.card.fixture.id == "T1"


def test_build_digest_what_to_watch_none_when_no_today_fixtures():
    now = datetime(2026, 6, 13, 6, 0, tzinfo=UTC)
    digest = build_digest([], [], now=now)
    assert digest.what_to_watch is None


# -- fun_fact additional coverage (test-engineer additions) --------------------


def test_fun_fact_all_draws_no_cards_returns_none():
    """Failure-mode: results are all draws and cards is empty → None.

    The draws-only branch produces no non_draws; the cards branch is also empty;
    the function must fall all the way through and return None rather than
    returning a stale or fabricated fact.
    """
    draw_result = _result(
        "D1",
        ("Mexico", "MEX"),
        ("Canada", "CAN"),
        2,
        2,
        "DRAW",
        datetime(2026, 6, 12, 16, 0, tzinfo=UTC),
    )
    assert fun_fact([], [draw_result]) is None


def test_fun_fact_same_margin_tiebreak_picks_earlier_kickoff():
    """When two results share the same winning margin, the earlier kickoff wins."""
    earlier = _result(
        "E1",
        ("Brazil", "BRA"),
        ("Peru", "PER"),
        3,
        0,
        "HOME",
        datetime(2026, 6, 12, 13, 0, tzinfo=UTC),  # earlier UTC kickoff
    )
    later = _result(
        "L1",
        ("France", "FRA"),
        ("Senegal", "SEN"),
        3,
        0,
        "HOME",
        datetime(2026, 6, 12, 17, 0, tzinfo=UTC),  # same margin, later kickoff
    )
    fact = fun_fact([], [later, earlier])
    assert fact is not None
    # Tiebreak: earliest kickoff → Brazil (earlier) is the "biggest win" fact
    assert "Brazil" in fact
    assert "3–0" in fact


# -- pick_what_to_watch additional coverage ------------------------------------


def test_pick_what_to_watch_only_home_team_in_form_does_not_use_both_wins_take():
    """Partial momentum (only home in form) must NOT produce the 'back of wins' take."""
    home_team = ("Brazil", "BRA")
    away_team = ("Japan", "JPN")
    cards = [
        _card("C1", home_team, away_team, datetime(2026, 6, 13, 15, 0, tzinfo=UTC)),
    ]
    # Only home team (Brazil) is a winner; Japan has no recent win.
    results = [
        _result(
            "R1",
            home_team,
            ("Canada", "CAN"),
            2,
            0,
            "HOME",
            datetime(2026, 6, 12, 14, 0, tzinfo=UTC),
        ),
    ]
    wtw = pick_what_to_watch(cards, results)
    assert wtw is not None
    # One team in form → must NOT say "back of wins" (that requires BOTH)
    assert "back of wins" not in wtw.take
    # matchday=1 from _card helper, so we expect the matchday variant
    assert "Matchday 1" in wtw.take


def test_build_digest_what_to_watch_uses_all_results_for_momentum():
    """build_digest passes the full *results* list (not just yesterday's results)
    to pick_what_to_watch, so a result from several days ago still influences
    the momentum score.
    """
    # Two fixtures today with equal matchday; Brazil plays the later one.
    early_fixture = _fixture(
        "A1",
        ("Canada", "CAN"),
        ("Mexico", "MEX"),
        datetime(2026, 6, 13, 13, 0, tzinfo=UTC),  # earlier kickoff
    )
    late_fixture = _fixture(
        "B1",
        ("Brazil", "BRA"),
        ("Japan", "JPN"),
        datetime(2026, 6, 13, 16, 0, tzinfo=UTC),  # later kickoff
    )
    # A result from three days ago (not "yesterday") for Brazil.
    # Without momentum, the earlier card (A1) would win the tiebreak.
    # With Brazil's momentum (+1), B1 scores matchday(1)+1=2 vs A1's 1+0=1 → B1 wins.
    old_result = _result(
        "OLD",
        ("Brazil", "BRA"),
        ("Argentina", "ARG"),
        3,
        0,
        "HOME",
        datetime(2026, 6, 10, 16, 0, tzinfo=UTC),  # three days before digest_date
    )
    now = datetime(2026, 6, 13, 6, 0, tzinfo=UTC)  # digest_date = 2026-06-13

    digest = build_digest([early_fixture, late_fixture], [old_result], now=now)

    wtw = digest.what_to_watch
    assert wtw is not None
    # The late fixture (B1) must win because of Brazil's momentum from old_result.
    assert wtw.card.fixture.id == "B1", (
        "build_digest must pass ALL results to pick_what_to_watch, "
        "not only yesterday's results"
    )


# -- purity --------------------------------------------------------------------


def test_digest_module_has_no_forbidden_imports():
    source = Path("src/touchline/core/digest.py").read_text()
    for forbidden in ("touchline.sources", "httpx", "fastapi", "import os", "from os"):
        assert forbidden not in source
