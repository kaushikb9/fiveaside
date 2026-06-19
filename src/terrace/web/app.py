"""FastAPI web surface: the daily digest as an installable PWA."""

from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from terrace.core.digest import build_digest
from terrace.core.models import Standing
from terrace.sources.base import MatchSource, StandingsSource
from terrace.sources.football_data import FootballDataClient

WEB_DIR = Path(__file__).parent
STATIC_DIR = WEB_DIR / "static"
TEMPLATES_DIR = WEB_DIR / "templates"


def create_app(
    source: MatchSource | StandingsSource | None = None,
    *,
    now_fn: Callable[[], datetime] | None = None,
) -> FastAPI:
    """Build the Touchline FastAPI app.

    `source` defaults to a `FootballDataClient` (no network access at import or
    construction time). `now_fn` defaults to the current UTC time.
    """
    if source is None:
        source = FootballDataClient()
    if now_fn is None:

        def now_fn() -> datetime:
            return datetime.now(UTC)

    app = FastAPI(title="Touchline")
    templates = Jinja2Templates(directory=str(TEMPLATES_DIR))

    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

    @app.get("/")
    def index(request: Request):
        res = source.fetch_matches("WC")
        digest = build_digest(res.fixtures, res.results, now=now_fn())

        return templates.TemplateResponse(
            request,
            "digest.html",
            {
                "digest": digest,
                "degraded": not res.ok,
                "error": res.error,
            },
        )

    @app.get("/standings")
    def standings_page(request: Request):
        res = source.fetch_standings("WC")  # type: ignore[union-attr]
        groups: dict[str, list[Standing]] = {}
        for s in res.standings:
            key = s.group or "Unknown"
            groups.setdefault(key, []).append(s)
        # Sort each group's rows by position ascending.
        groups = {k: sorted(v, key=lambda x: x.position) for k, v in sorted(groups.items())}
        return templates.TemplateResponse(
            request,
            "standings.html",
            {
                "groups": groups,
                "degraded": not res.ok,
                "error": res.error,
            },
        )

    @app.get("/manifest.webmanifest")
    def manifest():
        return FileResponse(
            STATIC_DIR / "manifest.webmanifest",
            media_type="application/manifest+json",
        )

    @app.get("/sw.js")
    def service_worker():
        return FileResponse(STATIC_DIR / "sw.js", media_type="text/javascript")

    return app


app = create_app()
