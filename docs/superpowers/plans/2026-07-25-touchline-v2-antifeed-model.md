# Touchline v2 (antifeed model) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild Touchline as a self-hostable one-page-a-day football companion: static site + `digests.json` on Cloudflare Pages, a local daily brain (headless Claude Code) that writes the prose, and the Python package shrunk to a `touchline facts` CLI.

**Architecture:** Three parts with one boundary rule — *Python produces facts, the brain produces prose, the site produces pixels.* `src/touchline/` fetches structured data (football-data.org) and emits a JSON facts bundle; `brain/curate.sh` runs headless Claude with that bundle + discourse feeds and appends one entry per day to `site/data/digests.json`; `site/` is a no-framework static reader deployed via wrangler. Spec: `docs/superpowers/specs/2026-07-25-touchline-v2-antifeed-model-design.md`. Reference implementation of the model: `../antifeed`.

**Tech Stack:** Python ≥3.12 (pydantic v2, httpx, pytest, ruff, uv), vanilla HTML/CSS/JS (no framework, no build step), Node (validation script only), Cloudflare Pages via wrangler, headless Claude Code (`claude -p`).

## Global Constraints

- Python `requires-python = ">=3.12"`; runtime deps after this plan: **pydantic, httpx only** (fastapi/jinja2/uvicorn removed).
- All Python commands via `uv run ...`; suite must be green (`uv run pytest -q`) at the end of every task.
- Ruff config stays as-is (line-length 100, `E,F,I,B,UP`); run `uv run ruff check .` before each commit.
- `site/` must work with zero build step: static files only, JS is plain ES2020, no external CDNs.
- `site/data/digests.json` is **append-only**: one entry per date, past entries never edited. Top-level shape `{"digests": [...]}`.
- `site/data/config.json` is generated (copied from `touchline.config.json`) — gitignored, never hand-edited.
- Timezone handling uses stdlib `zoneinfo`; no hardcoded IST anywhere.
- football-data.org token comes from env var `FOOTBALL_DATA_TOKEN` (never committed).
- Commit at the end of every task; commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## File Structure (end state)

```
touchline.config.json        # owner preferences (club, competitions, timezone, feeds, voice)
wrangler.toml                # Cloudflare Pages config (output dir: site)
deploy.sh                    # copy config into site/data, wrangler pages deploy
site/
  index.html  style.css  app.js  icon.svg
  data/digests.json          # the database ({"digests": []} at seed)
  data/config.json           # generated, gitignored
brain/
  prompt.md                  # curation prompt (voice, schema, rules)
  sources.md                 # editable source list
  curate.sh                  # daily run: facts -> claude -p -> validate -> commit -> deploy
  validate.mjs               # digests.json schema check
src/touchline/
  __init__.py  cli.py  config.py
  core/__init__.py  core/models.py  core/facts.py
  sources/__init__.py  sources/base.py  sources/football_data.py
tests/
  test_scaffold.py  test_models.py  test_football_data.py
  test_config.py  test_facts.py  test_cli.py
  fixtures/football_data/wc_matches.json  wc_standings.json
```

---

### Task 1: Baggage removal — retire v1 surfaces and nightshift artifacts

**Files:**
- Delete: `src/touchline/web/` (whole dir), `src/touchline/render/` (whole dir), `src/touchline/core/digest.py`, `src/touchline/sources/rss.py`
- Delete: `tests/test_web.py`, `tests/test_render.py`, `tests/test_digest.py`, `tests/test_rss.py`, `tests/test_match_detail.py`, `tests/test_cli.py`, `tests/fixtures/match_detail/` (dir), `tests/fixtures/news/` (dir)
- Delete: `AGENTS.md`, `MEMORY.md`, `ROADMAP.md`, `rubrics/` (dir), `docs/reviews/` (dir)
- Modify: `src/touchline/core/models.py` (remove `NewsItem`, `Referee`, `HeadToHead`, `MatchDetail`)
- Modify: `src/touchline/sources/base.py` (remove `NewsResult`, `NewsSource`, `MatchDetailResult`, `MatchDetailSource`)
- Modify: `src/touchline/sources/football_data.py` (remove `_parse_match_detail`, `fetch_match_detail`, now-unused imports)
- Modify: `src/touchline/cli.py` (strip to argparse skeleton)
- Modify: `pyproject.toml` (drop fastapi, jinja2, uvicorn)

**Interfaces:**
- Consumes: nothing.
- Produces: a trimmed package where `touchline.core.models` exports exactly `MatchStatus, Team, Competition, Fixture, Result, Standing`, and `touchline.sources.base` exports exactly `SourceResult, MatchSource, StandingsResult, StandingsSource`. Later tasks import only these.

- [ ] **Step 1: Delete retired files and dirs**

```bash
git rm -r src/touchline/web src/touchline/render
git rm src/touchline/core/digest.py src/touchline/sources/rss.py
git rm tests/test_web.py tests/test_render.py tests/test_digest.py tests/test_rss.py tests/test_match_detail.py tests/test_cli.py
git rm -r tests/fixtures/match_detail tests/fixtures/news
git rm AGENTS.md MEMORY.md ROADMAP.md
git rm -r rubrics docs/reviews
```

- [ ] **Step 2: Trim `core/models.py`** — delete the `NewsItem`, `Referee`, `HeadToHead`, and `MatchDetail` classes (everything from `class NewsItem` to end of file). The file ends after `Standing.goal_difference`. Update the module docstring's second sentence to: `Every model is competition-agnostic.`

- [ ] **Step 3: Trim `sources/base.py`** — delete the `NewsResult`, `NewsSource`, `MatchDetailResult`, and `MatchDetailSource` classes and drop `MatchDetail, NewsItem` from the models import so it reads:

```python
from touchline.core.models import Fixture, Result, Standing
```

- [ ] **Step 4: Trim `sources/football_data.py`** — delete `_parse_match_detail` and the `fetch_match_detail` method; remove `HeadToHead`, `MatchDetail`, `Referee` from the models import and `MatchDetailResult` from the base import.

- [ ] **Step 5: Strip `cli.py` to a skeleton** (the `facts` command arrives in Task 4):

```python
"""Command-line interface for Touchline."""

import argparse


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="touchline")
    parser.add_subparsers(dest="command")
    parser.parse_args(argv)
    parser.print_help()
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 6: Trim `pyproject.toml` dependencies** to:

```toml
dependencies = [
  "pydantic>=2.0",
  "httpx>=0.27",
]
```

- [ ] **Step 7: Sync and verify green**

Run: `uv sync && uv run pytest -q && uv run ruff check .`
Expected: all remaining tests pass (`test_scaffold`, `test_models`, `test_football_data`), ruff clean. If `test_football_data.py` references match-detail behavior, delete those specific test functions (matches/standings tests stay).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor!: retire v1 web/render/rss/match-detail surfaces and nightshift artifacts"
```

