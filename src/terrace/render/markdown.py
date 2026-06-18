"""Render a `DailyDigest` as Markdown.

Pure: no I/O, no third-party imports beyond the standard library.
"""

from terrace.core.digest import DailyDigest


def render_markdown(digest: DailyDigest) -> str:
    """Render `digest` as a calm, short Markdown digest."""
    sections = [f"# Touchline — {digest.digest_date.strftime('%A, %d %B %Y')}"]

    yesterday_lines = ["## Yesterday"]
    if digest.yesterday:
        yesterday_lines.extend(f"- {story.story}" for story in digest.yesterday)
    else:
        yesterday_lines.append("_Nothing finished yesterday._")
    if digest.yesterday_headlines:
        yesterday_lines.append("**In the news**")
        yesterday_lines.extend(
            f"- [{item.title}]({item.link}) — {item.source}"
            for item in digest.yesterday_headlines
        )
    sections.append("\n".join(yesterday_lines))

    today_lines = ["## Today"]
    if digest.today:
        today_lines.extend(
            f"- {card.kickoff_label} — {card.fixture.home.name} vs {card.fixture.away.name}"
            for card in digest.today
        )
    else:
        today_lines.append("_No matches today._")
    if digest.today_headlines:
        today_lines.append("**In the news**")
        today_lines.extend(
            f"- [{item.title}]({item.link}) — {item.source}"
            for item in digest.today_headlines
        )
    sections.append("\n".join(today_lines))

    if digest.match_of_the_day is not None:
        motd = digest.match_of_the_day
        home = motd.card.fixture.home.name
        away = motd.card.fixture.away.name
        sections.append(f"## Match of the day\n**{home} vs {away}** — {motd.reason}")

    return "\n\n".join(sections)
