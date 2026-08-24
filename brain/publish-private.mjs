#!/usr/bin/env node
// Split the site's data into what the world may read and what only the five
// may. Run by deploy.sh, before wrangler.
//
// Public  : players.json, digests.json, and fpl.json WITHOUT `people`
// Private : gaffers.json, and fpl.json's `people`
//
// The private half is written to `brain/scratch/private/` for deploy.sh to
// push into KV, and REMOVED from site/data so it is never uploaded as a
// static file. That removal is the whole point: a login wall in front of a
// page whose data sits at /data/gaffers.json protects nothing.
//
// site/data/gaffers.json stays in the repo — it is a build artifact the
// brain and the tests read locally. It just does not get published.
//
// Usage: node brain/publish-private.mjs   (writes brain/scratch/private/*)

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";

const OUT = "brain/scratch/private";
mkdirSync(OUT, { recursive: true });

const read = (p) => JSON.parse(readFileSync(p, "utf8"));

// --- gaffers: entirely private ---
const gaffers = read("site/data/gaffers.json");
writeFileSync(`${OUT}/gaffers.json`, JSON.stringify(gaffers));

// --- fpl.json: split `people` out of the published copy ---
const fpl = read("site/data/fpl.json");
const people = fpl.people ?? [];
writeFileSync(`${OUT}/people.json`, JSON.stringify(people));

const publicFpl = { ...fpl };
delete publicFpl.people;

// Written to a staging path rather than over the source, so the repo keeps
// the whole document and only the upload is trimmed.
mkdirSync("brain/scratch/public", { recursive: true });
writeFileSync("brain/scratch/public/fpl.json", JSON.stringify(publicFpl, null, 2) + "\n");

console.error(
  `private: ${gaffers.people?.length ?? 0} squads, ${people.length} weekly reads · ` +
  `public fpl.json keeps ${Object.keys(publicFpl).length} sections`
);
