"""Pure assembly of the FPL facts bundle the fpl brain consumes. No I/O, no now().

The `ticker` here is shaped exactly like site/data/fpl.json's ticker so the
brain copies it verbatim (FDR is fact, not prose). Player rows are compacted:
the brain gets everyone decision-relevant, not all ~600 elements.
"""

from datetime import UTC, datetime
from zoneinfo import ZoneInfo

from touchline.config import TouchlineConfig
from touchline.sources.fpl import (
    FPLBootstrapResult,
    FPLElement,
    FPLEntryResult,
    FPLFixturesResult,
)

# Compaction: top-N per position by ownership, plus every flagged player
# anyone might plausibly own. ~150-200 rows, ~30 KB in the prompt.
TOP_N_BY_POS = {1: 15, 2: 45, 3: 55, 4: 35}
POS_NAME = {1: "GK", 2: "DEF", 3: "MID", 4: "FWD"}
FLAG_MIN_OWNERSHIP = 0.5  # percent
FLAG_MIN_PRICE = 55  # tenths of £m
NEXT_DEADLINES = 3

# The template board: how many most-owned names to show per position.
TEMPLATE_N_BY_POS = {1: 3, 2: 5, 3: 5, 4: 4}
CAPTAIN_CANDIDATES = 3

# The player file is the spine every surface filters, so it holds everyone:
# a record exists for every player in the game. Cheap to build, and it means
# no lookup can ever miss. Trim here first if the bundle gets unwieldy.
FILE_MIN_OWNERSHIP = 0.0  # percent — everyone


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


def _template(elements: list[FPLElement], short_names: dict[int, str]) -> list[dict]:
    """Most-owned names per position — the crowd's shape, as fact."""
    groups = []
    for pos, limit in TEMPLATE_N_BY_POS.items():
        ranked = sorted(
            (e for e in elements if e.element_type == pos),
            key=lambda e: (-_ownership(e), -e.now_cost),
        )[:limit]
        groups.append(
            {
                "pos": POS_NAME[pos],
                "rows": [
                    {
                        "name": e.web_name,
                        "team": short_names.get(e.team, str(e.team)),
                        "ownership": _ownership(e),
                        "price": e.now_cost / 10,
                    }
                    for e in ranked
                ],
            }
        )
    return groups


def _captain_poll(
    elements: list[FPLElement], short_names: dict[int, str], most_captained: int | None
) -> dict:
    """The crowd's armband. FPL publishes the most-captained id but no share
    percentages — so we carry ownership (a real number) and never invent a split."""
    by_id = {e.id: e for e in elements}
    row = lambda e: {  # noqa: E731
        "name": e.web_name,
        "team": short_names.get(e.team, str(e.team)),
        "ownership": _ownership(e),
    }
    picked = by_id.get(most_captained) if most_captained else None
    candidates = sorted(
        (e for e in elements if e.element_type in (3, 4)),
        key=lambda e: (-_ownership(e), -e.now_cost),
    )[:CAPTAIN_CANDIDATES]
    if picked is not None and all(c.id != picked.id for c in candidates):
        candidates = [picked, *candidates[: CAPTAIN_CANDIDATES - 1]]
    return {
        "most_captained": row(picked) if picked is not None else None,
        "rows": [row(e) for e in candidates],
    }


def _penalties(elements: list[FPLElement], short_names: dict[int, str]) -> list[dict]:
    """First-choice penalty takers, one row per club that has one on file."""
    rows = []
    for team_id, short in sorted(short_names.items(), key=lambda kv: kv[1]):
        takers = [
            e for e in elements if e.team == team_id and e.penalties_order == 1 and e.status != "u"
        ]
        if not takers:
            continue
        taker = max(takers, key=lambda e: e.now_cost)
        rows.append({"team": short, "taker": taker.web_name, "price": taker.now_cost / 10})
    return rows


