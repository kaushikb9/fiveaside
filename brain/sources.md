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

Evergreen football writing is welcome for `read` — a great older piece
beats a mediocre new one.
