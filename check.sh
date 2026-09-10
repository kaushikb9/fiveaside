#!/usr/bin/env bash
# The one verb. Everything AGENTS.md says to keep green, in one run: ~2s, offline.
# pytest (facts), the three data validators (the JSON the site reads), the five
# API/brain tests with stubbed KV and captured payloads, and a parse of every
# script that ships. Exit 0 = safe to hand back.
set -euo pipefail
cd "$(dirname "$0")"

uv run pytest -q
uv run ruff check .
node brain/validate.mjs
node brain/validate-fpl.mjs
node brain/validate-players.mjs
for t in stars matches split-facts ratelimit ted; do
  node "brain/test/$t.mjs" || { echo "FAIL brain/test/$t.mjs"; exit 1; }
done
node --check site/common.js site/digest.js site/app.js site/archive/app.js \
             site/gaffers/app.js site/locker/app.js functions/api/*.js brain/*.mjs
echo "ok — check.sh green"
