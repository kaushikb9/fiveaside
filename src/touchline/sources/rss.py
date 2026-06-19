"""RSS news client implementing the NewsSource protocol."""

import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime

import httpx

from touchline.core.models import NewsItem
from touchline.sources.base import NewsResult

_DEFAULT_FEEDS: list[tuple[str, str]] = [
    ("BBC Sport", "https://feeds.bbci.co.uk/sport/football/rss.xml"),
]


def _parse_rss(content: bytes, source_label: str) -> list[NewsItem]:
    """Parse RSS 2.0 XML bytes into NewsItem objects.

    Per-record tolerance: each ``<item>`` is processed independently.
    Items missing a usable ``title`` or ``link`` are skipped silently.
    An unparseable ``<pubDate>`` yields ``published=None`` rather than raising.
    """
    root = ET.fromstring(content)  # raises ET.ParseError on malformed XML
    items: list[NewsItem] = []

    for item_el in root.iter("item"):
        try:
            title_el = item_el.find("title")
            link_el = item_el.find("link")

            title = (title_el.text or "").strip() if title_el is not None else ""
            link = (link_el.text or "").strip() if link_el is not None else ""

            if not title or not link:
                continue

            published = None
            pub_date_el = item_el.find("pubDate")
            if pub_date_el is not None and pub_date_el.text:
                try:
                    published = parsedate_to_datetime(pub_date_el.text.strip())
                except Exception:
                    published = None

            summary_el = item_el.find("description")
            raw_summary = (summary_el.text or "").strip() if summary_el is not None else ""
            summary: str | None = raw_summary or None

            items.append(
                NewsItem(
                    title=title,
                    link=link,
                    source=source_label,
                    published=published,
                    summary=summary,
                )
            )
        except Exception:
            # A malformed individual item must never suppress the rest.
            continue

    return items


class RSSNewsClient:
    """``NewsSource`` backed by one or more RSS 2.0 feeds.

    Parameters
    ----------
    feeds:
        List of ``(source_label, url)`` pairs.  Defaults to a single BBC
        Sport football feed.
    client:
        Optional pre-configured ``httpx.Client``; useful for testing via
        ``httpx.MockTransport``.
    timeout:
        Request timeout in seconds (used only when ``client`` is not supplied).
    """

    def __init__(
        self,
        feeds: list[tuple[str, str]] | None = None,
        *,
        client: httpx.Client | None = None,
        timeout: float = 10.0,
    ) -> None:
        self.feeds = feeds if feeds is not None else list(_DEFAULT_FEEDS)
        self._client = client or httpx.Client(timeout=timeout)

    def fetch_news(self) -> NewsResult:
        """Fetch and parse all configured feeds.

        Returns
        -------
        NewsResult
            ``ok=True`` with accumulated items when at least one feed succeeds.
            ``ok=False`` with an ``error`` summary only when **all** feeds fail.
        """
        all_items: list[NewsItem] = []
        errors: list[str] = []

        for source_label, url in self.feeds:
            try:
                response = self._client.get(url)
                response.raise_for_status()
                items = _parse_rss(response.content, source_label)
                all_items.extend(items)
            except httpx.HTTPError as exc:
                errors.append(f"{source_label}: {exc}")
            except ET.ParseError as exc:
                errors.append(f"{source_label}: invalid XML: {exc}")
            except Exception as exc:
                errors.append(f"{source_label}: {exc}")

        # No feeds configured -> trivially successful with no items.
        if not self.feeds:
            return NewsResult(ok=True, items=[])

        # All feeds failed.
        if len(errors) == len(self.feeds):
            return NewsResult(ok=False, items=[], error="; ".join(errors))

        return NewsResult(ok=True, items=all_items)
