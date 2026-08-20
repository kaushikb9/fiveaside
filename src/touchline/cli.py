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
    """Fetch FPL bootstrap + fixtures from `client` and return the fpl facts bundle as JSON."""
    if now is None:
        now = datetime.now(UTC)
    bundle = build_fpl_facts(client.fetch_bootstrap(), client.fetch_fixtures(), config, now=now)
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
