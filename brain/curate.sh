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

claude -p "$(cat brain/prompt.md)

---

DAILY MODE: today is $TODAY. Append exactly ONE digest entry dated $TODAY.

OWNER CONFIG:
$CONFIG

FACTS BUNDLE (ground truth — output of 'touchline facts'):
$FACTS" \
  --allowedTools "WebSearch,WebFetch,Read,Edit,Write,Bash(node:*),Bash(curl:*)" \
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