---

### Task 2: Owner preferences — `touchline.config.json` + loader

**Files:**
- Create: `src/touchline/config.py`
- Create: `touchline.config.json`
- Test: `tests/test_config.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `touchline.config.TouchlineConfig` (fields: `club: ClubConfig {name: str, code: str, subreddit: str | None}`, `competitions: list[str]` (min 1), `timezone: str = "UTC"`, `feeds: list[FeedConfig {label, url}] = []`, `voice: str = ""`) and `load_config(path: str | Path = "touchline.config.json") -> TouchlineConfig`. Tasks 3, 4, 7 depend on these exact names.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_config.py
import json

import pytest
from pydantic import ValidationError

from touchline.config import TouchlineConfig, load_config

EXAMPLE = {
    "club": {"name": "Chelsea", "code": "CHE", "subreddit": "chelseafc"},
    "competitions": ["PL", "CL"],
    "timezone": "Asia/Kolkata",
    "feeds": [
        {"label": "The Guardian Football", "url": "https://www.theguardian.com/football/rss"}
    ],
    "voice": "calm, sharp, no hype",
}


def test_load_config_roundtrip(tmp_path):
    path = tmp_path / "touchline.config.json"
    path.write_text(json.dumps(EXAMPLE), encoding="utf-8")
    cfg = load_config(path)
    assert cfg.club.name == "Chelsea"
    assert cfg.club.code == "CHE"
    assert cfg.club.subreddit == "chelseafc"
    assert cfg.competitions == ["PL", "CL"]
    assert cfg.timezone == "Asia/Kolkata"
    assert cfg.feeds[0].label == "The Guardian Football"
    assert cfg.voice.startswith("calm")


def test_defaults_are_optional(tmp_path):
    path = tmp_path / "touchline.config.json"
    path.write_text(
        json.dumps({"club": {"name": "Chelsea", "code": "CHE"}, "competitions": ["PL"]}),
        encoding="utf-8",
    )
    cfg = load_config(path)
    assert cfg.timezone == "UTC"
    assert cfg.feeds == []
    assert cfg.voice == ""
    assert cfg.club.subreddit is None


def test_empty_competitions_rejected():
    with pytest.raises(ValidationError):
        TouchlineConfig(club={"name": "Chelsea", "code": "CHE"}, competitions=[])


def test_repo_config_is_valid():
    cfg = load_config("touchline.config.json")
    assert cfg.competitions
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_config.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'touchline.config'`

- [ ] **Step 3: Implement `src/touchline/config.py`**

```python
"""Owner preferences: loading touchline.config.json."""

from pathlib import Path

from pydantic import BaseModel, Field


class ClubConfig(BaseModel, frozen=True):
    name: str
    code: str  # football-data.org team TLA, e.g. "CHE"
    subreddit: str | None = None


class FeedConfig(BaseModel, frozen=True):
    label: str
    url: str


class TouchlineConfig(BaseModel, frozen=True):
    club: ClubConfig
    competitions: list[str] = Field(min_length=1)
    timezone: str = "UTC"
    feeds: list[FeedConfig] = []
    voice: str = ""


def load_config(path: str | Path = "touchline.config.json") -> TouchlineConfig:
    return TouchlineConfig.model_validate_json(Path(path).read_text(encoding="utf-8"))
```

