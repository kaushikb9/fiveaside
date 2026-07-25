#!/usr/bin/env node
// Validate site/data/digests.json: parse, per-entry schema, no duplicate dates.
// Usage: node brain/validate.mjs [path]   (exit 0 ok / exit 1 invalid)
import { readFileSync } from "node:fs";

const path = process.argv[2] ?? "site/data/digests.json";
const fail = (msg) => {
  console.error(`digests.json invalid: ${msg}`);
  process.exit(1);
};

let data;
try {
  data = JSON.parse(readFileSync(path, "utf8"));
} catch (err) {
  fail(err.message);
}

if (!Array.isArray(data.digests)) fail("top-level 'digests' must be an array");

const dateRe = /^\d{4}-\d{2}-\d{2}$/;
const seen = new Set();

const isNonEmptyStr = (v) => typeof v === "string" && v.trim() !== "";
const isPlainObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const isNumber = (v) => typeof v === "number" && Number.isFinite(v);

// title/url/hook rule shared by `wider[]` items and `read`, with optional `image`/`source`.
function checkLink(where, label, item) {
  if (!item?.title || !item?.url || !item?.hook)
    fail(`${where}: ${label} needs title/url/hook`);
  if (item.image !== undefined && typeof item.image !== "string")
    fail(`${where}: ${label}.image must be a string when present`);
  if (item.source !== undefined && !isNonEmptyStr(item.source))
    fail(`${where}: ${label}.source must be a non-empty string when present`);
}

for (const [i, d] of data.digests.entries()) {
  const where = `entry ${i} (${d?.date ?? "?"})`;
  if (!dateRe.test(d?.date ?? "")) fail(`${where}: 'date' must be YYYY-MM-DD`);
  if (seen.has(d.date)) fail(`${where}: duplicate date`);
  seen.add(d.date);

  for (const key of ["headline", "yesterday", "today"]) {
    if (typeof d[key] !== "string" || !d[key].trim())
      fail(`${where}: '${key}' must be a non-empty string`);
  }

  if (!isPlainObject(d.club)) fail(`${where}: 'club' must be an object`);

  if (d.club.results !== undefined)
    fail(`${where}: club.results is no longer valid — the schema uses club.latest_result now`);

  if (d.club.latest_result !== undefined) {
    const lr = d.club.latest_result;
    if (!isPlainObject(lr)) fail(`${where}: club.latest_result must be an object`);
    for (const key of ["home", "away", "score", "competition"]) {
      if (!isNonEmptyStr(lr[key]))
        fail(`${where}: club.latest_result.${key} must be a non-empty string`);
    }
    for (const key of ["home_crest", "away_crest"]) {
      if (lr[key] !== undefined && lr[key] !== null && typeof lr[key] !== "string")
        fail(`${where}: club.latest_result.${key} must be a string or null when present`);
    }
  }

  if (d.club.fixtures !== undefined) {
    if (!Array.isArray(d.club.fixtures)) fail(`${where}: club.fixtures must be an array when present`);
    for (const [fi, f] of d.club.fixtures.entries()) {
      const fwhere = `${where}, club.fixtures[${fi}]`;
      for (const key of ["opponent", "kickoff_local", "competition"]) {
        if (!isNonEmptyStr(f?.[key])) fail(`${fwhere}: '${key}' must be a non-empty string`);
      }
      if (typeof f?.home !== "boolean") fail(`${fwhere}: 'home' must be a boolean`);
      if (f.opponent_crest !== undefined && f.opponent_crest !== null && typeof f.opponent_crest !== "string")
        fail(`${fwhere}: 'opponent_crest' must be a string or null when present`);
    }
  }

  if (d.club.table !== undefined) {
    const t = d.club.table;
    if (!isPlainObject(t)) fail(`${where}: club.table must be an object`);
    if (!isNonEmptyStr(t.competition)) fail(`${where}: club.table.competition must be a non-empty string`);
    if (!Array.isArray(t.rows)) fail(`${where}: club.table.rows must be an array`);
    for (const [ri, row] of t.rows.entries()) {
      const rwhere = `${where}, club.table.rows[${ri}]`;
      for (const key of ["pos", "played", "points"]) {
        if (!isNumber(row?.[key])) fail(`${rwhere}: '${key}' must be a number`);
      }
      if (!isNonEmptyStr(row?.team)) fail(`${rwhere}: 'team' must be a non-empty string`);
      if (row.crest !== undefined && row.crest !== null && typeof row.crest !== "string")
        fail(`${rwhere}: 'crest' must be a string or null when present`);
    }
    if (!isNumber(t.club_position)) fail(`${where}: club.table.club_position must be a number`);
  }

  if (d.club.form !== undefined) {
    if (!Array.isArray(d.club.form)) fail(`${where}: club.form must be an array when present`);
    for (const [fi, f] of d.club.form.entries()) {
      const fwhere = `${where}, club.form[${fi}]`;
      if (!["W", "L", "D"].includes(f?.result))
        fail(`${fwhere}: 'result' must be exactly "W", "L" or "D"`);
      for (const key of ["score", "opponent", "competition"]) {
        if (!isNonEmptyStr(f?.[key])) fail(`${fwhere}: '${key}' must be a non-empty string`);
      }
      if (f.opponent_crest !== undefined && f.opponent_crest !== null && typeof f.opponent_crest !== "string")
        fail(`${fwhere}: 'opponent_crest' must be a string or null when present`);
    }
  }

  if (!Array.isArray(d.wider)) fail(`${where}: 'wider' must be an array`);
  for (const [wi, w] of d.wider.entries()) {
    checkLink(`${where}, wider[${wi}]`, "wider item", w);
  }
  if (d.read != null) checkLink(where, "'read'", d.read);

  if (d.rivals !== undefined) {
    if (!Array.isArray(d.rivals)) fail(`${where}: 'rivals' must be an array when present`);
    for (const [ri, r] of d.rivals.entries()) {
      const rwhere = `${where}, rivals[${ri}]`;
      for (const key of ["club", "line", "note"]) {
        if (!isNonEmptyStr(r?.[key])) fail(`${rwhere}: '${key}' must be a non-empty string`);
      }
      if (r.crest !== undefined && r.crest !== null && typeof r.crest !== "string")
        fail(`${rwhere}: 'crest' must be a string or null when present`);
    }
  }
}

console.log(`digests.json OK — ${data.digests.length} entries`);