def _player_file(
    elements: list[FPLElement],
    short_names: dict[int, str],
    ticker: dict | None,
    owned: dict[int, list[str]],
) -> list[dict]:
    """The player file — one record per player that matters, evidence only.

    The brain adds the verdict, the direction and the trigger on top of these;
    this function never guesses at them.

    Every player in the game gets a record. The file is the spine that the
    pitch, the watchlists and the injury room all filter, so a missing record
    is a dead end in the UI; completeness is worth more than compactness here.
    `FILE_MIN_OWNERSHIP` is the dial to turn if that stops being true.
    """
    fixtures_by_team = {}
    if ticker:
        for row in ticker.get("rows", []):
            fixtures_by_team[row["team"]] = row.get("fixtures", [])[:3]

    keep: dict[int, FPLElement] = {}
    for e in elements:
        own = _ownership(e)
        if e.id in owned or own >= FILE_MIN_OWNERSHIP:
            keep[e.id] = e

    records = []
    for e in sorted(keep.values(), key=lambda e: (-_ownership(e), e.web_name)):
        team = short_names.get(e.team, str(e.team))
        next3 = fixtures_by_team.get(team, [])
        record = {
            "id": e.id,
            "name": e.web_name,
            "team": team,
            "pos": POS_NAME.get(e.element_type, str(e.element_type)),
            "price": e.now_cost / 10,
            "ownership": _ownership(e),
            "points": e.total_points,
            "form": e.form,
            "next3": next3,
            "owned_by": owned.get(e.id, []),
        }
        if next3:
            record["next3_avg"] = round(sum(f["fdr"] for f in next3) / len(next3), 2)
        if e.penalties_order == 1:
            record["penalties"] = True
        if e.status != "a":
            record["status"] = e.status
        if e.news:
            record["news"] = e.news
        if e.chance_of_playing_next_round is not None:
            record["chance"] = e.chance_of_playing_next_round
        records.append(record)
    return records


def _desk(
    entry: FPLEntryResult | None,
    gameweek_id: int | None,
    elements: list[FPLElement] | None = None,
    short_names: dict[int, str] | None = None,
) -> dict | None:
    """The owner's team state, straight from the entry endpoint.

    Picks are resolved to names/positions here so the brain never has to join
    element ids against the player list.
    """
    if entry is None or not entry.ok or not entry.entry:
        return None
    e = entry.entry
    picks = entry.picks or {}
    by_id = {el.id: el for el in elements or []}
    names = short_names or {}
    chips_used = {p.get("name") for p in (e.get("chips") or []) if isinstance(p, dict)}
    desk = {
        "team_name": e.get("name"),
        # No `manager` key by design: the entry payload carries a real name and
        # it stops here. People are identified by nickname, from config.
        "entered": bool(picks.get("picks")),
        "overall_rank": e.get("summary_overall_rank"),
        "total_points": e.get("summary_overall_points"),
        "gw_points": e.get("summary_event_points"),
        "bank": (e.get("last_deadline_bank") or 0) / 10,
        "value": (e.get("last_deadline_value") or 0) / 10,
        "chips_used": sorted(c for c in chips_used if c),
    }
    if picks:
        entry_history = picks.get("entry_history") or {}
        desk["free_transfers"] = entry_history.get("event_transfers")
        desk["gameweek"] = gameweek_id
        # `active_chip` is null on a normal week. When it isn't, it changes how
        # the same set of picks scores, so it travels with them.
        if picks.get("active_chip"):
            desk["active_chip"] = picks["active_chip"]
        if entry_history.get("points_on_bench") is not None:
            desk["bench_points"] = entry_history["points_on_bench"]
        if entry_history.get("event_transfers_cost"):
            desk["transfers_cost"] = entry_history["event_transfers_cost"]
        rows = []
        for p in picks.get("picks") or []:
            el = by_id.get(p.get("element"))
            position = p.get("position") or 0
            row = {
                "element": p.get("element"),
                "position": position,
                "role": "bench" if position > 11 else "start",
            }
            if position > 11:
                row["bench_order"] = position - 11
            if el is not None:
                row.update(
                    {
                        "name": el.web_name,
                        "team": names.get(el.team, str(el.team)),
                        "pos": POS_NAME.get(el.element_type, str(el.element_type)),
                        "price": el.now_cost / 10,
                    }
                )
                if el.status != "a":
                    row["status"] = el.status
            if p.get("is_captain"):
                row["captain"] = True
            if p.get("is_vice_captain"):
                row["vice"] = True
            # The multiplier is the chip's fingerprint: 2 for a normal captain,
            # 3 under Triple Captain, and 1 on a bench slot that Bench Boost has
            # switched on. Carrying it means the page never has to infer which
            # chip was played in order to score a squad.
            multiplier = p.get("multiplier")
            if isinstance(multiplier, int) and multiplier != 1:
                row["multiplier"] = multiplier
            rows.append(row)
        desk["picks"] = rows
    return desk


