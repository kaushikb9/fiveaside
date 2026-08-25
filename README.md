# Five-a-Side

Football and Fantasy Premier League for five friends. No scroll, no bait.

**Live:** [fiveaside.pages.dev](https://fiveaside.pages.dev) ·
[why this exists](https://fiveaside.pages.dev/about/)

Built on a simple model borrowed from
[antifeed](https://github.com/kaushikb9/antifeed): a static site whose only
database is a JSON file, plus a **brain** — headless Claude Code, run locally
— that gathers the facts, reads the week's discourse, and writes one calm,
opinionated page.

The boundary rule: **Python produces facts, the brain produces judgment, the
site produces pixels.**

## Three rooms

| Room | URL | Job |
|---|---|---|
| **touchline** | `/` | What happened. The league, the same for everyone. |
| **the gaffers** | `/gaffers/` | What we did about it. Five squads, five weekly reads. Behind Google sign-in. |
| **the locker room** | `/locker/` | What we know. Every player, evidence first. |

Any player's name, in any room, opens their file — that join is what makes it
one product rather than three tabs.

```
touchline.config.json   club, competitions, timezone, feeds, voice, the five
src/touchline/          facts CLI: `touchline facts` and `touchline fpl`
brain/                  two prompts, three validators, the curate scripts
functions/              Pages Functions: FPL proxy, stars, auth, private data
site/                   static reader; no framework, no build step, no CDNs
```

## What may say what

The rule the whole repo turns on:

| File | Written by | Contains |
|---|---|---|
| `players.json` | `touchline fpl` | Every player, evidence only. Mechanical. |
| `gaffers.json` | `touchline fpl` | Squads, picks, captaincy, chips. Mechanical, **not published**. |
| `fpl.json` | the brain | Judgment only — opinion with its reasoning attached. |
| `digests.json` | the brain | The league page. Append-only, one entry per date. |

If a value could be copied from the API, it does not belong in the file a
language model writes. Routing 600 player records through one cost ~100k
tokens a run to retype numbers, and every retyped number is a chance to get
one wrong.

## Daily use

```sh
./brain/curate.sh --no-deploy      # the league room
./brain/curate-fpl.sh --no-deploy  # the gaffers room
./deploy.sh                        # stamp, split public/private, publish
```

Both brains also run themselves hourly via launchd (`brain/auto.sh`): the
mechanical data refreshes every hour, each brain at most once a day.

## Development

```sh
uv run pytest -q                                   # Python suite
uv run ruff check .                                # lint
node brain/validate.mjs                            # the league database
node brain/validate-fpl.mjs                        # the judgment layer
node brain/validate-players.mjs                    # the player file
brain/test/smoke.sh https://fiveaside.pages.dev/   # 45 checks over the live site
cd site && python3 -m http.server                  # local preview
```

Working on this? Read [`ROADMAP.md`](ROADMAP.md) for the state of play, then
[`AGENTS.md`](AGENTS.md) for the rules and the traps that have already cost
someone a debugging round.

## Self-hosting

The machine is generic; only the config is ours. Fork it, put your own club
and competitions in `touchline.config.json`, pick a data source
(`espn+thesportsdb` needs no API key), install
[Claude Code](https://claude.com/claude-code), `uv` and `node`, then
`npx wrangler login` and `./deploy.sh`.

Nothing runs centrally: the brain runs on your machine, with your
preferences, and publishes to your own Cloudflare Pages project.

## License

MIT — see [LICENSE](LICENSE).
