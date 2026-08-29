#!/usr/bin/env bash
# Deploy touchline to Cloudflare Pages. Run from anywhere; wrangler runs at repo root.
set -euo pipefail
cd "$(dirname "$0")"

# ---------------------------------------------------------------- guard
# A deploy publishes the WORKING TREE, not a commit. On 2026-08-29 two commits
# landed on a feature branch because `git checkout main` had aborted, the
# deploy went out anyway, and the live site sat ahead of main for an hour —
# where the next deploy from a fresh clone would have silently reverted it.
#
# So a deploy from anywhere but main has to be deliberate. Set
# ALLOW_BRANCH_DEPLOY=1 when it genuinely is.
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)
if [ "$BRANCH" != "main" ] && [ "${ALLOW_BRANCH_DEPLOY:-}" != "1" ]; then
  echo "refusing to deploy from '$BRANCH' — the live site should match main." >&2
  echo "merge it first, or run again with ALLOW_BRANCH_DEPLOY=1 if you mean it." >&2
  exit 1
fi

cp touchline.config.json site/data/config.json

# Cache-bust from content, not from memory. A hand-typed ?v= was forgotten
# once and served a stale app.js against fresh markup — the page rendered,
# just without the feature that had been added.
node brain/stamp-assets.mjs

# Split public from private. The five's squads and weekly reads go to KV and
# are pulled OUT of the upload — a login wall in front of a page whose data
# sits at /data/gaffers.json would protect nothing.
node brain/publish-private.mjs
KV="371bb71f0a1245f697375846236bd58b"
CI=1 npx wrangler kv key put --namespace-id "$KV" "private:gaffers" \
  --path brain/scratch/private/gaffers.json --remote >/dev/null
CI=1 npx wrangler kv key put --namespace-id "$KV" "private:people" \
  --path brain/scratch/private/people.json --remote >/dev/null

# Stage the trimmed site: the repo keeps the whole document, the upload does not.
BACKUP="$(mktemp -d)"
cp site/data/gaffers.json "$BACKUP/" 2>/dev/null || true
cp site/data/fpl.json "$BACKUP/" 2>/dev/null || true
# Replace, do not delete — see brain/publish-private.mjs for why.
cp brain/scratch/public/gaffers.json site/data/gaffers.json
cp brain/scratch/public/fpl.json site/data/fpl.json
restore() { cp "$BACKUP"/gaffers.json site/data/ 2>/dev/null || true
            cp "$BACKUP"/fpl.json site/data/ 2>/dev/null || true; rm -rf "$BACKUP"; }
trap restore EXIT

OUT=$(CI=1 npx wrangler pages deploy --branch main 2>&1) || { echo "$OUT"; exit 1; }

# The silent failure this catches: deploying from the wrong directory drops the
# functions/ bundle, and /api/* 404s to the static site with no other signal.
echo "$OUT" | grep -q "Uploading Functions bundle" \
  || { echo "$OUT"; echo "ERROR: Functions bundle missing from deploy — /api/live would be dead"; exit 1; }

echo "$OUT" | tail -2
