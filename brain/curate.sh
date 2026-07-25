#!/usr/bin/env bash
# touchline brain — run daily with coffee. Usage: ./brain/curate.sh [--no-deploy]
set -euo pipefail
cd "$(dirname "$0")/.."

TODAY="$(date +%F)"
FACTS="$(uv run touchline facts)"
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

node brain/validate.mjs site/data/digests.json \
  || { echo "digests.json failed validation — NOT committing"; exit 1; }

git add site/data/digests.json
git commit -m "digest: $TODAY" || echo "nothing new committed"

if [ "${1:-}" != "--no-deploy" ]; then
  ./deploy.sh
fi
