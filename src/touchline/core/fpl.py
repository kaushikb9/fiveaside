"""Pure assembly of the FPL facts bundle the fpl brain consumes. No I/O, no now().

The `ticker` here is shaped exactly like site/data/fpl.json's ticker so the
brain copies it verbatim (FDR is fact, not prose). Player rows are compacted:
the brain gets everyone decision-relevant, not all ~600 elements.
"""

from datetime import UTC, datetime
from zoneinfo import ZoneInfo

from touchline.config import TouchlineConfig
from touchline.sources.fpl import FPLBootstrapResult, FPLElement, FPLFixturesResult

# Compaction: top-N per position by ownership, plus every flagged player
# anyone might plausibly own. ~150-200 rows, ~30 KB in the prompt.
TOP_N_BY_POS = {1: 15, 2: 45, 3: 55, 4: 35}
POS_NAME = {1: "GK", 2: "DEF", 3: "MID", 4: "FWD"}
FLAG_MIN_OWNERSHIP = 0.5  # percent
FLAG_MIN_PRICE = 55  # tenths of £m
NEXT_DEADLINES = 3


def _parse_utc(iso: str) -> datetime:
    dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


def _ownership(element: FPLElement) -> float:
    try:
        return float(element.selected_by_percent)
    except ValueError:
        return 0.0


def _season_label(deadline: datetime) -> str:
    start = deadline.year if deadline.month >= 7 else deadline.year - 1
    return f"{start}/{(start + 1) % 100:02d}"


def _compact_players(
    elements: list[FPLElement],
    short_names: dict[int, str],
    *,
    top_n: dict[int, int] = TOP_N_BY_POS,
) -> list[dict]:
    keep: dict[int, FPLElement] = {}
    for pos, limit in top_n.items():
        ranked = sorted(
            (e for e in elements if e.element_type == pos),
            key=lambda e: (-_ownership(e), -e.now_cost),
        )
        for e in ranked[:limit]:
            keep[e.id] = e
    for e in elements:
        flagged = e.status != "a" and (
            _ownership(e) >= FLAG_MIN_OWNERSHIP or e.now_cost >= FLAG_MIN_PRICE
        )
        if flagged:
            keep[e.id] = e

    rows: list[dict] = []
    for e in sorted(keep.values(), key=lambda e: (e.element_type, -e.now_cost, -_ownership(e))):
        row = {
            "name": e.web_name,
            "team": short_names.get(e.team, str(e.team)),
            "pos": POS_NAME.get(e.element_type, str(e.element_type)),
            "price": e.now_cost / 10,
            "ownership": e.selected_by_percent,
            "form": e.form,
            "points": e.total_points,
        }
        if e.status != "a":
            row["status"] = e.status
        if e.news:
            row["news"] = e.news
        if e.chance_of_playing_next_round is not None:
            row["chance"] = e.chance_of_playing_next_round
        rows.append(row)
    return rows


def _ticker(
    fixtures: FPLFixturesResult,
    short_names: dict[int, str],
    from_gw: int,
    horizon: int,
) -> dict:
    window = range(from_gw, from_gw + horizon)
    per_team: dict[int, list[dict]] = {team_id: [] for team_id in short_names}
    for f in fixtures.fixtures:
        if f.event is None or f.event not in window:
            continue
        if f.team_h in per_team:
            per_team[f.team_h].append(
                {
                    "gw": f.event,
                    "opp": short_names.get(f.team_a, str(f.team_a)),
                    "home": True,
                    "fdr": f.team_h_difficulty,
                }
            )
        if f.team_a in per_team:
            per_team[f.team_a].append(
                {
                    "gw": f.event,
                    "opp": short_names.get(f.team_h, str(f.team_h)),
                    "home": False,
                    "fdr": f.team_a_difficulty,
                }
            )

    rows = []
    for team_id, entries in per_team.items():
        entries.sort(key=lambda e: e["gw"])
        avg = round(sum(e["fdr"] for e in entries) / len(entries), 2) if entries else 0.0
        rows.append({"team": short_names[team_id], "avg": avg, "fixtures": entries})
    rows.sort(key=lambda r: (r["avg"], r["team"]))
    return {"from_gw": from_gw, "gws": horizon, "rows": rows}


def build_fpl_facts(
    bootstrap: FPLBootstrapResult,
    fixtures: FPLFixturesResult,
    config: TouchlineConfig,
    *,
    now: datetime,
) -> dict:
    """Assemble the JSON-ready FPL facts bundle as of `now`."""
    tz = ZoneInfo(config.timezone)
    today = now.astimezone(tz).date()
    short_names = {t.id: t.short_name for t in bootstrap.teams}

    upcoming = sorted(
        (e for e in bootstrap.events if not e.finished and _parse_utc(e.deadline_time) > now),
        key=lambda e: _parse_utc(e.deadline_time),
    )

    gameweek = None
    next_deadlines: list[dict] = []
    season = None
    ticker = None
    if upcoming:
        current = upcoming[0]
        deadline = _parse_utc(current.deadline_time)
        season = _season_label(deadline)
        gameweek = {
            "id": current.id,
            "deadline_utc": current.deadline_time,
            "deadline_local": deadline.astimezone(tz).strftime("%a %d %b, %H:%M"),
        }
        next_deadlines = [
            {
                "gw": e.id,
                "deadline_local": _parse_utc(e.deadline_time).astimezone(tz).strftime(
                    "%a %d %b, %H:%M"
                ),
            }
            for e in upcoming[1 : 1 + NEXT_DEADLINES]
        ]
        ticker = _ticker(fixtures, short_names, current.id, config.fpl.horizon_gws)

    return {
        "date": today.isoformat(),
        "timezone": config.timezone,
        "season": season,
        "gameweek": gameweek,
        "next_deadlines": next_deadlines,
        "teams": [{"name": t.name, "short_name": t.short_name} for t in bootstrap.teams],
        "ticker": ticker,
        "players": _compact_players(bootstrap.elements, short_names),
        "errors": {"bootstrap": bootstrap.error, "fixtures": fixtures.error},
    }