- [ ] **Step 4: Create `touchline.config.json`** (KB's own deployment; self-hosters edit this):

```json
{
  "club": { "name": "Chelsea", "code": "CHE", "subreddit": "chelseafc" },
  "competitions": ["PL", "CL"],
  "timezone": "Asia/Kolkata",
  "feeds": [
    { "label": "The Guardian Football", "url": "https://www.theguardian.com/football/rss" },
    { "label": "BBC Football", "url": "https://feeds.bbci.co.uk/sport/football/rss.xml" }
  ],
  "voice": "calm, sharp, no hype; written for a fan who missed the day, not a stranger"
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `uv run pytest tests/test_config.py -v && uv run ruff check .`
Expected: 4 PASS, ruff clean.

- [ ] **Step 6: Commit**

```bash
git add src/touchline/config.py touchline.config.json tests/test_config.py
git commit -m "feat: owner preferences via touchline.config.json"
```

---

### Task 3: Facts assembly — `core/facts.py`

**Files:**
- Create: `src/touchline/core/facts.py`
- Test: `tests/test_facts.py`

**Interfaces:**
- Consumes: `TouchlineConfig`/`ClubConfig` (Task 2); `Fixture, Result, Standing, Team, MatchStatus` and `SourceResult, StandingsResult` (Task 1's trimmed modules).
- Produces: `build_facts(comp_data: list[tuple[str, SourceResult, StandingsResult]], config: TouchlineConfig, *, now: datetime) -> dict`. The returned dict's exact keys (documented in the code below) are consumed by Task 4 (serialization) and Task 7 (the brain prompt describes them).

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_facts.py
from datetime import UTC, datetime

from touchline.config import ClubConfig, TouchlineConfig
from touchline.core.facts import build_facts
from touchline.core.models import Competition, Fixture, MatchStatus, Result, Standing, Team
from touchline.sources.base import SourceResult, StandingsResult

PL = Competition(code="PL", name="Premier League")
CHELSEA = Team(name="Chelsea", code="CHE")
ARSENAL = Team(name="Arsenal", code="ARS")
SPURS = Team(name="Tottenham", code="TOT")
VILLA = Team(name="Aston Villa", code="AVL")

CONFIG = TouchlineConfig(
    club=ClubConfig(name="Chelsea", code="CHE"),
    competitions=["PL"],
    timezone="Asia/Kolkata",
)

# 09:00 IST on Sun 16 Aug 2026 — a normal morning-coffee run.
NOW = datetime(2026, 8, 16, 3, 30, tzinfo=UTC)


def _result(id_, kickoff, home, away, hs, as_):
    return Result(
        id=id_, competition=PL, kickoff=kickoff, home=home, away=away,
        home_score=hs, away_score=as_,
    )


def _fixture(id_, kickoff, home, away, status=MatchStatus.SCHEDULED):
    return Fixture(id=id_, competition=PL, kickoff=kickoff, home=home, away=away, status=status)


def _standing(pos, team, points):
    return Standing(
        competition=PL, position=pos, team=team, played=1, won=1, draw=0,
        lost=0, points=points, goals_for=2, goals_against=1,
    )


def _bundle(fixtures=(), results=(), standings=(), m_err=None, s_err=None):
    return build_facts(
        [(
            "PL",
            SourceResult(ok=m_err is None, fixtures=list(fixtures), results=list(results), error=m_err),
            StandingsResult(ok=s_err is None, standings=list(standings), error=s_err),
        )],
        CONFIG,
        now=NOW,
    )


def test_buckets_yesterday_today_and_upcoming():
    yesterday_r = _result("r1", datetime(2026, 8, 15, 14, 0, tzinfo=UTC), CHELSEA, ARSENAL, 2, 1)
    today_f = _fixture("f1", datetime(2026, 8, 16, 14, 0, tzinfo=UTC), SPURS, VILLA)
    upcoming_f = _fixture("f2", datetime(2026, 8, 18, 14, 0, tzinfo=UTC), VILLA, CHELSEA)
    far_f = _fixture("f3", datetime(2026, 9, 20, 14, 0, tzinfo=UTC), CHELSEA, SPURS)

    facts = _bundle(
        fixtures=[today_f, upcoming_f, far_f],
        results=[yesterday_r],
        standings=[_standing(1, CHELSEA, 3), _standing(2, ARSENAL, 0)],
    )

    assert facts["date"] == "2026-08-16"
    assert facts["timezone"] == "Asia/Kolkata"
    assert facts["club"] == {"name": "Chelsea", "code": "CHE"}

    comp = facts["competitions"][0]
    assert comp["code"] == "PL"
    assert comp["yesterday_results"] == [
        {"home": "Chelsea", "away": "Arsenal", "score": "2–1",
         "competition": "PL", "club_involved": True}
    ]
    assert comp["today_matches"] == [
        {"home": "Tottenham", "away": "Aston Villa", "kickoff_local": "19:30",
         "status": "SCHEDULED", "competition": "PL", "club_involved": False}
    ]
    assert comp["table"][0] == {"pos": 1, "team": "Chelsea", "played": 1, "points": 3, "gd": 1}
    assert comp["club_position"] == {"pos": 1, "points": 3, "played": 1}
    assert comp["errors"] == {"matches": None, "standings": None}

    # Only f2 is within the 14-day horizon; f3 is beyond it.
    assert facts["club_upcoming"] == [
        {"opponent": "Aston Villa", "at_home": False,
         "kickoff_local": "Tue 18 Aug 19:30", "competition": "PL"}
    ]


def test_club_form_is_newest_first_from_clubs_perspective():
    older_away_win = _result("r1", datetime(2026, 8, 8, 14, 0, tzinfo=UTC), VILLA, CHELSEA, 0, 2)
    newer_home_draw = _result("r2", datetime(2026, 8, 15, 14, 0, tzinfo=UTC), CHELSEA, SPURS, 1, 1)
    not_ours = _result("r3", datetime(2026, 8, 15, 16, 0, tzinfo=UTC), ARSENAL, VILLA, 3, 0)

    facts = _bundle(results=[older_away_win, newer_home_draw, not_ours])

    assert facts["club_form"] == [
        {"result": "D", "score": "1–1", "opponent": "Tottenham", "at_home": True,
         "competition": "PL", "date": "2026-08-15"},
        {"result": "W", "score": "2–0", "opponent": "Aston Villa", "at_home": False,
         "competition": "PL", "date": "2026-08-08"},
    ]


def test_naive_kickoffs_are_treated_as_utc():
    r = _result("r1", datetime(2026, 8, 15, 14, 0), CHELSEA, ARSENAL, 1, 0)
    facts = _bundle(results=[r])
    assert len(facts["competitions"][0]["yesterday_results"]) == 1


def test_source_errors_are_surfaced_not_hidden():
    facts = _bundle(m_err="boom", s_err="kaboom")
    comp = facts["competitions"][0]
    assert comp["errors"] == {"matches": "boom", "standings": "kaboom"}
    assert comp["yesterday_results"] == []
    assert comp["table"] == []
    assert comp["club_position"] is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_facts.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'touchline.core.facts'`

- [ ] **Step 3: Implement `src/touchline/core/facts.py`**

```python
"""Pure assembly of the facts bundle the brain consumes. No I/O, no now()."""

from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from touchline.config import ClubConfig, TouchlineConfig
from touchline.core.models import Fixture, MatchStatus, Result, Standing, Team
from touchline.sources.base import SourceResult, StandingsResult

UPCOMING_HORIZON_DAYS = 14
FORM_LIMIT = 5


def _local(dt: datetime, tz: ZoneInfo) -> datetime:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.astimezone(tz)


def _is_club(team: Team, club: ClubConfig) -> bool:
    return team.code == club.code or team.name.lower() == club.name.lower()


def _involves_club(match: Fixture | Result, club: ClubConfig) -> bool:
    return _is_club(match.home, club) or _is_club(match.away, club)


def _result_row(r: Result, club: ClubConfig) -> dict:
    return {
        "home": r.home.name,
        "away": r.away.name,
        "score": f"{r.home_score}–{r.away_score}",
        "competition": r.competition.code,
        "club_involved": _involves_club(r, club),
    }


def _fixture_row(f: Fixture, club: ClubConfig, tz: ZoneInfo) -> dict:
    return {
        "home": f.home.name,
        "away": f.away.name,
        "kickoff_local": _local(f.kickoff, tz).strftime("%H:%M"),
        "status": f.status.value,
        "competition": f.competition.code,
        "club_involved": _involves_club(f, club),
    }


def _table_rows(standings: list[Standing]) -> list[dict]:
    return [
        {
            "pos": s.position,
            "team": s.team.name,
            "played": s.played,
            "points": s.points,
            "gd": s.goal_difference,
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
        form.append(
            {
                "result": "W" if us > them else "L" if us < them else "D",
                "score": f"{us}–{them}",
                "opponent": r.away.name if at_home else r.home.name,
                "at_home": at_home,
                "competition": r.competition.code,
                "date": _local(r.kickoff, tz).date().isoformat(),
            }
        )
    return form


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
    horizon = today + timedelta(days=UPCOMING_HORIZON_DAYS)
    club = config.club

    competitions: list[dict] = []
    club_upcoming: list[dict] = []
    all_results: list[Result] = []

    for code, matches, standings in comp_data:
        all_results.extend(matches.results)
        club_row = next((s for s in standings.standings if _is_club(s.team, club)), None)

        competitions.append(
            {
                "code": code,
                "yesterday_results": [
                    _result_row(r, club)
                    for r in sorted(matches.results, key=lambda r: r.kickoff)
                    if _local(r.kickoff, tz).date() == yesterday
                ],
                "today_matches": [
                    _fixture_row(f, club, tz)
                    for f in sorted(matches.fixtures, key=lambda f: f.kickoff)
                    if _local(f.kickoff, tz).date() == today
                ],
                "table": _table_rows(standings.standings),
                "club_position": (
                    {"pos": club_row.position, "points": club_row.points, "played": club_row.played}
                    if club_row is not None
                    else None
                ),
                "errors": {"matches": matches.error, "standings": standings.error},
            }
        )

        for f in sorted(matches.fixtures, key=lambda f: f.kickoff):
            f_date = _local(f.kickoff, tz).date()
            if (
                _involves_club(f, club)
                and f.status == MatchStatus.SCHEDULED
                and today < f_date <= horizon
            ):
                club_upcoming.append(
                    {
                        "opponent": f.away.name if _is_club(f.home, club) else f.home.name,
                        "at_home": _is_club(f.home, club),
                        "kickoff_local": _local(f.kickoff, tz).strftime("%a %d %b %H:%M"),
                        "competition": f.competition.code,
                    }
                )

    return {
        "date": today.isoformat(),
        "timezone": config.timezone,
        "club": {"name": club.name, "code": club.code},
        "competitions": competitions,
        "club_form": _club_form(all_results, club, tz),
        "club_upcoming": club_upcoming,
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_facts.py -v && uv run ruff check .`
Expected: 4 PASS, ruff clean. Note `%a %d %b` is portable (no `%-d`).

- [ ] **Step 5: Commit**

```bash
git add src/touchline/core/facts.py tests/test_facts.py
git commit -m "feat: pure facts bundle assembly in core/facts.py"
```

---

### Task 4: `touchline facts` CLI

**Files:**
- Modify: `src/touchline/cli.py`
- Test: `tests/test_cli.py` (new file — the old one was deleted in Task 1)

**Interfaces:**
- Consumes: `load_config`/`TouchlineConfig` (Task 2), `build_facts` (Task 3), `FootballDataClient` (existing), `MatchSource`/`StandingsSource` protocols (Task 1).
- Produces: `run_facts(source, config, *, now: datetime | None = None) -> str` (JSON string) and the `touchline facts [--config PATH]` command. Task 7's `curate.sh` calls `uv run touchline facts`.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_cli.py
import json
from datetime import UTC, datetime

from touchline.cli import main, run_facts
from touchline.config import ClubConfig, TouchlineConfig
from touchline.core.models import Competition, Fixture, MatchStatus, Team
from touchline.sources.base import SourceResult, StandingsResult

PL = Competition(code="PL", name="Premier League")
CONFIG = TouchlineConfig(
    club=ClubConfig(name="Chelsea", code="CHE"),
    competitions=["PL", "CL"],
    timezone="Asia/Kolkata",
)
NOW = datetime(2026, 8, 16, 3, 30, tzinfo=UTC)


class FakeSource:
    def __init__(self):
        self.requested: list[str] = []

    def fetch_matches(self, competition: str) -> SourceResult:
        self.requested.append(competition)
        fixture = Fixture(
            id="f1", competition=PL, kickoff=datetime(2026, 8, 16, 14, 0, tzinfo=UTC),
            home=Team(name="Chelsea", code="CHE"), away=Team(name="Arsenal", code="ARS"),
            status=MatchStatus.SCHEDULED,
        )
        return SourceResult(ok=True, fixtures=[fixture], results=[])

    def fetch_standings(self, competition: str) -> StandingsResult:
        return StandingsResult(ok=True, standings=[])


def test_run_facts_returns_json_bundle_for_each_competition():
    source = FakeSource()
    out = run_facts(source, CONFIG, now=NOW)
    bundle = json.loads(out)
    assert source.requested == ["PL", "CL"]
    assert bundle["date"] == "2026-08-16"
    assert [c["code"] for c in bundle["competitions"]] == ["PL", "CL"]
    assert bundle["competitions"][0]["today_matches"][0]["club_involved"] is True


def test_main_without_command_prints_help_and_exits_2(capsys):
    assert main([]) == 2
    assert "facts" in capsys.readouterr().out


def test_main_facts_uses_config_path(tmp_path, capsys, monkeypatch):
    config_path = tmp_path / "touchline.config.json"
    config_path.write_text(
        json.dumps({"club": {"name": "Chelsea", "code": "CHE"}, "competitions": ["PL"]}),
        encoding="utf-8",
    )
    import touchline.cli as cli

    monkeypatch.setattr(cli, "FootballDataClient", lambda: FakeSource())
    assert main(["facts", "--config", str(config_path)]) == 0
    bundle = json.loads(capsys.readouterr().out)
    assert bundle["club"]["code"] == "CHE"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_cli.py -v`
Expected: FAIL with `ImportError: cannot import name 'run_facts'`

- [ ] **Step 3: Implement `src/touchline/cli.py`**

```python
"""Command-line interface for Touchline: the facts bundle."""

import argparse
import json
from datetime import UTC, datetime

from touchline.config import TouchlineConfig, load_config
from touchline.core.facts import build_facts
from touchline.sources.football_data import FootballDataClient


def run_facts(source, config: TouchlineConfig, *, now: datetime | None = None) -> str:
    """Fetch every configured competition from `source` and return the facts bundle as JSON."""
    if now is None:
        now = datetime.now(UTC)
    comp_data = [
        (code, source.fetch_matches(code), source.fetch_standings(code))
        for code in config.competitions
    ]
    return json.dumps(build_facts(comp_data, config, now=now), indent=2, ensure_ascii=False)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="touchline")
    sub = parser.add_subparsers(dest="command")
    facts = sub.add_parser("facts", help="Print the structured facts bundle as JSON.")
    facts.add_argument(
        "--config", default="touchline.config.json", help="Path to touchline.config.json"
    )

    args = parser.parse_args(argv)

    if args.command == "facts":
        config = load_config(args.config)
        print(run_facts(FootballDataClient(), config))
        return 0

    parser.print_help()
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest -q && uv run ruff check .`
Expected: whole suite PASS, ruff clean.

- [ ] **Step 5: Smoke the real command** (network + token optional — degraded output is still valid JSON)

Run: `uv run touchline facts | head -30`
Expected: JSON starting with `"date": "2026-…"`; with no `FOOTBALL_DATA_TOKEN` the `errors` fields carry HTTP errors instead of crashing.

- [ ] **Step 6: Commit**

```bash
git add src/touchline/cli.py tests/test_cli.py
git commit -m "feat: touchline facts CLI command"
```

---

### Task 5: The database — seed `digests.json` + `brain/validate.mjs`

**Files:**
- Create: `site/data/digests.json`
- Create: `brain/validate.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: the append-only database file and `node brain/validate.mjs [path]` (exit 0 = valid, exit 1 + message = invalid). Tasks 6 (site renders the same schema) and 7 (curate.sh runs the validator) depend on the schema below.

