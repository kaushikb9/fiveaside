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

const isNonEmptyStr = (v) => typeof v === "string" && v.trim() !== "";
const isPlainObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const isNumber = (v) => typeof v === "number" && Number.isFinite(v);

if (!isPlainObject(data)) fail("top-level JSON must be an object");
if (!Array.isArray(data.digests)) fail("top-level 'digests' must be an array");

const dateRe = /^\d{4}-\d{2}-\d{2}$/;
const seen = new Set();
const urlRe = /^https?:\/\//;

// title/url/hook rule shared by `wider[]` items and `read`, with optional `image`/`source`.
function checkLink(where, label, item) {
  if (!isNonEmptyStr(item?.title) || !isNonEmptyStr(item?.url) || !isNonEmptyStr(item?.hook))
    fail(`${where}: ${label} needs title/url/hook`);
  if (!urlRe.test(item.url)) fail(`${where}: ${label}.url must start with http:// or https://`);
  if (item.image !== undefined) {
    if (!isNonEmptyStr(item.image) || !urlRe.test(item.image))
      fail(`${where}: ${label}.image must be a non-empty http(s) URL string when present`);
  }
  if (item.source !== undefined && !isNonEmptyStr(item.source))
    fail(`${where}: ${label}.source must be a non-empty string when present`);
}

