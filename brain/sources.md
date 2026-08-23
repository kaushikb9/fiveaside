# Sources

1. **Facts bundle** (provided in the task message — output of
   `uv run touchline facts`): ground truth for scores, fixtures, tables,
   form. Served by the source selected in `touchline.config.json` (`source`: ESPN by default; api-football or football-data.org selectable).
2. **Reddit is DEAD to this pipeline as of 2026-08-24.** Every subreddit RSS
   feed — r/soccer and all five club subs — now returns Reddit's "Welcome to
   Reddit" login HTML rather than entries. The `.json` endpoints have 403'd
   for a while; RSS has now gone the same way. Do not spend a run's budget
   retrying them, and do not describe fan mood you have not actually read.
   The fan-voice layer is simply absent until a replacement is found.
   Candidates not yet tried: a club forum with an open feed, BlueSky search,
   or the comment sections of the outlets below.
3. **Editorial feeds** — every entry in OWNER CONFIG `feeds` (label + URL).
   Guardian and BBC both work; these carry most of the load now.
4. **Club coverage that still works without a login** — the Standard,
   ReadChelsea, and the Google News reporter feeds in §6. Prefer a named
   correspondent over an aggregator when a claim matters.
5. **FFScout** — article bodies are JS- and membership-gated, so treat it as
   a headline source only. FPL items should be built from match facts and the
   player file rather than from anything scraped off it.
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
