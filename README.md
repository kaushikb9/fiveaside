# Touchline

One page of football a day. No scroll, no bait.

**Live:** [touchline-chelsea.pages.dev](https://touchline-chelsea.pages.dev) ·
[why this exists](https://touchline-chelsea.pages.dev/about/)

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
src/touchline/          facts CLI: `touchline facts` -> JSON bundle (ESPN by default)
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
2. Edit `touchline.config.json` — club name + club `code`, plus
   competitions, your timezone, feeds, and the voice you want the digest
   written in. The `code` must match your configured `source` (step 3): the
   ESPN abbreviation for `espn` (default — e.g. `MAN` for Manchester United,
   not football-data's `MUN`), the [football-data.org TLA](https://www.football-data.org/)
   for `football-data`, or nothing at all for `api-football` — it has no
   club codes, so the club `name` must match its team name exactly instead.
3. Pick a data source in `touchline.config.json` (`"source"`):
   `espn+thesportsdb` (recommended, no key needed — ESPN for league data
   plus [TheSportsDB](https://www.thesportsdb.com/)'s free per-team feed,
   which catches tour friendlies ESPN misses; set `club.thesportsdb_id` to
   your club's numeric TheSportsDB team id), `espn` (no key needed),
   `api-football` (set `API_FOOTBALL_KEY`, from
   [api-football.com](https://www.api-football.com/)), or `football-data`
   (set `FOOTBALL_DATA_TOKEN`, from [football-data.org](https://www.football-data.org/)).
4. Install [Claude Code](https://claude.com/claude-code) (the brain runs
   `claude -p`), plus `uv` and `node`.
5. First deploy: `npx wrangler login`, then
   `npx wrangler pages project create <your-project> --production-branch main`
   (once — deploy runs non-interactively and cannot create the project),
   then `./deploy.sh`. After that, run `./brain/curate.sh` each morning.

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

MIT — see [LICENSE](LICENSE).
