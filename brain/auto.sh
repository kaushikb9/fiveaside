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
FPL_DATE=$(node -e "try{console.log(String(require('./site/data/fpl.json').generated_at||'').slice(0,10))}catch{console.log('')}")
DIGEST_DUE=$([ "$LATEST" = "$(date +%F)" ] || echo yes)
FPL_DUE=$([ "$FPL_DATE" = "$(date +%F)" ] || echo yes)
[ -n "$DIGEST_DUE$FPL_DUE" ] || exit 0

# offline? try again next hour
curl -sf --max-time 10 https://fiveaside.pages.dev >/dev/null || exit 0

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
