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
CONFIG="$(cat touchline.config.json)"

# The player file is mechanical: ~600 records of prices, minutes and fixtures
# that the site reads directly. Routing it through an LLM would cost ~100k
# tokens a run to copy numbers verbatim, so it goes straight to disk and is
# stripped from the prompt. The brain's job is the judgment layer on top of it
# (verdicts), and for that it uses the compact `players` list it already gets.
printf '%s' "$BUNDLE" | node -e '
  const fs = require("fs");
  const bundle = JSON.parse(fs.readFileSync(0, "utf8"));
  const file = bundle.player_file ?? [];
  fs.writeFileSync(
    "site/data/players.json",
    JSON.stringify(
      { generated_at: new Date().toISOString(), gameweek: bundle.gameweek?.id ?? null, players: file },
      null,
      2
    ) + "\n"
  );
  delete bundle.player_file;
  fs.writeFileSync("brain/scratch/facts-fpl.json", JSON.stringify(bundle, null, 2));
  console.error(`player file: ${file.length} records -> site/data/players.json`);
'
FACTS="$(cat brain/scratch/facts-fpl.json)"

claude -p "$(cat brain/fpl-prompt.md)

---

FPL MODE: today is $TODAY. Update site/data/fpl.json per the file contract.

OWNER CONFIG:
$CONFIG

FACTS BUNDLE (ground truth — output of 'touchline fpl'):
$FACTS" \
  --allowedTools "WebSearch,WebFetch,Read,Edit,Write,Bash(node:*),Bash(curl:*)" \
  --permission-mode acceptEdits

if git diff --quiet -- site/data/fpl.json site/data/players.json; then
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

node brain/validate-fpl.mjs site/data/fpl.json \
  || { echo "fpl.json failed validation — NOT committing";
       cp site/data/fpl.json "brain/scratch/rejected-fpl-$TODAY.json";
       git checkout -- site/data/fpl.json site/data/players.json;
       echo "rejected output saved to brain/scratch/rejected-fpl-$TODAY.json; fpl.json restored so the next hourly run retries";
       exit 1; }

git add site/data/fpl.json site/data/players.json
git commit -m "fpl: $TODAY"
git push -q || echo "push failed — run 'git push' manually"

if [ "${1:-}" != "--no-deploy" ]; then
  ./deploy.sh
fi
