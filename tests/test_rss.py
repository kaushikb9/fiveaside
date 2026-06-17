"""Tests for RSSNewsClient — mirrors the style of test_football_data.py."""

from datetime import UTC, datetime
from pathlib import Path

import httpx
import pytest

from terrace.sources.base import NewsResult, NewsSource
from terrace.sources.rss import RSSNewsClient

FIXTURE_PATH = Path(__file__).parent / "fixtures" / "news" / "bbc_football.xml"

_BBC_LABEL = "BBC Sport"
_BBC_URL = "https://feeds.bbci.co.uk/sport/football/rss.xml"


def _fixture_bytes() -> bytes:
    return FIXTURE_PATH.read_bytes()


def _client_with_response(content: bytes, *, status: int = 200) -> RSSNewsClient:
    """Build an RSSNewsClient backed by a MockTransport returning *content*."""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            status,
            content=content,
            headers={"content-type": "application/rss+xml"},
        )

    transport = httpx.MockTransport(handler)
    return RSSNewsClient(
        feeds=[(_BBC_LABEL, _BBC_URL)],
        client=httpx.Client(transport=transport),
    )


# ---------------------------------------------------------------------------
# Happy-path parsing
# ---------------------------------------------------------------------------


def test_happy_path_item_count():
    """Fixture has 5 items; item 3 has no title and must be skipped -> 4 items."""
    result = _client_with_response(_fixture_bytes()).fetch_news()

    assert result.ok is True
    assert result.error is None
    assert len(result.items) == 4


def test_happy_path_asserted_item_fields():
    """First item carries correct title, link, source, and a non-None published."""
    result = _client_with_response(_fixture_bytes()).fetch_news()

    first = result.items[0]
    assert first.title == "England reach Euro 2026 final with dramatic comeback"
    assert first.link == "https://www.bbc.co.uk/sport/football/articles/england-euro-2026-final"
    assert first.source == _BBC_LABEL
    assert first.published is not None


def test_all_items_carry_correct_source_label():
    """Every parsed item must have the source label from the feed config."""
    result = _client_with_response(_fixture_bytes()).fetch_news()

    for item in result.items:
        assert item.source == _BBC_LABEL


# ---------------------------------------------------------------------------
# Resilience: missing title
# ---------------------------------------------------------------------------


def test_missing_title_item_is_skipped_but_siblings_survive():
    """Item 3 (no <title>) is not in the result; adjacent items are present."""
    result = _client_with_response(_fixture_bytes()).fetch_news()

    links = {item.link for item in result.items}
    # The no-title item's link must be absent.
    assert "https://www.bbc.co.uk/sport/football/articles/no-title-item" not in links

    titles = [item.title for item in result.items]
    # Items immediately before and after item 3 must both survive.
    assert any("Haaland" in t for t in titles), "item before missing-title is gone"
    assert any("Spain" in t for t in titles), "item after missing-title is gone"


# ---------------------------------------------------------------------------
# Resilience: bad pubDate
# ---------------------------------------------------------------------------


def test_bad_pubdate_item_is_kept_with_published_none():
    """Item 4 has an unparseable <pubDate>; it must appear with published=None."""
    result = _client_with_response(_fixture_bytes()).fetch_news()

    spain = next((i for i in result.items if "Spain" in i.title), None)
    assert spain is not None, "Spain item was dropped instead of kept with published=None"
    assert spain.published is None


# ---------------------------------------------------------------------------
# Degradation: HTTP errors
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("status_code", [429, 500, 503])
def test_http_error_degrades_to_ok_false(status_code: int):
    """Non-2xx HTTP response -> ok=False, items=[], error is set."""
    result = _client_with_response(b"", status=status_code).fetch_news()

    assert result.ok is False
    assert result.items == []
    assert result.error is not None


def test_network_error_degrades_gracefully():
    """Connection error -> ok=False, items=[], error is set."""

    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused")

    transport = httpx.MockTransport(handler)
    client = RSSNewsClient(
        feeds=[(_BBC_LABEL, _BBC_URL)],
        client=httpx.Client(transport=transport),
    )
    result = client.fetch_news()

    assert result.ok is False
    assert result.items == []
    assert result.error is not None


# ---------------------------------------------------------------------------
# Degradation: malformed XML
# ---------------------------------------------------------------------------


def test_malformed_xml_degrades_gracefully():
    """Malformed XML content -> ok=False, items=[], error is set."""
    bad_xml = b"<rss><channel><item><title>Oops</title>"
    result = _client_with_response(bad_xml).fetch_news()

    assert result.ok is False
    assert result.items == []
    assert result.error is not None


# ---------------------------------------------------------------------------
# Protocol conformance
# ---------------------------------------------------------------------------


