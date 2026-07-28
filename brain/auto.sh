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
# (--autostash: a stray uncommitted edit must not wedge the pull for days)
git pull --rebase --autostash -q || { echo "[auto] $(date '+%F %T') — git pull failed, skipping"; exit 0; }

# already curated today? (source of truth: the data itself, not a stamp file)
LATEST=$(node -e "const d=require('./site/data/digests.json').digests;console.log(d.map(x=>x.date).sort().pop())")
[ "$LATEST" = "$(date +%F)" ] && exit 0

# offline? try again next hour
curl -sf --max-time 10 https://touchline-chelsea.pages.dev >/dev/null || exit 0

echo "[auto] $(date '+%F %T') — digest due, running"
./brain/curate.sh
echo "[auto] $(date '+%F %T') — done"
