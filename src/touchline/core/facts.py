"""Pure assembly of the facts bundle the brain consumes. No I/O, no now()."""

from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from touchline.config import ClubConfig, TouchlineConfig
from touchline.core.models import Fixture, MatchStatus, Result, Standing, Team
from touchline.sources.base import SourceResult, StandingsResult

UPCOMING_LIMIT = 5
# The page covers the league, not one club, so every fixture is fair game.
# The cap only exists to stop a 380-match season landing in one prompt.
NON_CLUB_ROW_CAP = 20
FORM_CLUBS_LIMIT = 5
FORM_LIMIT = 5


def _local(dt: datetime, tz: ZoneInfo) -> datetime:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.astimezone(tz)


def _is_club(team: Team, club: ClubConfig) -> bool:
    return team.code == club.code or team.name.lower() == club.name.lower()


def _involves_club(match: Fixture | Result, club: ClubConfig) -> bool:
    return _is_club(match.home, club) or _is_club(match.away, club)


def _result_row(r: Result, club: ClubConfig, tz: ZoneInfo) -> dict:
    return {
        "home": r.home.name,
        "away": r.away.name,
        "score": f"{r.home_score}–{r.away_score}",
        "date": _local(r.kickoff, tz).strftime("%a %d %b"),
        "competition": r.competition.code,
        "club_involved": _involves_club(r, club),
        "home_crest": r.home.crest,
        "away_crest": r.away.crest,
    }


def _fixture_row(f: Fixture, club: ClubConfig, tz: ZoneInfo) -> dict:
    return {
        "home": f.home.name,
        "away": f.away.name,
        "kickoff_local": _local(f.kickoff, tz).strftime("%H:%M"),
        "status": f.status.value,
        "competition": f.competition.code,
        "club_involved": _involves_club(f, club),
        "home_crest": f.home.crest,
        "away_crest": f.away.crest,
    }


def _table_rows(standings: list[Standing]) -> list[dict]:
    return [
        {
            "pos": s.position,
            "team": s.team.name,
            "played": s.played,
            "points": s.points,
            "gd": s.goal_difference,
            "crest": s.team.crest,
        }
        for s in sorted(standings, key=lambda s: s.position)
    ]


def _club_form(results: list[Result], club: ClubConfig, tz: ZoneInfo) -> list[dict]:
    involved = sorted(
        (r for r in results if _involves_club(r, club)),
        key=lambda r: r.kickoff,
        reverse=True,
    )[:FORM_LIMIT]
    form: list[dict] = []
    for r in involved:
        at_home = _is_club(r.home, club)
        us = r.home_score if at_home else r.away_score
        them = r.away_score if at_home else r.home_score
        opponent = r.away if at_home else r.home
        form.append(
            {
                "result": "W" if us > them else "L" if us < them else "D",
                "score": f"{us}–{them}",
                "opponent": opponent.name,
                "at_home": at_home,
                "competition": r.competition.code,
                "date": _local(r.kickoff, tz).date().isoformat(),
                "opponent_crest": opponent.crest,
            }
        )
    return form


def _cap_non_club(rows: list[dict]) -> list[dict]:
    """Keep every club row; cap the rest at NON_CLUB_ROW_CAP, preserving order."""
    kept: list[dict] = []
    non_club = 0
    for row in rows:
        if row["club_involved"]:
            kept.append(row)
        elif non_club < NON_CLUB_ROW_CAP:
            kept.append(row)
            non_club += 1
    return kept


def _competition_name(code: str, matches: SourceResult) -> str:
    if matches.fixtures:
        return matches.fixtures[0].competition.name
    if matches.results:
        return matches.results[0].competition.name
    return code


