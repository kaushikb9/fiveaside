#!/usr/bin/env node
// Rewrite the ?v= cache-buster on every asset link to a hash of what that
// asset actually contains. Run by deploy.sh before publishing.
//
// Why this exists: the version was a hand-typed integer, so changing app.js
// without remembering to bump it served the browser a stale script from cache
// against fresh markup. That failed silently — the page rendered, just without
// whatever had been added. A content hash cannot be forgotten.
//
// Usage: node brain/stamp-assets.mjs   (exit 0, prints what changed)

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname, resolve } from "node:path";

const SITE = "site";

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

const hashOf = (path) => {
  try {
    return createHash("sha256").update(readFileSync(path)).digest("hex").slice(0, 8);
  } catch {
    return null; // asset does not exist; leave the link alone rather than lie
  }
};

const htmlFiles = walk(SITE).filter((p) => p.endsWith(".html"));
let changed = 0;

for (const file of htmlFiles) {
  const before = readFileSync(file, "utf8");
  // href="../style.css?v=10"  |  src="app.js?v=10"
  const after = before.replace(
    /((?:href|src)=")([^"]+?\.(?:css|js))\?v=[^"]*(")/g,
    (whole, lead, href, tail) => {
      // Resolve the asset relative to the HTML file that references it.
      const asset = resolve(dirname(file), href);
      const h = hashOf(asset);
      return h ? `${lead}${href}?v=${h}${tail}` : whole;
    }
  );
  if (after !== before) {
    writeFileSync(file, after);
    changed++;
  }
}

// Stamp the Google client id into the gaffers shell, from the environment.
// Kept out of the repo so the id is configuration rather than source, and so
// a blank one degrades to an honest message instead of a dead button.
const CID = process.env.GOOGLE_CLIENT_ID || "";
const shell = "site/gaffers/index.html";
try {
  const before = readFileSync(shell, "utf8");
  const after = before.replace(/data-google-client-id="[^"]*"/, `data-google-client-id="${CID}"`);
  if (after !== before) writeFileSync(shell, after);
  console.log(CID ? "google client id: stamped" : "google client id: NOT SET — gaffers stays unlocked");
} catch { /* shell missing; nothing to stamp */ }

// Report the stamps so a deploy log shows what version shipped.
const stamps = new Map();
for (const file of htmlFiles) {
  for (const m of readFileSync(file, "utf8").matchAll(/([^"/]+\.(?:css|js))\?v=([a-f0-9]{8})/g)) {
    stamps.set(m[1], m[2]);
  }
}
console.log(
  `stamped ${changed} html file(s) — ` +
  [...stamps].map(([n, h]) => `${n}:${h}`).join(" ")
);
