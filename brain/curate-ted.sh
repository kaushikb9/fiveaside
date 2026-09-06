#!/usr/bin/env bash
# Ted's fifteen, on demand and on its own. Usage:
#   ./brain/curate-ted.sh <gw> <as-of YYYY-MM-DD> [--no-deploy]
#
# The daily run writes Ted's section only in the draft window. This is the
# out-of-band pick for when that is not enough — the first week, a run that
# failed, or KB wanting a team on the board NOW. It writes ONLY `ted`, for the
# gameweek given, as if written on the date given, and settles it as a draft
# for that gameweek regardless of the clock. Nothing else in fpl.json moves.
set -euo pipefail
cd "$(dirname "$0")/.."
GW="${1:?gameweek}"; ASOF="${2:?as-of date YYYY-MM-DD}"; shift 2

BUNDLE="$(uv run touchline fpl)"
CONFIG="$(cat fiveaside.config.json)"
printf '%s' "$BUNDLE" | node brain/split-facts.mjs > brain/scratch/facts-fpl.json
FACTS="$(cat brain/scratch/facts-fpl.json)"
NEWS="$(node brain/news.mjs 2>/dev/null || echo '{"feeds":[],"errors":[{"error":"news.mjs failed"}]}')"
cp site/data/fpl.json brain/scratch/fpl-before.json

caffeinate -i claude -p "$(cat brain/fpl-prompt.md)

---

TED ONLY MODE. Pretend today is $ASOF and gameweek $GW has NOT kicked off.
Write ONLY the \`ted\` section of site/data/fpl.json, for gameweek $GW, as a
draft team sheet: \`gw\`: $GW, \`written\`: \"$ASOF\", \`picks\` (15, ids from
site/data/players.json), \`why\`, \`left_out\` if there is one, \`watchlist\`.
Use only what was knowable on $ASOF: form up to the gameweek before, prices,
the gameweek $GW fixtures, injury news. Any gameweek $GW score, minute or
bonus in the bundle below is from AFTER your pretend date — do not use it,
do not mention it, do not let it steer a pick. Do not touch any other
section of the file. TED PHASE: {\"phase\":\"draft\",\"gw\":$GW}

OWNER CONFIG:
$CONFIG

FACTS BUNDLE:
$FACTS

NEWS BUNDLE:
$NEWS" \
  --allowedTools "Read,Edit,Write,Bash(node:*)" \
  --strict-mcp-config \
  --permission-mode acceptEdits

# Only `ted` may have moved. Everything else is put back from the copy taken
# before the run, then the section is settled as a draft for this gameweek.
node -e '
  const fs = require("fs");
  const before = JSON.parse(fs.readFileSync("brain/scratch/fpl-before.json", "utf8"));
  const after = JSON.parse(fs.readFileSync("site/data/fpl.json", "utf8"));
  const out = { ...before, ted: after.ted };
  fs.writeFileSync("site/data/fpl.json", JSON.stringify(out, null, 2) + "\n");
'
node brain/ted.mjs settle brain/scratch/fpl-before.json site/data/fpl.json --phase draft --gw "$GW"
node brain/plain.mjs site/data/fpl.json || echo "plain pass failed — validating what the brain wrote"
node brain/validate-fpl.mjs site/data/fpl.json \
  || { echo "fpl.json failed validation — NOT committing";
       cp site/data/fpl.json "brain/scratch/rejected-ted-$ASOF.json";
       git checkout -- site/data/fpl.json; exit 1; }

git add site/data/fpl.json site/data/players.json site/data/gaffers.json
git commit -m "fpl: Ted's fifteen for GW$GW, as of $ASOF"
git push -q || echo "push failed — run 'git push' manually"
[ "${1:-}" = "--no-deploy" ] || ./deploy.sh
