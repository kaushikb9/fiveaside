#!/usr/bin/env node
// Split the league table out of the facts bundle and write it straight to disk.
//
//   uv run touchline facts | node brain/split-league.mjs > brain/scratch/facts.json
//
// Why this exists: a league table is a FACT. It has a source, it has one
// correct answer, and copying it is not judgment. Routing it through the brain
// bought nothing and cost accuracy — the model trimmed 20 rows to the four it
// was asked for plus a few it recognised, which is why the page showed
// positions 1-6, 8, 10 and 17 with holes in between, and it filled the form
// column from memory for the five clubs it had heard of. The bundle carries
// every row and, since 2026-08-27, real form derived from real results.
//
// The brain still writes the table NOTE — that is a reading of the table, and
// a reading is judgment. Same split as split-facts.mjs: numbers to disk,
// opinion to the model.
import { readFileSync, writeFileSync } from "node:fs";

const bundle = JSON.parse(readFileSync(0, "utf8"));

/* The club's own league, not whatever competition happens to sit first: a cup
   group stage also has a "table" and it is not the one the page means. */
const comps = bundle.competitions ?? [];
const league =
  comps.find((c) => c.code === "PL" && (c.table ?? []).length) ??
  comps.find((c) => (c.table ?? []).length) ??
  null;

if (!league) {
  // Not fatal. The site falls back to the digest's own table, and a day
  // without standings is a source outage worth seeing rather than crashing on.
  console.error("split-league: no competition in the bundle carries a table");
} else {
  writeFileSync(
    "site/data/table.json",
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        date: bundle.date ?? null,
        timezone: bundle.timezone ?? null,
        competition: league.name ?? "League table",
        // Verbatim from the bundle, in source order. No trimming: the reason
        // this file exists is that trimming is what went wrong.
        rows: league.table ?? [],
      },
      null,
      2
    ) + "\n"
  );
  console.error(
    `split-league: wrote ${(league.table ?? []).length} rows for ${league.name}`
  );
}

// Pass the bundle through unchanged so the caller can still feed the brain.
process.stdout.write(JSON.stringify(bundle));
