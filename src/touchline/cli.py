"""Command-line interface for Touchline: the facts and fpl bundles."""

import argparse
import json
from collections.abc import Callable
from datetime import UTC, datetime

from touchline.config import TouchlineConfig, load_config
from touchline.core.facts import build_facts
from touchline.core.fpl import build_fpl_facts
from touchline.sources.api_football import APIFootballClient
from touchline.sources.espn import ESPNClient
from touchline.sources.football_data import FootballDataClient
from touchline.sources.fpl import FPLClient
from touchline.sources.layered import LayeredSource
from touchline.sources.thesportsdb import TheSportsDBClient

# Each entry builds a source from the loaded config (most ignore it).
SOURCES: dict[str, Callable[[TouchlineConfig], object]] = {
    "espn": lambda config: ESPNClient(),
    "api-football": lambda config: APIFootballClient(),
    "football-data": lambda config: FootballDataClient(),
    "espn+thesportsdb": lambda config: LayeredSource(
        ESPNClient(), TheSportsDBClient(config.club.thesportsdb_id)
    ),
}


def run_facts(source, config: TouchlineConfig, *, now: datetime | None = None) -> str:
    """Fetch every configured competition from `source` and return the facts bundle as JSON."""
    if now is None:
        now = datetime.now(UTC)
    comp_data = [
        (code, source.fetch_matches(code), source.fetch_standings(code))
        for code in config.competitions
    ]
    return json.dumps(build_facts(comp_data, config, now=now), indent=2, ensure_ascii=False)


def run_fpl(client, config: TouchlineConfig, *, now: datetime | None = None) -> str:
    """Fetch FPL bootstrap + fixtures (+ the owner's team) and return the bundle as JSON."""
    if now is None:
        now = datetime.now(UTC)
    bootstrap = client.fetch_bootstrap()
    fixtures = client.fetch_fixtures()

    playing = next((e for e in bootstrap.events if e.is_current), None)
    event = playing.id if playing else None

    entry = None
    if config.fpl.team_id:
        entry = client.fetch_entry(
            config.fpl.team_id, event=event, league_ids=config.fpl.league_ids
        )

    # Every manager in the group, keyed by nickname — never by real name.
    people = {
        person.nick: client.fetch_entry(person.entry, event=event)
        for person in config.fpl.people
    }

    # Form is the last five matches a club played, not the last five LEAGUE
    # matches, so the cups and Europe come from the same ESPN client the
    # digest uses. Each competition degrades on its own: a dead feed costs
    # those rows, never the bundle.
    # The league is FPL's own and a friendly is not form, so neither is fetched.
    wanted = [c for c in config.competitions if c not in {"PL", "FRIENDLIES"}]
    other_results: dict[str, list] = {}
    if wanted:
        espn = ESPNClient()
        for comp in wanted:
            out = espn.fetch_matches(comp)
            if out.ok and out.results:
                other_results[comp] = out.results

    bundle = build_fpl_facts(
        bootstrap,
        fixtures,
        config,
        now=now,
        entry=entry,
        people=people or None,
        other_results=other_results,
    )
    return json.dumps(bundle, indent=2, ensure_ascii=False)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="touchline")
    sub = parser.add_subparsers(dest="command")
    facts = sub.add_parser("facts", help="Print the structured facts bundle as JSON.")
    facts.add_argument(
        "--config", default="touchline.config.json", help="Path to touchline.config.json"
    )
    fpl = sub.add_parser("fpl", help="Print the FPL facts bundle as JSON.")
    fpl.add_argument(
        "--config", default="touchline.config.json", help="Path to touchline.config.json"
    )

    args = parser.parse_args(argv)

    if args.command == "facts":
        config = load_config(args.config)
        print(run_facts(SOURCES[config.source](config), config))
        return 0

    if args.command == "fpl":
        config = load_config(args.config)
        print(run_fpl(FPLClient(), config))
        return 0

    parser.print_help()
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