- [ ] **Step 1: Seed the database**

Create `site/data/digests.json`:

```json
{
  "digests": []
}
```

- [ ] **Step 2: Implement `brain/validate.mjs`**

```js
#!/usr/bin/env node
// Validate site/data/digests.json: parse, per-entry schema, no duplicate dates.
// Usage: node brain/validate.mjs [path]   (exit 0 ok / exit 1 invalid)
import { readFileSync } from "node:fs";

const path = process.argv[2] ?? "site/data/digests.json";
const fail = (msg) => {
  console.error(`digests.json invalid: ${msg}`);
  process.exit(1);
};

let data;
try {
  data = JSON.parse(readFileSync(path, "utf8"));
} catch (err) {
  fail(err.message);
}

if (!Array.isArray(data.digests)) fail("top-level 'digests' must be an array");

const dateRe = /^\d{4}-\d{2}-\d{2}$/;
const seen = new Set();

for (const [i, d] of data.digests.entries()) {
  const where = `entry ${i} (${d?.date ?? "?"})`;
  if (!dateRe.test(d?.date ?? "")) fail(`${where}: 'date' must be YYYY-MM-DD`);
  if (seen.has(d.date)) fail(`${where}: duplicate date`);
  seen.add(d.date);

  for (const key of ["headline", "yesterday", "today"]) {
    if (typeof d[key] !== "string" || !d[key].trim())
      fail(`${where}: '${key}' must be a non-empty string`);
  }

  if (typeof d.club !== "object" || d.club === null || Array.isArray(d.club))
    fail(`${where}: 'club' must be an object`);
  for (const key of ["results", "fixtures"]) {
    if (d.club[key] !== undefined && !Array.isArray(d.club[key]))
      fail(`${where}: club.${key} must be an array when present`);
  }

  if (!Array.isArray(d.wider)) fail(`${where}: 'wider' must be an array`);
  for (const w of d.wider) {
    if (!w?.title || !w?.url || !w?.hook)
      fail(`${where}: every 'wider' item needs title/url/hook`);
  }
  if (d.read != null && (!d.read.title || !d.read.url || !d.read.hook))
    fail(`${where}: 'read' needs title/url/hook when present`);
}

console.log(`digests.json OK — ${data.digests.length} entries`);
```

