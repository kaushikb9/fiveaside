#!/usr/bin/env bash
# launchd wrapper: safe to run every hour — does nothing unless a digest is
# actually due. Installed via brain/com.kb.touchline.plist (see README).
set -euo pipefail
# launchd has a bare PATH; claude/node/npx/uv live here
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
cd "$(dirname "$0")/.."

# digests are a morning ritual — don't curate in the middle of the night
[ "$(date +%H)" -ge 7 ] || exit 0

# sync first — the other laptop may have curated already
# (--autostash: a stray uncommitted edit must not wedge the pull; timeout +
# non-interactive ssh: a hung fetch once blocked launchd for 33 hours)
export GIT_TERMINAL_PROMPT=0
export GIT_SSH_COMMAND="ssh -oBatchMode=yes -oConnectTimeout=15"
timeout 90 git pull --rebase --autostash -q \
  || { echo "[auto] $(date '+%F %T') — git pull failed/timed out, skipping"; exit 0; }

# Already curated today? Source of truth is the data itself, not a stamp file.
# Two independent brains, two freshness checks — neither suppresses the other:
#   curate.sh    -> digests.json  (touchline, the league room)
#   curate-fpl.sh -> fpl.json     (the gaffers' judgment layer)
# players.json and gaffers.json are mechanical and are rewritten by both.
LATEST=$(node -e "const d=require('./site/data/digests.json').digests;console.log(d.map(x=>x.date).sort().pop())")
# generated_at is stamped in UTC; `date +%F` below is LOCAL. In IST those
# disagree for the first five and a half hours of every day, so convert
# rather than slicing the ISO string and calling it a date.
FPL_DATE=$(node -e "try{const t=require('./site/data/fpl.json').generated_at;console.log(t?new Date(t).toLocaleDateString('en-CA'):'')}catch{console.log('')}")
DIGEST_DUE=$([ "$LATEST" = "$(date +%F)" ] || echo yes)
FPL_DUE=$([ "$FPL_DATE" = "$(date +%F)" ] || echo yes)

# offline? try again next hour
curl -sf --max-time 10 https://fiveaside.pages.dev >/dev/null || exit 0

# The MECHANICAL refresh is cheap and has no LLM in it: prices, points,
# squads, captaincy and chips, straight from the API to disk. Run it every
# hour regardless of whether either brain is due, so the pitch and the file
# are never a day stale just because the editorial was already written today.
# Deploy only if something actually changed.
if uv run touchline fpl 2>/dev/null | node brain/split-facts.mjs >/dev/null 2>&1; then
  if node brain/validate-players.mjs >/dev/null 2>&1 \
     && ! git diff --quiet -- site/data/players.json site/data/gaffers.json; then
    echo "[auto] $(date '+%F %T') — mechanical data moved, publishing"
    git add site/data/players.json site/data/gaffers.json
    git commit -qm "data: $(date '+%F %H:%M') mechanical refresh" || true
    git push -q 2>/dev/null || echo "[auto] push failed"
    ./deploy.sh >/dev/null 2>&1 || echo "[auto] deploy failed"
  fi
else
  echo "[auto] $(date '+%F %T') — facts refresh failed, skipping"
  git checkout -- site/data/players.json site/data/gaffers.json 2>/dev/null || true
fi


# Nothing editorial left to do today — the hourly refresh above has already
# run, which is the point of it being above this line.
[ -n "$DIGEST_DUE$FPL_DUE" ] || { echo "[auto] $(date '+%F %T') — both brains already ran today"; exit 0; }

# `|| echo` so a failed run doesn't starve the other product under set -e
# `caffeinate -dimsu` for the lifetime of each run: this machine has
# `pmset sleep 1` on AC, and a brain run that outlives one minute of idle gets
# killed mid-response ("your computer went to sleep"). -i alone is not enough,
# it only blocks IDLE sleep. Nothing persists after the command exits.
NOSLEEP="caffeinate -dimsu"
command -v caffeinate >/dev/null || NOSLEEP=""

if [ -n "$DIGEST_DUE" ]; then
  echo "[auto] $(date '+%F %T') — digest due, running"
  $NOSLEEP ./brain/curate.sh || echo "[auto] $(date '+%F %T') — digest run failed"
fi
if [ -n "$FPL_DUE" ]; then
  echo "[auto] $(date '+%F %T') — fpl due, running"
  $NOSLEEP ./brain/curate-fpl.sh || echo "[auto] $(date '+%F %T') — fpl run failed"
fi
echo "[auto] $(date '+%F %T') — done"
