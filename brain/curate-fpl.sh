#!/usr/bin/env bash
# touchline fpl brain — run daily (auto.sh) or on demand. Usage: ./brain/curate-fpl.sh [--no-deploy]
# Unlike curate.sh this EDITS a living document: current-state sections are
# replaced wholesale and `log` is appended/settled (see brain/fpl-prompt.md).
set -euo pipefail
cd "$(dirname "$0")/.."

BUNDLE="$(uv run touchline fpl)"
TODAY="$(printf '%s' "$BUNDLE" | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).date')"
if [[ ! "$TODAY" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
  echo "could not extract a valid 'date' from the fpl facts bundle" >&2
  exit 1
fi
CONFIG="$(cat fiveaside.config.json)"

# The player file is mechanical: ~600 records of prices, minutes and fixtures
# that the site reads directly. Routing it through an LLM would cost ~100k
# tokens a run to copy numbers verbatim, so it goes straight to disk and is
# stripped from the prompt. The brain's job is the judgment layer on top of it
# (verdicts), and for that it uses the compact `players` list it already gets.
printf '%s' "$BUNDLE" | node brain/split-facts.mjs > brain/scratch/facts-fpl.json
FACTS="$(cat brain/scratch/facts-fpl.json)"

# News is fetched here, mechanically, so the brain reads instead of crawls
# (brain/news.mjs — profiled 2026-09-05: hand-crawling cost most of the run).
# A dead feed lands in the bundle's `errors`; the run goes on without it.
NEWS="$(node brain/news.mjs 2>/dev/null || echo '{"feeds":[],"errors":[{"error":"news.mjs failed"}]}')"

caffeinate -i claude -p "$(cat brain/fpl-prompt.md)

---

FPL MODE: today is $TODAY. Update site/data/fpl.json per the file contract.

OWNER CONFIG:
$CONFIG

FACTS BUNDLE (ground truth — output of 'touchline fpl'):
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

if git diff --quiet -- site/data/fpl.json site/data/players.json site/data/gaffers.json; then
  echo "nothing new to publish"
  exit 0
fi

# stamp the refresh time the site footer shows
node -e '
  const fs = require("fs");
  const p = "site/data/fpl.json";
  const d = JSON.parse(fs.readFileSync(p, "utf8"));
  fs.writeFileSync(p, JSON.stringify({ ...d, generated_at: new Date().toISOString() }, null, 2) + "\n");
'

# On validation failure, keep the rejected output for debugging but RESTORE
# fpl.json — an invalid file left in the tree would carry today's
# generated_at, so auto.sh would conclude today is done and never retry.
node brain/validate-players.mjs site/data/players.json \
  || { echo "players.json failed validation — NOT committing"; git checkout -- site/data/players.json; exit 1; }

# The copy editor: a small model rewrites only the sentences that fail
# brain/lint-prose.mjs, keeping every fact. The validator below is the referee.
node brain/plain.mjs site/data/fpl.json || echo "plain pass failed — validating what the brain wrote"

node brain/validate-fpl.mjs site/data/fpl.json \
  || { echo "fpl.json failed validation — NOT committing";
       cp site/data/fpl.json "brain/scratch/rejected-fpl-$TODAY.json";
       git checkout -- site/data/fpl.json site/data/players.json site/data/gaffers.json;
       echo "rejected output saved to brain/scratch/rejected-fpl-$TODAY.json; fpl.json restored so the next hourly run retries";
       exit 1; }

git add site/data/fpl.json site/data/players.json site/data/gaffers.json
git commit -m "fpl: $TODAY"
git push -q || echo "push failed — run 'git push' manually"

if [ "${1:-}" != "--no-deploy" ]; then
  ./deploy.sh
fi
