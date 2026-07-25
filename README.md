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
