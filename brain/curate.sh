#!/usr/bin/env bash
# touchline brain — run daily with coffee. Usage: ./brain/curate.sh [--no-deploy]
set -euo pipefail
cd "$(dirname "$0")/.."

# The league table goes straight to site/data/table.json — it is a fact, not a
# reading of one. The bundle passes through unchanged for the brain.
FACTS="$(uv run touchline facts | node brain/split-league.mjs)"
TODAY="$(printf '%s' "$FACTS" | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).date')"
if [[ ! "$TODAY" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
  echo "could not extract a valid 'date' from the facts bundle" >&2
  exit 1
fi
CONFIG="$(cat fiveaside.config.json)"

# News is fetched here, mechanically, so the brain reads instead of crawls
# (brain/news.mjs — profiled 2026-09-05: hand-crawling cost most of the run).
# A dead feed lands in the bundle's `errors`; the run goes on without it.
NEWS="$(node brain/news.mjs 2>/dev/null || echo '{"feeds":[],"errors":[{"error":"news.mjs failed"}]}')"

caffeinate -i claude -p "$(cat brain/prompt.md)

---

DAILY MODE: today is $TODAY. Append exactly ONE digest entry dated $TODAY.

OWNER CONFIG:
$CONFIG

FACTS BUNDLE (ground truth — output of 'touchline facts'):
$FACTS

NEWS BUNDLE (pre-fetched just now from the feeds in brain/sources.md — headline,
standfirst, opening paragraphs, published time, source; wires carry headlines
only). Start here. Fetch a page only to verify a claim you will print or to
follow a lead this bundle raises; do not re-crawl the feeds. If `errors` is
non-empty, say plainly that a source was unavailable.
$NEWS" \
  --allowedTools "WebSearch,WebFetch,Read,Edit,Write,Bash(node:*),Bash(curl:*)" \
  --strict-mcp-config \
  --permission-mode acceptEdits

if git diff --quiet -- site/data/digests.json; then
  echo "nothing new to publish"
  exit 0
fi

# stamp the refresh time the site footer shows
node -e '
  const fs = require("fs");
  const p = "site/data/digests.json";
  const d = JSON.parse(fs.readFileSync(p, "utf8"));
  fs.writeFileSync(p, JSON.stringify({ ...d, generated_at: new Date().toISOString() }, null, 2) + "\n");
'

# On validation failure, keep the rejected output for debugging but RESTORE
# digests.json — otherwise the invalid entry sits in the working tree with
# today's date, auto.sh reads it, concludes today is done, and the day's
# digest silently never happens.
# The copy editor: a small model rewrites only the sentences that fail
# brain/lint-prose.mjs, keeping every fact. The validator below is the referee.
node brain/plain.mjs site/data/digests.json || echo "plain pass failed — validating what the brain wrote"

node brain/validate.mjs site/data/digests.json \
  || { echo "digests.json failed validation — NOT committing";
       cp site/data/digests.json "brain/scratch/rejected-$TODAY.json";
       git checkout -- site/data/digests.json;
       echo "rejected output saved to brain/scratch/rejected-$TODAY.json; digests.json restored so the next hourly run retries";
       exit 1; }

git add site/data/digests.json site/data/table.json
git commit -m "digest: $TODAY"
git push -q || echo "push failed — run 'git push' manually"

if [ "${1:-}" != "--no-deploy" ]; then
  ./deploy.sh
fi