for (const [i, d] of data.digests.entries()) {
  const where = `entry ${i} (${d?.date ?? "?"})`;
  if (!dateRe.test(d?.date ?? "")) fail(`${where}: 'date' must be YYYY-MM-DD`);
  if (seen.has(d.date)) fail(`${where}: duplicate date`);
  seen.add(d.date);

  if (typeof d.headline !== "string" || !d.headline.trim())
    fail(`${where}: 'headline' must be a non-empty string`);
  // `today` was the owner's-next-match section, dropped when the page became a
  // league page. Legacy entries keep it; new ones must not write it.
  if (d.today !== undefined && !isNonEmptyStr(d.today))
    fail(`${where}: 'today' must be a non-empty string when present (legacy key)`);
  if (d.yesterday !== undefined)
    fail(`${where}: 'yesterday' is no longer valid — the schema uses the 'week' array now`);
  if (!Array.isArray(d.week) || d.week.length === 0)
    fail(`${where}: 'week' must be a non-empty array`);
  for (const item of d.week) {
    if (!isNonEmptyStr(item?.kicker) || !isNonEmptyStr(item?.text))
      fail(`${where}: every 'week' item needs non-empty kicker and text`);
    // The feed is filterable, so items say which world they belong to.
    if (item.tag !== undefined && !["PL", "FPL"].includes(item.tag))
      fail(`${where}: week item 'tag' must be "PL" or "FPL" when present`);
    if (item.club !== undefined && !isNonEmptyStr(item.club))
      fail(`${where}: week item 'club' must be a non-empty string when present`);
  }
  if (d.team_watch !== undefined) {
    if (!Array.isArray(d.team_watch)) fail(`${where}: 'team_watch' must be an array`);
    for (const p of d.team_watch) {
      for (const key of ["name", "tag", "note"])
        if (!isNonEmptyStr(p?.[key]))
          fail(`${where}: every 'team_watch' item needs non-empty ${key}`);
      if (p.talent !== undefined && typeof p.talent !== "boolean")
        fail(`${where}: team_watch 'talent' must be a boolean when present`);
    }
  }

  // `club` is legacy too: the owner-club block from the single-club era.
  if (d.club !== undefined && !isPlainObject(d.club))
    fail(`${where}: 'club' must be an object when present (legacy key)`);

  if (d.club?.results !== undefined)
    fail(`${where}: club.results is no longer valid — the schema uses club.latest_result now`);

  if (d.club?.latest_result !== undefined) {
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
    if (lr.result !== undefined && !["W", "L", "D"].includes(lr.result))
      fail(`${where}: club.latest_result.result must be exactly "W", "L" or "D" when present`);
    if (lr.date !== undefined && !isNonEmptyStr(lr.date))
      fail(`${where}: club.latest_result.date must be a non-empty string when present`);
  }

  if (d.club?.fixtures !== undefined) {
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

  if (d.club?.table !== undefined) {
    const t = d.club["table"];
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

  if (d.club?.form !== undefined) {
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

// The league table, top-level now: the page is about the division, not about
  // where one club sits in it.
  if (d.table !== undefined) {
    const t = d.table;
    if (!isPlainObject(t)) fail(`${where}: 'table' must be an object`);
    if (!isNonEmptyStr(t.competition))
      fail(`${where}: table.competition must be a non-empty string`);
    if (!Array.isArray(t.rows) || !t.rows.length)
      fail(`${where}: table.rows must be a non-empty array`);
    for (const [ri, row] of t.rows.entries()) {
      const rwhere = `${where}, table.rows[${ri}] (${row?.team ?? "?"})`;
      for (const key of ["pos", "played", "points"]) {
        if (!isNumber(row?.[key])) fail(`${rwhere}: '${key}' must be a number`);
      }
      if (!isNonEmptyStr(row?.team)) fail(`${rwhere}: 'team' must be a non-empty string`);
      if (row.crest !== undefined && row.crest !== null && typeof row.crest !== "string")
        fail(`${rwhere}: 'crest' must be a string or null when present`);
      if (row.form !== undefined && !isNonEmptyStr(row.form))
        fail(`${rwhere}: 'form' must be a non-empty string like "WWDLW" when present`);
      if (row.focus !== undefined && typeof row.focus !== "boolean")
        fail(`${rwhere}: 'focus' must be a boolean when present`);
    }
    if (t.note !== undefined && !isNonEmptyStr(t.note))
      fail(`${where}: table.note must be a non-empty string when present`);
  }

  if (!Array.isArray(d.wider)) fail(`${where}: 'wider' must be an array`);
  for (const [wi, w] of d.wider.entries()) {
    checkLink(`${where}, wider[${wi}]`, "wider item", w);
  }
  if (d.read != null) checkLink(where, "'read'", d.read);

  if (d.rumours !== undefined) {
    if (!Array.isArray(d.rumours)) fail(`${where}: 'rumours' must be an array when present`);
    // "here we go" is legacy-only: old entries keep it, new ones write "done".
    const heats = ["done", "here we go", "close", "talks", "smoke"];
    for (const [ri, r] of d.rumours.entries()) {
      const rwhere = `${where}, rumours[${ri}]`;
      for (const key of ["player", "from", "to", "note"]) {
        if (!isNonEmptyStr(r?.[key])) fail(`${rwhere}: '${key}' must be a non-empty string`);
      }
      if (!heats.includes(r?.heat))
        fail(`${rwhere}: 'heat' must be one of ${heats.map((h) => `"${h}"`).join(", ")}`);
      if (r.fee !== undefined && !isNonEmptyStr(r.fee))
        fail(`${rwhere}: 'fee' must be a non-empty string when present`);
    }
  }

  // `rivals` is the legacy shape (entries up to 2026-08-22): the club's world
  // framed against the reader's team. New entries use `top_teams` — the same
  // card, but written as one unified league view with no "us and them".
  for (const key of ["rivals", "top_teams"]) {
    if (d[key] === undefined) continue;
    if (!Array.isArray(d[key])) fail(`${where}: '${key}' must be an array when present`);
    for (const [ri, r] of d[key].entries()) {
      const rwhere = `${where}, ${key}[${ri}]`;
      for (const field of ["club", "line", "note"]) {
        if (!isNonEmptyStr(r?.[field])) fail(`${rwhere}: '${field}' must be a non-empty string`);
      }
      if (r.crest !== undefined && r.crest !== null && typeof r.crest !== "string")
        fail(`${rwhere}: 'crest' must be a string or null when present`);
    }
  }

  // Titbits from outside the big clubs — the promoted side's flying start, the
  // 19-year-old nobody had heard of. No `line` chip: these aren't table-watching.
  if (d.elsewhere !== undefined) {
    if (!Array.isArray(d.elsewhere)) fail(`${where}: 'elsewhere' must be an array when present`);
    for (const [ei, e] of d.elsewhere.entries()) {
      const ewhere = `${where}, elsewhere[${ei}]`;
      for (const field of ["club", "note"]) {
        if (!isNonEmptyStr(e?.[field])) fail(`${ewhere}: '${field}' must be a non-empty string`);
      }
      if (e.crest !== undefined && e.crest !== null && typeof e.crest !== "string")
        fail(`${ewhere}: 'crest' must be a string or null when present`);
    }
  }
}

console.log(`digests.json OK — ${data.digests.length} entries`);
