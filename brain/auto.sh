#!/usr/bin/env bash
# launchd wrapper: safe to run every hour — does nothing unless a digest is
# actually due. Installed via brain/com.kb.fiveaside.plist (see README).
set -euo pipefail
# launchd has a bare PATH; claude/node/npx/uv live here
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
cd "$(dirname "$0")/.."

# digests are a morning ritual — don't curate in the middle of the night
[ "$(date +%H)" -ge 7 ] || exit 0

# ---------------------------------------------------------------- guards
# This script commits, pushes AND deploys. All three act on whatever is
# checked out at that moment, and on 2026-08-29 that cost three separate
# incidents in one day: a `git checkout` aborted because this had just written
# data files, so a session's commits landed on a feature branch; the live site
# ended up ahead of main; and a deploy from a dirty tree would have shipped
# somebody's half-finished work.
#
# So: only ever act on main, and only ever when the sole changes are the
# mechanical data files this script owns. A session in progress is a reason to
# do nothing at all — the next hourly run will pick it up.
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)
if [ "$BRANCH" != "main" ]; then
  echo "[auto] $(date '+%F %T') — on '$BRANCH', not main; skipping so a session's branch is left alone"
  exit 0
fi

# Anything modified that is NOT one of this script's own data files means
# somebody is working. Deploying then would publish their work in progress.
OTHERS=$(git status --porcelain -- .   ':(exclude)site/data/players.json'   ':(exclude)site/data/gaffers.json'   ':(exclude)site/data/table.json'   ':(exclude)site/data/digests.json'   ':(exclude)site/data/fpl.json' | head -5)
if [ -n "$OTHERS" ]; then
  echo "[auto] $(date '+%F %T') — working tree has changes that are not mine; a session is live, skipping"
  echo "$OTHERS" | sed 's/^/[auto]   /'
  exit 0
fi

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

# The MECHANICAL refresh is cheap and has no LLM in it: standings, prices,
# points, squads, captaincy and chips, straight from the APIs to disk. Run it
# every hour regardless of whether either brain is due, so the pitch, table and
# files are never a day stale just because the editorial was already written
# today. Deploy only if something actually changed.
if
  uv run touchline facts 2>/dev/null | node brain/split-league.mjs >/dev/null 2>&1 &&
  uv run touchline fpl 2>/dev/null | node brain/split-facts.mjs >/dev/null 2>&1
then
  if node brain/validate-players.mjs >/dev/null 2>&1 \
     && node -e "const t=require('./site/data/table.json'); if(!Array.isArray(t.rows)||!t.rows.length) process.exit(1)" \
     && ! git diff --quiet -- site/data/players.json site/data/gaffers.json site/data/table.json; then
    echo "[auto] $(date '+%F %T') — mechanical data moved, publishing"
    git add site/data/players.json site/data/gaffers.json site/data/table.json
    git commit -qm "data: $(date '+%F %H:%M') mechanical refresh" || true
    git push -q 2>/dev/null || echo "[auto] push failed"
    ./deploy.sh >/tmp/fiveaside-deploy.log 2>&1 \
      || { echo "[auto] deploy failed"; tail -5 /tmp/fiveaside-deploy.log | sed 's/^/[auto]   /'; }
  fi
else
  echo "[auto] $(date '+%F %T') — facts refresh failed, skipping"
  git checkout -- site/data/players.json site/data/gaffers.json site/data/table.json 2>/dev/null || true
fi


# ---------------------------------------------------------------- freshness
# On 2026-08-30 wrangler's OAuth token expired. Every hourly run after that
# curated, committed and pushed correctly, then failed at the deploy — and
# said so only as "[auto] deploy failed" in this log, where nobody was
# reading. The live site sat four days stale, still telling the room that
# gameweek 2 was being played, until a human noticed and asked.
#
# So the last word of every run is not "did the deploy command exit 0" but
# "is the site serving what is on disk". That catches any deploy path that
# fails quietly, not just the one that did.
check_live_fresh() {
  local stale
  stale=$(node -e '
    const files = ["table", "digests", "fpl"];
    // Two hourly runs of slack: a refresh that lands while a deploy is still
    // uploading is normal, and must not cry wolf.
    const SLACK_MS = 2 * 60 * 60 * 1000;
    (async () => {
      const bad = [];
      for (const f of files) {
        let local;
        try { local = require("./site/data/" + f + ".json").generated_at; } catch (e) {}
        if (!local) continue;
        let live;
        try {
          const r = await fetch("https://fiveaside.pages.dev/data/" + f + ".json");
          live = (await r.json()).generated_at;
        } catch (e) { bad.push(f + " unreachable"); continue; }
        const behind = Date.parse(local) - Date.parse(live);
        // Negated so an unparseable date (NaN) reports rather than passes.
        if (!(behind < SLACK_MS)) {
          bad.push(f + " " + Math.round(behind / 3600000) + "h behind");
        }
      }
      process.stdout.write(bad.join(", "));
    })();
  ' 2>/dev/null) || stale="freshness check itself failed"
  [ -n "$stale" ] || return 0
  echo "[auto] $(date '+%F %T') — LIVE SITE IS STALE: $stale"
  osascript -e "display notification \"$stale\" with title \"Five-a-Side is stale\" subtitle \"the site is not serving what is on disk\"" 2>/dev/null || true
}
trap check_live_fresh EXIT

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