- [ ] **Step 3: Verify the validator accepts the seed and a full entry**

```bash
node brain/validate.mjs site/data/digests.json
SCRATCH="$(mktemp -d)"
cat > "$SCRATCH/good.json" <<'EOF'
{"digests": [{
  "date": "2026-08-16",
  "club": {
    "results": [{"home": "Chelsea", "away": "Arsenal", "score": "2–1", "competition": "PL"}],
    "fixtures": [{"opponent": "Aston Villa", "home": false, "kickoff_local": "Tue 18 Aug 19:30", "competition": "PL"}],
    "table": {"position": 1, "points": 3, "played": 1}
  },
  "headline": "A first Saturday to remember",
  "yesterday": "Chelsea edged Arsenal 2–1 in the opener.",
  "today": "Quiet day — Spurs v Villa is the only game.",
  "wider": [{"title": "r/soccer on the opener", "url": "https://example.com", "hook": "The thread is better than the match."}],
  "read": {"title": "A good read", "url": "https://example.com/read", "hook": "Worth ten minutes."}
}]}
EOF
node brain/validate.mjs "$SCRATCH/good.json"
```

Expected: `digests.json OK — 0 entries` then `digests.json OK — 1 entries`.

- [ ] **Step 4: Verify the validator rejects bad entries**

```bash
echo '{"digests": [{"date": "bad", "club": {}, "headline": "x", "yesterday": "y", "today": "z", "wider": []}]}' > "$SCRATCH/bad.json"
node brain/validate.mjs "$SCRATCH/bad.json"; echo "exit=$?"
echo '{"digests": [{"date": "2026-08-16", "club": {}, "headline": "", "yesterday": "y", "today": "z", "wider": []}]}' > "$SCRATCH/bad2.json"
node brain/validate.mjs "$SCRATCH/bad2.json"; echo "exit=$?"
```

Expected: both print `digests.json invalid: …` and `exit=1`.

- [ ] **Step 5: Commit**

```bash
git add site/data/digests.json brain/validate.mjs
git commit -m "feat: digests.json seed + schema validator"
```

---

### Task 6: The static reader — `site/`

**Files:**
- Create: `site/index.html`
- Create: `site/style.css`
- Create: `site/app.js`
- Create: `site/icon.svg`

**Interfaces:**
- Consumes: `site/data/digests.json` (Task 5 schema) and optional `site/data/config.json` (generated by Task 8's `deploy.sh`; the site must work without it).
- Produces: the deployable static reader. No exports.

- [ ] **Step 1: Create `site/index.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Touchline</title>
  <link rel="stylesheet" href="style.css">
  <link rel="icon" href="icon.svg" type="image/svg+xml">
</head>
<body>
  <header>
    <div class="brand">Touchline</div>
    <div class="club" id="club-label"></div>
  </header>
  <main id="main">
    <p class="empty">Loading…</p>
  </main>
  <footer>one page a day · no scroll, no bait</footer>
  <script src="app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create `site/icon.svg`** (half-pitch mark: touchline + centre circle)

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" rx="20" fill="#0a0e1a"/>
  <line x1="50" y1="12" x2="50" y2="88" stroke="#23d18b" stroke-width="6" stroke-linecap="round"/>
  <circle cx="50" cy="50" r="17" fill="none" stroke="#23d18b" stroke-width="6"/>
</svg>
```

- [ ] **Step 3: Create `site/style.css`**

```css
:root {
  --bg: #0a0e1a; --card: #131a2e; --line: #26304e;
  --text: #eef2fb; --dim: #93a0bf; --accent: #23d18b;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  background: var(--bg); color: var(--text); line-height: 1.55;
  max-width: 640px; margin: 0 auto; padding: 0 18px 60px;
}
header { display: flex; align-items: baseline; gap: 12px; padding: 28px 0 8px; }
.brand { font-size: 22px; font-weight: 800; letter-spacing: -0.02em; color: var(--accent); }
.club { color: var(--dim); font-size: 14px; font-weight: 600; }
footer { color: var(--dim); font-size: 12px; text-align: center; padding-top: 40px; }
.empty { color: var(--dim); font-style: italic; padding: 24px 0; }
.empty code { font-style: normal; }

.digest { padding: 18px 0; }
.ddate { color: var(--dim); font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; }
.digest h1 { font-size: 26px; line-height: 1.25; margin: 6px 0 16px; letter-spacing: -0.01em; }
.digest section { margin: 20px 0; }
.digest h2 {
  font-size: 12px; text-transform: uppercase; letter-spacing: 0.14em;
  color: var(--dim); margin-bottom: 8px; font-weight: 800;
}
.digest p { font-size: 15.5px; }

.club-block { border: 1px solid var(--line); border-radius: 12px; margin: 14px 0; overflow: hidden; }
.club-block .row {
  display: flex; justify-content: space-between; gap: 12px;
  padding: 10px 14px; font-size: 14.5px;
}
.club-block .row + .row { border-top: 1px solid var(--line); }
.club-block strong { color: var(--accent); font-variant-numeric: tabular-nums; }
.dim { color: var(--dim); }

a.wider {
  display: block; text-decoration: none; color: inherit;
  background: var(--card); border: 1px solid var(--line); border-radius: 12px;
  padding: 12px 14px; margin-bottom: 8px;
}
a.wider:hover { border-color: var(--accent); }
.wtitle { display: block; font-weight: 700; font-size: 14.5px; }
.hook { display: block; color: var(--dim); font-size: 13.5px; margin-top: 3px; }

.archive-head {
  font-size: 12px; text-transform: uppercase; letter-spacing: 0.14em;
  color: var(--dim); margin: 34px 0 10px; font-weight: 800;
}
details.arch { border-top: 1px solid var(--line); }
details.arch summary {
  cursor: pointer; padding: 12px 2px; font-size: 14.5px; color: var(--dim);
  list-style: none;
}
details.arch summary::-webkit-details-marker { display: none; }
details.arch[open] summary { color: var(--text); }
```

- [ ] **Step 4: Create `site/app.js`**

```js
// Touchline reader — renders site/data/digests.json. No framework, no build step.
const $ = (sel) => document.querySelector(sel);

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const fmtDate = (iso) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", {
    weekday: "long", day: "numeric", month: "long",
  });

function clubBlock(club) {
  if (!club) return "";
  const results = (club.results ?? [])
    .map((r) =>
      `<div class="row"><span>${esc(r.home)} <strong>${esc(r.score)}</strong> ${esc(r.away)}</span>` +
      `<span class="dim">${esc(r.competition ?? "")}</span></div>`)
    .join("");
  const fixtures = (club.fixtures ?? [])
    .map((f) =>
      `<div class="row"><span>${f.home ? "vs" : "at"} ${esc(f.opponent)}</span>` +
      `<span class="dim">${esc(f.kickoff_local ?? "")} · ${esc(f.competition ?? "")}</span></div>`)
    .join("");
  const table = club.table
    ? `<div class="row"><span>League position</span>` +
      `<span class="dim">#${esc(club.table.position)} · ${esc(club.table.points)} pts · P${esc(club.table.played)}</span></div>`
    : "";
  const inner = results + fixtures + table;
  return inner ? `<div class="club-block">${inner}</div>` : "";
}

