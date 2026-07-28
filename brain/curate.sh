#!/usr/bin/env bash
# touchline brain — run daily with coffee. Usage: ./brain/curate.sh [--no-deploy]
set -euo pipefail
cd "$(dirname "$0")/.."

FACTS="$(uv run touchline facts)"
TODAY="$(printf '%s' "$FACTS" | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).date')"
if [[ ! "$TODAY" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
  echo "could not extract a valid 'date' from the facts bundle" >&2
  exit 1
fi
CONFIG="$(cat touchline.config.json)"

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

node brain/validate.mjs site/data/digests.json \
  || { echo "digests.json failed validation — NOT committing"; exit 1; }

git add site/data/digests.json
git commit -m "digest: $TODAY"
git push -q || echo "push failed — run 'git push' manually"

if [ "${1:-}" != "--no-deploy" ]; then
  ./deploy.sh
fi
