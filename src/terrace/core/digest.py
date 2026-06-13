"""Pure digest-building logic for Touchline.

This module is pure: it imports only from ``terrace.core.models`` and the
standard library. No I/O, no `datetime.now()` -- time enters only via the
`now` parameter of `build_digest`.
"""

from datetime import UTC, date, datetime, timedelta, timezone

from pydantic import BaseModel

from terrace.core.models import Fixture, Result

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


class DailyDigest(BaseModel, frozen=True):
    digest_date: date
    yesterday: list[ResultStory]
    today: list[MatchCard]
    match_of_the_day: MatchOfTheDay | None


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


def build_digest(fixtures: list[Fixture], results: list[Result], *, now: datetime) -> DailyDigest:
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

    return DailyDigest(
        digest_date=digest_date,
        yesterday=yesterday,
        today=today,
        match_of_the_day=pick_match_of_the_day(today),
    )