const links = (items) =>
  (items ?? [])
    .map((w) =>
      `<a class="wider" href="${esc(w.url)}" target="_blank" rel="noopener">` +
      `<span class="wtitle">${esc(w.title)}</span><span class="hook">${esc(w.hook)}</span></a>`)
    .join("");

function digestHTML(d) {
  return `
    <article class="digest">
      <div class="ddate">${fmtDate(d.date)}</div>
      <h1>${esc(d.headline)}</h1>
      ${clubBlock(d.club)}
      <section><h2>Yesterday</h2><p>${esc(d.yesterday)}</p></section>
      <section><h2>Today</h2><p>${esc(d.today)}</p></section>
      ${d.wider?.length ? `<section><h2>The wider game</h2>${links(d.wider)}</section>` : ""}
      ${d.read ? `<section><h2>One good read</h2>${links([d.read])}</section>` : ""}
    </article>`;
}

async function load() {
  let config = null;
  try {
    config = await (await fetch("data/config.json")).json();
  } catch { /* config.json is optional — generated at deploy time */ }
  if (config?.club?.name) $("#club-label").textContent = config.club.name;

  const data = await (await fetch("data/digests.json")).json();
  const entries = [...(data.digests ?? [])].sort((a, b) => b.date.localeCompare(a.date));
  const main = $("#main");
  if (!entries.length) {
    main.innerHTML = `<p class="empty">No digests yet — run <code>./brain/curate.sh</code>.</p>`;
    return;
  }
  const [latest, ...past] = entries;
  main.innerHTML =
    digestHTML(latest) +
    (past.length
      ? `<h2 class="archive-head">Archive</h2>` +
        past
          .map((d) =>
            `<details class="arch"><summary>${fmtDate(d.date)} — ${esc(d.headline)}</summary>${digestHTML(d)}</details>`)
          .join("")
      : "");
}

load().catch((err) => {
  $("#main").innerHTML = `<p class="empty">Could not load digests: ${esc(err.message)}</p>`;
});
```

- [ ] **Step 5: Verify empty state serves correctly**

```bash
python3 -m http.server 8765 --directory site &
SERVER_PID=$!
sleep 1
curl -s -o /dev/null -w "index=%{http_code} " http://localhost:8765/
curl -s -o /dev/null -w "app=%{http_code} " http://localhost:8765/app.js
curl -s -o /dev/null -w "data=%{http_code}\n" http://localhost:8765/data/digests.json
kill "$SERVER_PID"
```

Expected: `index=200 app=200 data=200`.

- [ ] **Step 6: Visual check with a sample entry** — copy `site/` to the scratchpad, overwrite the copy's `data/digests.json` with the "good.json" sample entry from Task 5 Step 3 (plus a second entry dated `2026-08-15` to exercise the archive), serve the copy with `python3 -m http.server`, and eyeball in a browser: headline renders, club block shows score/fixture/table rows, wider links styled, archive `<details>` expands. The real `site/data/digests.json` stays untouched.

- [ ] **Step 7: Commit**

```bash
git add site/index.html site/style.css site/app.js site/icon.svg
git commit -m "feat: static reader for the daily digest"
```

---

### Task 7: The brain — `prompt.md`, `sources.md`, `curate.sh`

**Files:**
- Create: `brain/prompt.md`
- Create: `brain/sources.md`
- Create: `brain/curate.sh` (mode `chmod +x`)

**Interfaces:**
- Consumes: `uv run touchline facts` (Task 4), `node brain/validate.mjs` (Task 5), `touchline.config.json` (Task 2), `./deploy.sh` (Task 8 — curate.sh references it; use `--no-deploy` until Task 8 lands).
- Produces: the daily ritual `./brain/curate.sh [--no-deploy]`.

- [ ] **Step 1: Create `brain/prompt.md`**

```markdown
# touchline brain

You are the editor of **Touchline** — a one-page-a-day football companion.
The reader supports the club named in OWNER CONFIG, missed the day's
football, and wants to catch up in under a minute — with a point of view,
not a fixture dump. Write in the voice described in OWNER CONFIG `voice`.

## Ground truth vs color

- The FACTS BUNDLE in the task message is ground truth: scores, fixtures,
  tables, form. NEVER contradict it. NEVER invent scores, lineups, injuries,
  or quotes not found in a source you actually fetched.
- Discourse and news (sources below) provide the color: what fans are
  arguing about, what actually mattered beyond the scoreline.
- If any `errors` field in the bundle is non-null, say plainly in the prose
  that some data was unavailable. Never silently thin the page.

## Sources

Read `brain/sources.md` for the concrete list. Summary: r/soccer top-of-day
RSS is the community-voted pulse; the club subreddit (OWNER CONFIG
`club.subreddit`) is the fan mood; the RSS feeds in OWNER CONFIG `feeds`
are the editorial layer. Verify every URL you include actually loads
(WebFetch) before including it.

## The entry

