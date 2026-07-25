# Sources

1. **Facts bundle** (provided in the task message — output of
   `uv run touchline facts`): ground truth for scores, fixtures, tables,
   form. Free-tier football-data.org under the hood.
2. **r/soccer, top of the last day** —
   https://www.reddit.com/r/soccer/top/.rss?t=day — the community-voted
   pulse of the game. (Reddit's public .json endpoints 403; RSS works.)
3. **Club subreddit** — https://www.reddit.com/r/<club.subreddit>/top/.rss?t=day
   with `club.subreddit` from OWNER CONFIG — the fan mood.
4. **Editorial feeds** — every entry in OWNER CONFIG `feeds` (label + URL).

Evergreen football writing is welcome for `read` — a great older piece
beats a mediocre new one.
