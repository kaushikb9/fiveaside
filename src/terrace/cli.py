"""Command-line interface for Touchline."""

import argparse
from datetime import UTC, datetime

from terrace.core.digest import build_digest
from terrace.render.markdown import render_markdown
from terrace.sources.base import MatchSource, NewsSource
from terrace.sources.football_data import FootballDataClient
from terrace.sources.rss import RSSNewsClient


def run_digest(
    source: MatchSource,
    *,
    now: datetime | None = None,
    news_source: NewsSource | None = None,
) -> str:
    """Build and render today's digest from `source`.

    Parameters
    ----------
    source:
        Match data source (fixtures + results).
    now:
        Override for the current time; defaults to ``datetime.now(UTC)``.
    news_source:
        Optional news source.  When provided, headlines are fetched and
        attached to the digest sections.  A fetch failure degrades
        gracefully rather than raising.
    """
    if now is None:
        now = datetime.now(UTC)

    res = source.fetch_matches("WC")

    news_items = None
    news_error: str | None = None
    if news_source is not None:
        news_res = news_source.fetch_news()
        news_items = news_res.items
        if not news_res.ok:
            news_error = news_res.error

    digest = build_digest(res.fixtures, res.results, now=now, news=news_items)
    output = render_markdown(digest)

    if not res.ok:
        output += f"\n> ⚠️ Some data was unavailable: {res.error}"
    if news_error is not None:
        output += f"\n> ⚠️ Some news was unavailable: {news_error}"

    return output


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="terrace")
    subparsers = parser.add_subparsers(dest="command")
    subparsers.add_parser("digest", help="Print today's football digest as Markdown.")

    args = parser.parse_args(argv)

    if args.command == "digest":
        client = FootballDataClient()
        news_client = RSSNewsClient()
        print(run_digest(client, news_source=news_client))
        return 0

    parser.print_help()
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