def _focus_clubs(
    comp_data: list[tuple[str, SourceResult, StandingsResult]],
    config: TouchlineConfig,
    tz: ZoneInfo,
    today,
) -> list[dict]:
    """Per-club shape for the clubs the page always covers.

    The digest used to be one club's page with rivals attached; it is now a
    league page, so every focus club gets the same treatment the owner's club
    used to get exclusively — position, form, and what is next.
    """
    names = [c.name for c in config.top_clubs if c.name]
    if config.club.name not in names:
        names = [config.club.name, *names]

    standings_by_name: dict[str, Standing] = {}
    results: list[Result] = []
    fixtures: list[Fixture] = []
    for _code, matches, standings in comp_data:
        results.extend(matches.results)
        fixtures.extend(matches.fixtures)
        for s in standings.standings:
            standings_by_name.setdefault(s.team.name.lower(), s)

    out = []
    for name in names:
        key = name.lower()
        row = standings_by_name.get(key)
        played = [
            r
            for r in results
            if r.home.name.lower() == key or r.away.name.lower() == key
        ]
        played.sort(key=lambda r: r.kickoff, reverse=True)
        form = []
        for r in played[:FORM_CLUBS_LIMIT]:
            at_home = r.home.name.lower() == key
            us = r.home_score if at_home else r.away_score
            them = r.away_score if at_home else r.home_score
            form.append(
                {
                    "result": "W" if us > them else "L" if us < them else "D",
                    "score": f"{us}–{them}",
                    "opponent": (r.away if at_home else r.home).name,
                    "at_home": at_home,
                    "competition": r.competition.code,
                }
            )
        upcoming = sorted(
            (
                f
                for f in fixtures
                if (f.home.name.lower() == key or f.away.name.lower() == key)
                and f.status == MatchStatus.SCHEDULED
                and _local(f.kickoff, tz).date() >= today
            ),
            key=lambda f: f.kickoff,
        )
        nxt = None
        if upcoming:
            f = upcoming[0]
            at_home = f.home.name.lower() == key
            nxt = {
                "opponent": (f.away if at_home else f.home).name,
                "at_home": at_home,
                "kickoff_local": _local(f.kickoff, tz).strftime("%a %d %b %H:%M"),
                "competition": f.competition.code,
            }
        out.append(
            {
                "name": name,
                "crest": next(
                    (c.crest for c in config.top_clubs if c.name == name),
                    config.club.crest if name == config.club.name else None,
                ),
                "position": row.position if row else None,
                "points": row.points if row else None,
                "played": row.played if row else None,
                "form": form,
                "next": nxt,
            }
        )
    return out


def build_facts(
    comp_data: list[tuple[str, SourceResult, StandingsResult]],
    config: TouchlineConfig,
    *,
    now: datetime,
) -> dict:
    """Assemble the JSON-ready facts bundle for `now`'s calendar day in the owner's timezone."""
    tz = ZoneInfo(config.timezone)
    today = _local(now, tz).date()
    yesterday = today - timedelta(days=1)
    club = config.club

    competitions: list[dict] = []
    upcoming_candidates: list[tuple[datetime, dict]] = []
    all_results: list[Result] = []

    for code, matches, standings in comp_data:
        all_results.extend(matches.results)
        club_row = next((s for s in standings.standings if _is_club(s.team, club)), None)

        competitions.append(
            {
                "code": code,
                "name": _competition_name(code, matches),
                "yesterday_results": _cap_non_club(
                    [
                        _result_row(r, club, tz)
                        for r in sorted(matches.results, key=lambda r: r.kickoff)
                        if _local(r.kickoff, tz).date() == yesterday
                    ]
                ),
                "today_matches": _cap_non_club(
                    [
                        _fixture_row(f, club, tz)
                        for f in sorted(matches.fixtures, key=lambda f: f.kickoff)
                        if _local(f.kickoff, tz).date() == today
                    ]
                ),
                "table": _table_rows(standings.standings),
                "club_position": (
                    {"pos": club_row.position, "points": club_row.points, "played": club_row.played}
                    if club_row is not None
                    else None
                ),
                "errors": {"matches": matches.error, "standings": standings.error},
            }
        )

        for f in matches.fixtures:
            f_date = _local(f.kickoff, tz).date()
            if _involves_club(f, club) and f.status == MatchStatus.SCHEDULED and f_date > today:
                upcoming_candidates.append(
                    (
                        f.kickoff,
                        {
                            "opponent": f.away.name if _is_club(f.home, club) else f.home.name,
                            "opponent_crest": (
                                f.away.crest if _is_club(f.home, club) else f.home.crest
                            ),
                            "at_home": _is_club(f.home, club),
                            "kickoff_local": _local(f.kickoff, tz).strftime("%a %d %b %H:%M"),
                            "competition": f.competition.code,
                        },
                    )
                )

    upcoming_candidates.sort(key=lambda pair: pair[0])
    club_upcoming = [row for _, row in upcoming_candidates[:UPCOMING_LIMIT]]

    return {
        "date": today.isoformat(),
        "timezone": config.timezone,
        "club": {"name": club.name, "code": club.code},
        "competitions": competitions,
        "club_form": _club_form(all_results, club, tz),
        "club_upcoming": club_upcoming,
        "focus": _focus_clubs(comp_data, config, tz, today),
    }
