"""Pure digest-building logic for Touchline.

This module is pure: it imports only from ``terrace.core.models`` and the
standard library. No I/O, no `datetime.now()` -- time enters only via the
`now` parameter of `build_digest`.
"""

from collections.abc import Iterable
from datetime import UTC, date, datetime, timedelta, timezone

from pydantic import BaseModel

from terrace.core.models import Fixture, NewsItem, Result

IST = timezone(timedelta(hours=5, minutes=30))


class ResultStory(BaseModel, frozen=True):
    result: Result
    story: str


class MatchCard(BaseModel, frozen=True):
    fixture: Fixture
    kickoff_ist: datetime
    kickoff_label: str


class MatchOfTheDay(BaseModel, frozen=True):
    card: MatchCard
    reason: str


class WhatToWatch(BaseModel, frozen=True):
    card: MatchCard
    take: str  # opinionated one-liner
    fun_fact: str | None = None


class DailyDigest(BaseModel, frozen=True):
    digest_date: date
    yesterday: list[ResultStory]
    today: list[MatchCard]
    match_of_the_day: MatchOfTheDay | None
    yesterday_headlines: list[NewsItem] = []
    today_headlines: list[NewsItem] = []
    what_to_watch: WhatToWatch | None = None


def to_ist(dt: datetime) -> datetime:
    """Convert `dt` to IST. Naive datetimes are treated as UTC."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.astimezone(IST)


def format_ist(dt: datetime) -> str:
    """Render `dt` as a 12-hour IST kickoff label, e.g. "8:30 PM IST"."""
    ist = to_ist(dt)
    hour = ist.hour % 12 or 12
    period = "AM" if ist.hour < 12 else "PM"
    return f"{hour}:{ist.minute:02d} {period} IST"


def result_story(result: Result) -> str:
    """A calm, data-only one-line summary of a finished match."""
    home, away = result.home.name, result.away.name
    home_score, away_score = result.home_score, result.away_score

    if result.winner == "DRAW" or home_score == away_score:
        return f"{home} and {away} drew {home_score}–{away_score}."

    if result.winner == "AWAY":
        winner, loser, hi, lo = away, home, away_score, home_score
    else:
        winner, loser, hi, lo = home, away, home_score, away_score

    margin = hi - lo
    if margin == 1:
        verb = "edged"
    elif margin <= 3:
        verb = "beat"
    else:
        verb = "thrashed"

    return f"{winner} {verb} {loser} {hi}–{lo}."


def pick_match_of_the_day(cards: list[MatchCard]) -> MatchOfTheDay | None:
    """Prime-time heuristic: closest kickoff to 8 PM IST wins."""
    if not cards:
        return None

    best = min(
        cards,
        key=lambda c: (abs(c.kickoff_ist.hour - 20), c.kickoff_ist, c.fixture.id),
    )
    reason = (
        f"Prime-time pick: {best.fixture.home.name} vs {best.fixture.away.name} "
        f"at {best.kickoff_label}."
    )
    return MatchOfTheDay(card=best, reason=reason)


def fun_fact(cards: list[MatchCard], results: list[Result]) -> str | None:
    """Return the first applicable data-derived fun fact (deterministic priority order).

    1. If *results* is non-empty: biggest-margin win so far.
    2. elif *cards*: match-count sentence.
    3. else None.
    """
    if results:
        non_draws = [r for r in results if not r.is_draw]
        if non_draws:
            non_draws.sort(
                key=lambda r: (-(abs(r.home_score - r.away_score)), r.kickoff, r.id)
            )
            best = non_draws[0]
            winner_team = best.winning_team
            if winner_team is not None:
                loser_team = best.away if winner_team == best.home else best.home
                hi = max(best.home_score, best.away_score)
                lo = min(best.home_score, best.away_score)
                return (
                    f"Biggest win so far: {winner_team.name} {hi}–{lo} over {loser_team.name}."
                )
    if cards:
        n = len(cards)
        noun = "match" if n == 1 else "matches"
        return f"{n} {noun} on the card today."
    return None


def pick_what_to_watch(cards: list[MatchCard], results: list[Result]) -> WhatToWatch | None:
    """Narrative-weight pick for "What to watch today".

    Scoring (deterministic):
    - base  = card.fixture.matchday or 0
    - +1 for each of home/away whose name appears as a winner in *results*

    Tie-break: earliest kickoff_ist, then fixture.id (ascending).
    """
    if not cards:
        return None

    winner_names: set[str] = {
        r.winning_team.name for r in results if r.winning_team is not None
    }

    def _score(card: MatchCard) -> int:
        base = card.fixture.matchday or 0
        momentum = sum(
            1
            for name in (card.fixture.home.name, card.fixture.away.name)
            if name in winner_names
        )
        return base + momentum

    best = min(
        cards,
        key=lambda c: (-_score(c), c.kickoff_ist, c.fixture.id),
    )

    home = best.fixture.home.name
    away = best.fixture.away.name
    kickoff_label = best.kickoff_label
    matchday = best.fixture.matchday

    home_won = home in winner_names
    away_won = away in winner_names

    if home_won and away_won:
        take = (
            f"Both {home} and {away} arrive on the back of wins — "
            f"this is the one to watch at {kickoff_label}."
        )
    elif matchday:
        take = (
            f"Matchday {matchday} and everything still to play for — "
            f"{home} vs {away} at {kickoff_label} is the pick."
        )
    else:
        take = f"{home} vs {away} at {kickoff_label} is the pick of today's slate."

    return WhatToWatch(
        card=best,
        take=take,
        fun_fact=fun_fact(cards, results),
    )


def relevant_headlines(
    news: list[NewsItem], teams: Iterable[str], *, limit: int = 3
) -> list[NewsItem]:
    """Return up to `limit` news items most relevant to `teams`.

    Relevance score = number of distinct team names that appear (case-insensitive
    substring) in the item's title.  Items with score < 1 are excluded.  Ties
    are broken by published date descending (None last), then original list
    index ascending.  Duplicates by ``link`` are removed, keeping the
    highest-ranked occurrence.
    """
    if not news:
        return []
    team_set = {t.lower() for t in teams if t.strip()}
    if not team_set:
        return []

    scored: list[tuple[int, NewsItem, int]] = []
    for idx, item in enumerate(news):
        title_lower = item.title.lower()
        score = sum(1 for t in team_set if t in title_lower)
        if score >= 1:
            scored.append((score, item, idx))

    def _sort_key(entry: tuple[int, NewsItem, int]) -> tuple:
        score, item, idx = entry
        if item.published is not None:
            try:
                pub_sort: float = -item.published.timestamp()
            except Exception:
                pub_sort = float("inf")
        else:
            pub_sort = float("inf")
        return (-score, pub_sort, idx)

    scored.sort(key=_sort_key)

    seen_links: set[str] = set()
    result: list[NewsItem] = []
    for _score, item, _idx in scored:
        if item.link not in seen_links:
            seen_links.add(item.link)
            result.append(item)
            if len(result) == limit:
                break
    return result


def build_digest(
    fixtures: list[Fixture],
    results: list[Result],
    *,
    now: datetime,
    news: list[NewsItem] | None = None,
) -> DailyDigest:
    """Build a `DailyDigest` for the IST calendar day containing `now`."""
    digest_date = to_ist(now).date()
    yesterday_date = digest_date - timedelta(days=1)

    yesterday_results = sorted(
        (r for r in results if to_ist(r.kickoff).date() == yesterday_date),
        key=lambda r: r.kickoff,
    )
    yesterday = [ResultStory(result=r, story=result_story(r)) for r in yesterday_results]

    today_fixtures = sorted(
        (f for f in fixtures if to_ist(f.kickoff).date() == digest_date),
        key=lambda f: f.kickoff,
    )
    today = [
        MatchCard(
            fixture=f,
            kickoff_ist=to_ist(f.kickoff),
            kickoff_label=format_ist(f.kickoff),
        )
        for f in today_fixtures
    ]

    if news is not None:
        yesterday_teams = [r.home.name for r in yesterday_results] + [
            r.away.name for r in yesterday_results
        ]
        today_teams = [f.home.name for f in today_fixtures] + [
            f.away.name for f in today_fixtures
        ]
        yesterday_headlines = relevant_headlines(news, yesterday_teams)
        today_headlines = relevant_headlines(news, today_teams)
    else:
        yesterday_headlines = []
        today_headlines = []

    return DailyDigest(
        digest_date=digest_date,
        yesterday=yesterday,
        today=today,
        match_of_the_day=pick_match_of_the_day(today),
        yesterday_headlines=yesterday_headlines,
        today_headlines=today_headlines,
        what_to_watch=pick_what_to_watch(today, results),
    )
