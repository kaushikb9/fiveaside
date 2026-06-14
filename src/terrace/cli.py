"""Command-line interface for Touchline."""

import argparse
from datetime import UTC, datetime

from terrace.core.digest import build_digest
from terrace.render.markdown import render_markdown
from terrace.sources.base import MatchSource
from terrace.sources.football_data import FootballDataClient


def run_digest(source: MatchSource, *, now: datetime | None = None) -> str:
    """Build and render today's digest from `source`."""
    if now is None:
        now = datetime.now(UTC)

    res = source.fetch_matches("WC")
    digest = build_digest(res.fixtures, res.results, now=now)
    output = render_markdown(digest)

    if not res.ok:
        output += f"\n> ⚠️ Some data was unavailable: {res.error}"

    return output


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="terrace")
    subparsers = parser.add_subparsers(dest="command")
    subparsers.add_parser("digest", help="Print today's football digest as Markdown.")

    args = parser.parse_args(argv)

    if args.command == "digest":
        client = FootballDataClient()
        print(run_digest(client))
        return 0

    parser.print_help()
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
