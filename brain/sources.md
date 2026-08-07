# Sources

1. **Facts bundle** (provided in the task message — output of
   `uv run touchline facts`): ground truth for scores, fixtures, tables,
   form. Served by the source selected in `touchline.config.json` (`source`: ESPN by default; api-football or football-data.org selectable).
2. **r/soccer, top of the last day** —
   https://www.reddit.com/r/soccer/top/.rss?t=day — the community-voted
   pulse of the game. (Reddit's public .json endpoints 403; RSS works.)
3. **Club subreddit** — https://www.reddit.com/r/<club.subreddit>/top/.rss?t=day
   with `club.subreddit` from OWNER CONFIG — the fan mood.
4. **Editorial feeds** — every entry in OWNER CONFIG `feeds` (label + URL).
5. **Rival subreddits** — https://www.reddit.com/r/<rivals[].subreddit>/top/.rss?t=day
   for each entry in OWNER CONFIG `rivals` — each rival club's own top
   story of the day, feeding the `rivals` notes.
6. **Transfer reporters** (transfer windows; mandatory for `rumours` and any
   transfer story in `week`). Their tweets are the primary wire, but Twitter
   and every nitter mirror are bot-walled from this pipeline — so read them
   through Google News RSS, which picks up their reports within hours:
   - David Ornstein (tier-1, the gold standard):
     https://news.google.com/rss/search?q=%22David+Ornstein%22+when:2d&hl=en-GB&gl=GB&ceid=GB:en
   - Kieran Gill (Daily Mail, Chelsea correspondent):
     https://news.google.com/rss/search?q=%22Kieran+Gill%22+chelsea+when:2d&hl=en-GB&gl=GB&ceid=GB:en
   - Nizaar Kinsella (Chelsea correspondent):
     https://news.google.com/rss/search?q=%22Nizaar+Kinsella%22+when:2d&hl=en-GB&gl=GB&ceid=GB:en
   - Fabrizio Romano (gossip tier — see the reporter-weighting rule in
     brain/prompt.md before grading anything off him):
     https://news.google.com/rss/search?q=%22Fabrizio+Romano%22+chelsea+OR+%22premier+league%22+when:1d&hl=en-GB&gl=GB&ceid=GB:en
   These feeds surface aggregator write-ups; when a claim matters, prefer
   the primary outlet (The Athletic, Daily Mail, BBC) among the results.

Fetch notes: reddit's RSS rate-limits bursts — space calls a few seconds
apart and retry 429s via old.reddit.com. Reddit's search.rss endpoint
returns empty feeds (broken) — don't rely on flair searches; use the
top-of-day feeds plus the reporter feeds above for transfer coverage.

Evergreen football writing is welcome for `read` — a great older piece
beats a mediocre new one.
