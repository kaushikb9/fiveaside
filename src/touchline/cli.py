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