Append exactly ONE entry for today's date to the `digests` array in
`site/data/digests.json`. NEVER edit or remove existing entries. If an
entry for today already exists, stop and say so instead of writing.

Schema:

```json
{
  "date": "YYYY-MM-DD",
  "club": {
    "results": [{ "home": "...", "away": "...", "score": "2–1", "competition": "PL" }],
    "fixtures": [{ "opponent": "...", "home": true, "kickoff_local": "Sat 22 Aug 20:00", "competition": "PL" }],
    "table": { "position": 4, "points": 3, "played": 1 }
  },
  "headline": "one line that captures the day",
  "yesterday": "prose: the story of what happened",
  "today": "prose: what's on and why it matters, with an honest take",
  "wider": [{ "title": "...", "url": "...", "hook": "why this is worth the click" }],
  "read": { "title": "...", "url": "...", "hook": "..." }
}
```

Rules:
- `club` is structured facts copied from the bundle (the site renders it):
  yesterday's club results, the next fixture(s) from `club_upcoming`, and
  `club_position` as `table`. Omit keys that have no data today.
- `headline` earns the open. Specific beats clever; clever beats generic.
- `yesterday` / `today`: 2–5 sentences each. Quiet days are told honestly
  ("nothing on — perfect night to close the app") — never padded.
- `wider`: 1–3 links from the day's discourse. The `hook` is the product —
  a pitch to the reader, not a summary. When the comment thread is the real
  value, link the thread and say so.
- `read`: optional; include only when something genuinely clears the bar.
- After editing, run `node brain/validate.mjs site/data/digests.json` via
  Bash and fix anything it reports before finishing.
```

- [ ] **Step 2: Create `brain/sources.md`**

```markdown
# Sources

1. **Facts bundle** (provided in the task message — output of
   `uv run touchline facts`): ground truth for scores, fixtures, tables,
   form. Free-tier football-data.org under the hood.
