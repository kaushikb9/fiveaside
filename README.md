# Touchline

A football companion that replaces the doomscroll. World Cup 2026 first (it's on
now — Jun 11 to Jul 19), then club football via the same club-agnostic core.

Touchline ingests fixtures, results, standings, and news, and produces one calm,
fun **daily digest**: what happened, what matters today, what to watch next —
so following the tournament doesn't require Twitter or Instagram.

## Built by the night shift

This repo is built primarily by [nightshift](https://github.com/kaushikb9/nightshift),
an autonomous agent engineering team. Humans write `ROADMAP.md`, `rubrics/`, and PR
reviews; agents write the code at night. `MEMORY.md` is the team's own accumulated
experience. If you're reading a PR here, odds are no human typed it.

## Architecture: core + adapters (platform flexibility is a requirement)

```
src/terrace/core/      pure Python domain: ingest, models, digest generation
src/terrace/sources/   data-source clients (football-data.org, RSS) behind interfaces
src/terrace/render/    digest -> markdown / HTML
src/terrace/web/       FastAPI app serving the digest as a responsive PWA
```

- **Core is pure**: no I/O assumptions, fully unit-testable, surface-agnostic.
- **First surfaces**: CLI (`uv run terrace digest`) and a responsive **PWA** — installable
  on iPhone from Safari and usable on Mac, no App Store.

### Running the web surface

```
uv run uvicorn terrace.web.app:app --reload
```

Then open `http://localhost:8000` — Safari (Share → Add to Home Screen) and Chrome
(install icon in the address bar) will offer to install it as an app. Visit
`http://localhost:8000/standings` for the World Cup group tables.
- **Later surfaces** (cheap because the core doesn't care): Telegram delivery,
  native wrappers, widgets.

## Status

Scaffold. The night shift starts on `ROADMAP.md` tonight.

## License

MIT