def test_isinstance_news_source():
    """RSSNewsClient must satisfy the NewsSource runtime-checkable Protocol."""
    client = RSSNewsClient()
    assert isinstance(client, NewsSource)


# ---------------------------------------------------------------------------
# Multi-feed: partial failure
# ---------------------------------------------------------------------------


def test_partial_feed_failure_returns_ok_true_with_successful_items():
    """If one feed fails but another succeeds, ok=True and items from the good feed."""
    fixture = _fixture_bytes()

    def handler(request: httpx.Request) -> httpx.Response:
        if "bbc" in request.url.host:
            return httpx.Response(
                200,
                content=fixture,
                headers={"content-type": "application/rss+xml"},
            )
        # Second feed always errors.
        return httpx.Response(500)

    transport = httpx.MockTransport(handler)
    client = RSSNewsClient(
        feeds=[
            (_BBC_LABEL, _BBC_URL),
            ("Other Feed", "https://example.com/rss.xml"),
        ],
        client=httpx.Client(transport=transport),
    )
    result = client.fetch_news()

    assert result.ok is True
    assert len(result.items) == 4  # only BBC items survive


def test_all_feeds_fail_returns_ok_false():
    """When every configured feed fails, ok=False and error summarises all failures."""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500)

    transport = httpx.MockTransport(handler)
    client = RSSNewsClient(
        feeds=[
            (_BBC_LABEL, _BBC_URL),
            ("Other Feed", "https://example.com/rss.xml"),
        ],
        client=httpx.Client(transport=transport),
    )
    result = client.fetch_news()

    assert result.ok is False
    assert result.items == []
    assert result.error is not None


def test_result_is_news_result_instance():
    """fetch_news() always returns a NewsResult."""
    result = _client_with_response(_fixture_bytes()).fetch_news()
    assert isinstance(result, NewsResult)


# ---------------------------------------------------------------------------
# Test-engineer additions: coverage gaps identified during review
# ---------------------------------------------------------------------------


def test_summary_field_is_populated_from_description():
    """The <description> element is mapped to the summary field on each NewsItem."""
    result = _client_with_response(_fixture_bytes()).fetch_news()

    first = result.items[0]
    assert first.summary == (
        "England beat France 3-2 to book their place in the final after "
        "a stunning second-half fightback."
    )


def test_item_with_missing_link_is_skipped():
    """An item with no <link> is silently skipped; other items survive."""
    xml = b"""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <item>
      <title>Valid item</title>
      <link>https://example.com/valid</link>
    </item>
    <item>
      <title>No link item</title>
    </item>
    <item>
      <title>Another valid item</title>
      <link>https://example.com/another</link>
    </item>
  </channel>
</rss>"""
    result = _client_with_response(xml).fetch_news()

    assert result.ok is True
    assert len(result.items) == 2
    links = {item.link for item in result.items}
    assert "https://example.com/valid" in links
    assert "https://example.com/another" in links


def test_item_with_whitespace_only_title_is_skipped():
    """An item whose <title> contains only whitespace is treated as missing and skipped."""
    xml = b"""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <item>
      <title>   </title>
      <link>https://example.com/whitespace-title</link>
    </item>
    <item>
      <title>Real title</title>
      <link>https://example.com/real</link>
    </item>
  </channel>
</rss>"""
    result = _client_with_response(xml).fetch_news()

    assert result.ok is True
    assert len(result.items) == 1
    assert result.items[0].title == "Real title"


def test_published_datetime_has_correct_value():
    """Item 1 pubDate 'Tue, 17 Jun 2026 20:00:00 +0000' parses to the expected UTC datetime."""
    result = _client_with_response(_fixture_bytes()).fetch_news()

    first = result.items[0]
    assert first.published is not None
    assert first.published == datetime(2026, 6, 17, 20, 0, 0, tzinfo=UTC)


def test_empty_feeds_list_returns_ok_true_no_items():
    """When feeds=[] the client trivially succeeds with an empty items list and no error."""
    client = RSSNewsClient(feeds=[])
    result = client.fetch_news()

    assert result.ok is True
    assert result.items == []
    assert result.error is None


def test_error_message_contains_source_label_on_http_failure():
    """The error string must identify which source failed by name."""
    result = _client_with_response(b"", status=500).fetch_news()

    assert result.ok is False
    assert result.error is not None
    assert _BBC_LABEL in result.error


def test_feed_with_no_items_returns_ok_true_empty_list():
    """A valid RSS feed that contains zero <item> elements parses cleanly to ok=True, items=[]."""
    xml = b"""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Empty feed</title>
    <link>https://example.com</link>
  </channel>
</rss>"""
    result = _client_with_response(xml).fetch_news()

    assert result.ok is True
    assert result.items == []
    assert result.error is None