2. **r/soccer, top of the last day** —
   https://www.reddit.com/r/soccer/top/.rss?t=day — the community-voted
   pulse of the game. (Reddit's public .json endpoints 403; RSS works.)
3. **Club subreddit** — https://www.reddit.com/r/<club.subreddit>/top/.rss?t=day
   with `club.subreddit` from OWNER CONFIG — the fan mood.
4. **Editorial feeds** — every entry in OWNER CONFIG `feeds` (label + URL).

Evergreen football writing is welcome for `read` — a great older piece
beats a mediocre new one.
```

- [ ] **Step 3: Create `brain/curate.sh`**

```bash
#!/usr/bin/env bash
# touchline brain — run daily with coffee. Usage: ./brain/curate.sh [--no-deploy]
set -euo pipefail
cd "$(dirname "$0")/.."

TODAY="$(date +%F)"
FACTS="$(uv run touchline facts)"
CONFIG="$(cat touchline.config.json)"

claude -p "$(cat brain/prompt.md)

---

DAILY MODE: today is $TODAY. Append exactly ONE digest entry dated $TODAY.

OWNER CONFIG:
$CONFIG

FACTS BUNDLE (ground truth — output of 'touchline facts'):
$FACTS" \
  --allowedTools "WebSearch,WebFetch,Read,Edit,Write,Bash(node:*),Bash(curl:*)" \
  --permission-mode acceptEdits

node brain/validate.mjs site/data/digests.json \
  || { echo "digests.json failed validation — NOT committing"; exit 1; }

git add site/data/digests.json
git commit -m "digest: $TODAY" || echo "nothing new committed"

if [ "${1:-}" != "--no-deploy" ]; then
  ./deploy.sh
fi
```

Then: `chmod +x brain/curate.sh`

- [ ] **Step 4: Verify script hygiene without running the brain**

Run: `bash -n brain/curate.sh && node brain/validate.mjs site/data/digests.json`
Expected: no syntax errors; `digests.json OK — 0 entries`.

- [ ] **Step 5: Commit**

```bash
git add brain/prompt.md brain/sources.md brain/curate.sh
git commit -m "feat: daily curation brain (prompt, sources, curate.sh)"
```

---

### Task 8: Deploy — `wrangler.toml`, `deploy.sh`, `.gitignore`

**Files:**
- Create: `wrangler.toml`
- Create: `deploy.sh` (mode `chmod +x`)
- Create or modify: `.gitignore` (add `site/data/config.json`)

**Interfaces:**
- Consumes: `touchline.config.json` (Task 2), `site/` (Task 6).
- Produces: `./deploy.sh` used by Task 7's curate.sh and directly by the owner.

- [ ] **Step 1: Create `wrangler.toml`**

```toml
name = "touchline"
pages_build_output_dir = "site"
compatibility_date = "2026-07-01"
```

- [ ] **Step 2: Create `deploy.sh`** (no Functions bundle here, unlike antifeed — pure static)

```bash
#!/usr/bin/env bash
# Deploy touchline to Cloudflare Pages. Run from anywhere; wrangler runs at repo root.
set -euo pipefail
cd "$(dirname "$0")"

cp touchline.config.json site/data/config.json

OUT=$(CI=1 npx wrangler pages deploy --branch main 2>&1) || { echo "$OUT"; exit 1; }
echo "$OUT" | tail -2
```

Then: `chmod +x deploy.sh`

- [ ] **Step 3: Gitignore the generated config copy**

Append to `.gitignore` (create the file if absent):

```
site/data/config.json
__pycache__/
```

- [ ] **Step 4: Verify**

```bash
bash -n deploy.sh
cp touchline.config.json site/data/config.json
node -e 'JSON.parse(require("fs").readFileSync("site/data/config.json"))' && echo config-copy-ok
rm site/data/config.json
git status --short   # site/data/config.json must NOT appear (gitignored)
```

Expected: `config-copy-ok`, and the generated file is invisible to git. Do NOT run `./deploy.sh` itself in this task — it would attempt a real Cloudflare deploy; `npx wrangler login` + first deploy are owner steps in Task 9.

- [ ] **Step 5: Commit**

```bash
git add wrangler.toml deploy.sh .gitignore
git commit -m "feat: Cloudflare Pages deploy script + wrangler config"
```

---

### Task 9: README rewrite + first live run

**Files:**
- Modify: `README.md` (full rewrite)
- Owner-run: first `./brain/curate.sh --no-deploy`, then first deploy

**Interfaces:**
- Consumes: everything above.
- Produces: the self-hosting story; the first real digest entry.

- [ ] **Step 1: Rewrite `README.md`**

```markdown
# Touchline

One page of football a day. No scroll, no bait.

Touchline is a self-hostable football companion built on a simple model
(borrowed from [antifeed](https://github.com/kaushikb9/antifeed)): a static
site whose only database is a JSON file, plus a **brain** — headless Claude
Code, run locally each morning — that gathers the facts, reads the day's
discourse, and writes one calm, opinionated page: what happened, what's on
today, and what's worth your click.

The boundary rule: **Python produces facts, the brain produces prose, the
site produces pixels.**

```
touchline.config.json   your club, competitions, timezone, feeds, voice
src/touchline/          facts CLI: `touchline facts` -> JSON bundle (football-data.org)
brain/                  prompt + sources + curate.sh (headless Claude Code)
site/                   static reader; site/data/digests.json is the database
```

## Daily use

```sh
./brain/curate.sh              # with morning coffee: facts -> brain -> validate -> commit -> deploy
./brain/curate.sh --no-deploy  # same, but stop before deploying
```

## Self-hosting

1. Fork this repo.
2. Edit `touchline.config.json` — club name + [football-data.org TLA code](https://www.football-data.org/),
   competitions, your timezone, feeds, and the voice you want the digest
   written in.
3. Get a free token at football-data.org and export it:
   `export FOOTBALL_DATA_TOKEN=...`
4. Install [Claude Code](https://claude.com/claude-code) (the brain runs
   `claude -p`), plus `uv` and `node`.
5. First deploy: `npx wrangler login`, then `./deploy.sh` (creates the
   Pages project), then run `./brain/curate.sh` each morning.

Nothing runs centrally: the brain runs on your machine, with your
preferences, and publishes to your Cloudflare Pages project.

## Development

```sh
uv run pytest -q                     # Python suite
node brain/validate.mjs              # check the database
cd site && python3 -m http.server    # local preview
```

## Deliberately not built (yet)

Match pages, standings pages, PWA install, push/Telegram/email delivery,
preference sync, automated scheduling. Each may return if the habit sticks.

## License

MIT
```

- [ ] **Step 2: Full green check**

Run: `uv run pytest -q && uv run ruff check . && node brain/validate.mjs && bash -n brain/curate.sh deploy.sh`
Expected: suite passes, ruff clean, `digests.json OK`.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: rewrite README for v2 self-hosting model"
```

- [ ] **Step 4: First live brain run (owner acceptance)** — with `FOOTBALL_DATA_TOKEN` exported, run `./brain/curate.sh --no-deploy`. Review the entry it wrote (`git show`), preview via `cd site && python3 -m http.server`, and judge it against the success criterion: *a page worth reading in under a minute*. Pre-season note: expect a quiet club block and a discourse-heavy `wider` section — that's correct behavior, not a bug.

- [ ] **Step 5: First deploy (owner)** — `npx wrangler login` (once), then `./deploy.sh`. Optionally add a custom domain in the Cloudflare dashboard under the Pages project.

---

## Design Addendum (2026-07-25, post-mockup review — supersedes Task 6's HTML/CSS sketches)

The approved visual direction is committed at `docs/superpowers/mockups/2026-07-25-site-mockup.html`
(self-contained; crests are inlined as data URIs for preview only — the real site loads crest
URLs from the digest data). Task 6 implements THAT design: newspaper masthead with pitchline
mark, serif headlines, monospace scoreboard, light + dark themes via tokens. Content deltas
that touch other tasks (all new digest fields are optional in the validator):

- **Crests** (Tasks 3, 5, 6): in `core/facts.py`, `_result_row` and `_fixture_row` gain
  `"home_crest"`/`"away_crest"` (from `Team.crest`, may be `null`); `_club_form` entries and
  `club_upcoming` entries gain `"opponent_crest"`. Digest schema: `club.results[]` carries
  `home_crest`/`away_crest`, `club.fixtures[]` carries `opponent_crest`. The site renders an
  initials placeholder circle when a crest is `null`.
- **Competition names** (Tasks 3, 5, 6, 7): each entry in the bundle's `competitions[]` gains
  `"name"` (from `Competition.name`, falling back to the code). Every score/fixture/table row
  in the digest keeps its `competition` label and the site displays it on every row
  (e.g. "Premier League · FT", "Sat 22 Aug · 20:00 · Premier League").
- **Form strip** (Tasks 5, 6, 7): the digest `club` object gains
  `"form": [{"result": "W|L|D", "score": "2–0", "opponent": "...", "opponent_crest": null, "competition": "PL"}, ...]`
  — copied by the brain from the bundle's `club_form` (oldest first, newest last). The site
  renders it FotMob-style: color-coded score pill (`--win` green / `--draw` grey / `--loss` red),
  opponent crest below, competition code beneath, newest entry underlined with the accent.
- **Link thumbnails** (Tasks 5, 6, 7): `wider[]` items and `read` gain optional `"image"`
  (a URL — the brain uses the page's `og:image` when it finds one, else omits). The site shows
  a 54px rounded thumb when present and a source-colored fallback tile when absent.
- **Split stat blocks** (Tasks 5, 6, 7): the digest `club` object is organized as separate
  labeled blocks, rendered in this order: `"latest_result"` (single result object — replaces
  the `results` array; on multi-match days the brain picks the club's most recent),
  `"fixtures"` (up-next list; the site renders the opponent name with an `H`/`A` chip, never
  "vs"/"at" words), and a form+table split block. `"table"` becomes a mini-table:
  `{"competition": "Premier League", "rows": [{"pos": 1, "team": "...", "crest": null, "played": 1, "points": 3}], "club_position": 2}`
  — top 4 rows, plus the club's row appended when it sits below 4th; the club's row is
  highlighted. Facts side: the bundle's full `table` already carries this data; add `"crest"`
  to `_table_rows` entries (from `Standing.team.crest`).
- **Rival watch** (Tasks 5, 6, 7): new optional digest field
  `"rivals": [{"club": "...", "crest": null, "line": "#1 · 3 pts · Premier League", "note": "one-sentence brain-written sneak peek"}]`
  — 2–4 top clubs from the same league (from the bundle's table + the day's discourse),
  rendered as the LAST section of the digest, after `read`. The brain prompt instructs: pick
  clubs that matter to the title/top-four race, one honest sentence each, `line` is the
  factual chip (position/points, or "plays tonight" when they're yet to play).

Task executors: where this addendum names a field the original task code omits, the addendum
wins — extend the shown code and its tests accordingly.

## Self-Review Notes

- **Spec coverage:** cleanup → Task 1; preferences → Task 2; facts CLI → Tasks 3–4; digest schema + reliability/validation → Task 5; site → Task 6; brain + sources → Task 7; deploy → Task 8; README/self-hosting + success criteria → Task 9. "Deliberately not built" items appear in no task, as intended.
- **Type consistency:** `run_facts(source, config, *, now)` (Task 4) matches `build_facts(comp_data, config, *, now)` (Task 3); validator schema (Task 5) matches the site renderer (Task 6) and the brain prompt schema (Task 7); `--no-deploy` flag consistent between Tasks 7 and 9.
- **Sequencing:** Task 7's curate.sh references `./deploy.sh` (Task 8); until Task 8 lands, use `--no-deploy` — noted in Task 7's Interfaces.