def _leagues(
    entry: FPLEntryResult | None, entry_id: int | None, nicks: dict[int, str] | None = None
) -> list[dict]:
    """Mini-league standings, trimmed to what the page renders.

    The API returns every manager's real name in `player_name`. It is dropped
    here and never travels further — members of the group are identified by
    nickname, everyone else by their team name alone.
    """
    if entry is None or not entry.ok:
        return []
    nicks = nicks or {}
    out = []
    for league in entry.leagues:
        rows = [
            {
                "rank": r.get("rank"),
                "name": r.get("entry_name"),
                "entry": r.get("entry"),
                "total": r.get("total"),
                "event_total": r.get("event_total"),
                "is_owner": r.get("entry") == entry_id,
                **({"nick": nicks[r["entry"]]} if r.get("entry") in nicks else {}),
            }
            for r in league["results"]
        ]
        out.append({"id": league["id"], "name": league["name"], "rows": rows})
    return out


def build_fpl_facts(
    bootstrap: FPLBootstrapResult,
    fixtures: FPLFixturesResult,
    config: TouchlineConfig,
    *,
    now: datetime,
    entry: FPLEntryResult | None = None,
    people: dict[str, FPLEntryResult] | None = None,
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

    # The gameweek currently being played — distinct from the one being planned
    # for. During GW1's matches, `gameweek` is GW2 (next deadline) while
    # `live_gameweek` is GW1: the live view follows this one.
    playing = next((e for e in bootstrap.events if e.is_current), None)
    live_gameweek = {"id": playing.id, "finished": playing.finished} if playing else None
    most_captained = playing.most_captained if playing else None
    if most_captained is None and upcoming:
        most_captained = upcoming[0].most_captained

    nicks = {p.entry: p.nick for p in config.fpl.people}

    # Who among the group owns whom — free to compute, and the seed of every
    # comparison (and every roast) the page will ever make.
    owned: dict[int, list[str]] = {}
    squads: list[dict] = []
    for person, result in (people or {}).items():
        desk = _desk(result, playing.id if playing else None, bootstrap.elements, short_names)
        if desk is None:
            continue
        desk["nick"] = person
        squads.append(desk)
        for pick in desk.get("picks") or []:
            if pick.get("element"):
                owned.setdefault(pick["element"], []).append(person)

    return {
        "date": today.isoformat(),
        "timezone": config.timezone,
        "season": season,
        "gameweek": gameweek,
        "live_gameweek": live_gameweek,
        "next_deadlines": next_deadlines,
        "teams": [{"name": t.name, "short_name": t.short_name} for t in bootstrap.teams],
        "ticker": ticker,
        "captain_poll": _captain_poll(bootstrap.elements, short_names, most_captained),
        "desk": _desk(entry, playing.id if playing else None, bootstrap.elements, short_names),
        "squads": squads,
        "leagues": _leagues(entry, config.fpl.team_id, nicks),
        "player_file": _player_file(bootstrap.elements, short_names, ticker, owned),
        "players": _compact_players(bootstrap.elements, short_names),
        "errors": {
            "bootstrap": bootstrap.error,
            "fixtures": fixtures.error,
            "entry": entry.error if entry else None,
        },
    }
