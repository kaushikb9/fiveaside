#!/usr/bin/env bash
# Deploy touchline to Cloudflare Pages. Run from anywhere; wrangler runs at repo root.
set -euo pipefail
cd "$(dirname "$0")"

cp touchline.config.json site/data/config.json

# Cache-bust from content, not from memory. A hand-typed ?v= was forgotten
# once and served a stale app.js against fresh markup — the page rendered,
# just without the feature that had been added.
node brain/stamp-assets.mjs

OUT=$(CI=1 npx wrangler pages deploy --branch main 2>&1) || { echo "$OUT"; exit 1; }

# The silent failure this catches: deploying from the wrong directory drops the
# functions/ bundle, and /api/* 404s to the static site with no other signal.
echo "$OUT" | grep -q "Uploading Functions bundle" \
  || { echo "$OUT"; echo "ERROR: Functions bundle missing from deploy — /api/live would be dead"; exit 1; }

echo "$OUT" | tail -2
