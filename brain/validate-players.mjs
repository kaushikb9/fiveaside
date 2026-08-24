#!/usr/bin/env node
// Validate site/data/players.json — the player file.
// Usage: node brain/validate-players.mjs [path]   (exit 0 ok / exit 1 invalid)
//
// This file is MECHANICAL: written straight from the FPL API by
// `uv run touchline fpl`, never by the brain. Routing ~600 records of prices
// and fixtures through an LLM would cost six figures of tokens to copy numbers
// verbatim, so it bypasses the prompt entirely. The judgment layer lives in
// fpl.json's `verdicts`, keyed by the same element id.
//
// The check that matters most here is the last one: no real names.
import { readFileSync } from "node:fs";

const path = process.argv[2] ?? "site/data/players.json";
const fail = (msg) => {
  console.error(`players.json invalid: ${msg}`);
  process.exit(1);
};

let data;
try {
  data = JSON.parse(readFileSync(path, "utf8"));
} catch (err) {
  fail(err.message);
}

const isNonEmptyStr = (v) => typeof v === "string" && v.trim() !== "";
const isNumber = (v) => typeof v === "number" && Number.isFinite(v);
const POSITIONS = ["GK", "DEF", "MID", "FWD"];

if (typeof data !== "object" || data === null || Array.isArray(data))
  fail("top-level JSON must be an object");
if (!Array.isArray(data.players)) fail("'players' must be an array");
if (data.generated_at !== undefined && !isNonEmptyStr(data.generated_at))
  fail("'generated_at' must be a non-empty string when present");

const ids = new Set();
for (const [i, p] of data.players.entries()) {
  const where = `players[${i}] (${p?.name ?? "?"})`;
  if (!isNumber(p?.id)) fail(`${where}: 'id' must be a number`);
  if (ids.has(p.id)) fail(`${where}: duplicate id ${p.id}`);
  ids.add(p.id);
  for (const key of ["name", "team"]) {
    if (!isNonEmptyStr(p[key])) fail(`${where}: '${key}' must be a non-empty string`);
  }
  if (!POSITIONS.includes(p.pos)) fail(`${where}: 'pos' must be one of ${POSITIONS.join(", ")}`);
  for (const key of ["price", "ownership"]) {
    if (!isNumber(p[key])) fail(`${where}: '${key}' must be a number`);
  }
  if (p.owned_by !== undefined) {
    if (!Array.isArray(p.owned_by)) fail(`${where}: 'owned_by' must be an array`);
    for (const nick of p.owned_by) {
      if (!isNonEmptyStr(nick)) fail(`${where}: 'owned_by' entries must be nicknames`);
    }
  }
  if (p.fixtures !== undefined) {
    if (!Array.isArray(p.fixtures)) fail(`${where}: 'fixtures' must be an array`);
    for (const [fi, f] of p.fixtures.entries()) {
      if (!isNumber(f?.gw)) fail(`${where}, fixtures[${fi}]: 'gw' must be a number`);
      if (!isNonEmptyStr(f?.opp)) fail(`${where}, fixtures[${fi}]: 'opp' must be a non-empty string`);
      if (typeof f?.home !== "boolean") fail(`${where}, fixtures[${fi}]: 'home' must be a boolean`);
      if (!Number.isInteger(f?.fdr) || f.fdr < 1 || f.fdr > 5)
        fail(`${where}, fixtures[${fi}]: 'fdr' must be an integer 1-5`);
    }
  }
  // Evidence only. A verdict living here instead of in fpl.json would mean the
  // facts layer had started forming opinions, which is the boundary this repo
  // exists to keep.
  for (const key of ["verdict", "moved", "trigger", "why"]) {
    if (p[key] !== undefined) fail(`${where}: '${key}' belongs in fpl.json's verdicts, not here`);
  }
}

// The group is identified by nickname; the API's real names are deleted in
// core/fpl.py before they ever reach a file. This is the backstop that fails
// loudly if that ever regresses.
const REAL_NAME_KEYS = ["player_name", "player_first_name", "player_last_name", "manager"];
const blob = JSON.stringify(data);
for (const key of REAL_NAME_KEYS) {
  if (blob.includes(`"${key}"`)) fail(`real-name field '${key}' must never reach this file`);
}

console.log(`players.json OK — ${data.players.length} records`);
