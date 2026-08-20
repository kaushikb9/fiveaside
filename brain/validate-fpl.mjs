#!/usr/bin/env node
// Validate site/data/fpl.json: parse, section schemas, FPL squad legality.
// Usage: node brain/validate-fpl.mjs [path]   (exit 0 ok / exit 1 invalid)
//
// fpl.json is a LIVING document (unlike append-only digests.json): every
// current-state section is replaced wholesale each run; only `log` persists,
// append-and-settle. The seed file `{ "log": [] }` is valid.
import { readFileSync } from "node:fs";

const path = process.argv[2] ?? "site/data/fpl.json";
const fail = (msg) => {
  console.error(`fpl.json invalid: ${msg}`);
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

const dateRe = /^\d{4}-\d{2}-\d{2}$/;
const urlRe = /^https?:\/\//;
const POSITIONS = ["GK", "DEF", "MID", "FWD"];

if (!isPlainObject(data)) fail("top-level JSON must be an object");
if (!Array.isArray(data.log)) fail("top-level 'log' must be an array (may be empty)");

for (const key of ["generated_at", "season"]) {
  if (data[key] !== undefined && !isNonEmptyStr(data[key]))
    fail(`'${key}' must be a non-empty string when present`);
}

if (data.gameweek !== undefined) {
  const g = data.gameweek;
  if (!isPlainObject(g)) fail("'gameweek' must be an object");
  if (!isNumber(g.id)) fail("gameweek.id must be a number");
  for (const key of ["deadline_utc", "deadline_local"]) {
    if (!isNonEmptyStr(g[key])) fail(`gameweek.${key} must be a non-empty string`);
  }
}

if (data.call !== undefined) {
  const c = data.call;
  if (!isPlainObject(c)) fail("'call' must be an object");
  if (data.squad === undefined) fail("'call' requires 'squad' — a call without a team is noise");
  for (const key of ["headline", "reasoning", "captain", "vice"]) {
    if (!isNonEmptyStr(c[key])) fail(`call.${key} must be a non-empty string`);
  }
  if (c.moves !== undefined) {
    if (!Array.isArray(c.moves)) fail("call.moves must be an array when present");
    for (const [i, m] of c.moves.entries()) {
      for (const key of ["out", "in", "cost", "note"]) {
        if (!isNonEmptyStr(m?.[key])) fail(`call.moves[${i}]: '${key}' must be a non-empty string`);
      }
    }
  }
  if (c.chip !== undefined && !isNonEmptyStr(c.chip))
    fail("call.chip must be a non-empty string when present");
  if (c.alternatives !== undefined) {
    if (!Array.isArray(c.alternatives) || c.alternatives.length > 2)
      fail("call.alternatives must be an array of at most 2 when present");
    for (const [i, a] of c.alternatives.entries()) {
      for (const key of ["call", "why_not"]) {
        if (!isNonEmptyStr(a?.[key]))
          fail(`call.alternatives[${i}]: '${key}' must be a non-empty string`);
      }
    }
  }
}

if (data.squad !== undefined) {
  const s = data.squad;
  if (!isPlainObject(s)) fail("'squad' must be an object");
  if (!/^\d-\d-\d$/.test(s.formation ?? "")) fail("squad.formation must look like '3-5-2'");
  if (!isNonEmptyStr(s.bank)) fail("squad.bank must be a non-empty string");
  if (s.value !== undefined && !isNonEmptyStr(s.value))
    fail("squad.value must be a non-empty string when present");
  if (!Array.isArray(s.players) || s.players.length !== 15)
    fail("squad.players must be an array of exactly 15");

  const posCount = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
  const teamCount = {};
  const benchOrders = new Set();
  let starters = 0;
  let captains = 0;
  let vices = 0;
  let captainName = null;
  let viceName = null;

  for (const [i, p] of s.players.entries()) {
    const pwhere = `squad.players[${i}] (${p?.name ?? "?"})`;
    for (const key of ["name", "team"]) {
      if (!isNonEmptyStr(p?.[key])) fail(`${pwhere}: '${key}' must be a non-empty string`);
    }
    if (!POSITIONS.includes(p.pos))
      fail(`${pwhere}: 'pos' must be one of ${POSITIONS.join(", ")}`);
    if (!isNumber(p.price)) fail(`${pwhere}: 'price' must be a number`);
    if (!["start", "bench"].includes(p.role)) fail(`${pwhere}: 'role' must be "start" or "bench"`);
    for (const key of ["captain", "vice", "bet"]) {
      if (p[key] !== undefined && typeof p[key] !== "boolean")
        fail(`${pwhere}: '${key}' must be a boolean when present`);
    }
    if (p.note !== undefined && !isNonEmptyStr(p.note))
      fail(`${pwhere}: 'note' must be a non-empty string when present`);

    posCount[p.pos] += 1;
    teamCount[p.team] = (teamCount[p.team] ?? 0) + 1;
    if (p.role === "start") {
      starters += 1;
      if (p.bench_order !== undefined) fail(`${pwhere}: starters must not carry bench_order`);
    } else {
      if (!isNumber(p.bench_order) || p.bench_order < 1 || p.bench_order > 4)
        fail(`${pwhere}: bench players need bench_order 1-4`);
      if (benchOrders.has(p.bench_order)) fail(`${pwhere}: duplicate bench_order`);
      benchOrders.add(p.bench_order);
    }
    if (p.captain === true) {
      captains += 1;
      captainName = p.name;
      if (p.role !== "start") fail(`${pwhere}: the captain must be a starter`);
    }
    if (p.vice === true) {
      vices += 1;
      viceName = p.name;
      if (p.role !== "start") fail(`${pwhere}: the vice-captain must be a starter`);
    }
  }

  if (posCount.GK !== 2 || posCount.DEF !== 5 || posCount.MID !== 5 || posCount.FWD !== 3)
    fail(`squad must be 2 GK / 5 DEF / 5 MID / 3 FWD (got ${JSON.stringify(posCount)})`);
  if (starters !== 11) fail(`squad needs exactly 11 starters (got ${starters})`);
  if (captains !== 1) fail(`squad needs exactly one captain (got ${captains})`);
  if (vices !== 1) fail(`squad needs exactly one vice-captain (got ${vices})`);
  for (const [team, n] of Object.entries(teamCount)) {
    if (n > 3) fail(`more than 3 players from ${team} — illegal in FPL`);
  }
  if (data.call !== undefined) {
    if (data.call.captain !== captainName)
      fail(`call.captain (${data.call.captain}) must match the flagged captain (${captainName})`);
    if (data.call.vice !== viceName)
      fail(`call.vice (${data.call.vice}) must match the flagged vice (${viceName})`);
  }
}

if (data.watchlist !== undefined) {
  if (!Array.isArray(data.watchlist)) fail("'watchlist' must be an array when present");
  const statuses = ["rising", "hold", "cooling"];
  for (const [i, w] of data.watchlist.entries()) {
    const wwhere = `watchlist[${i}] (${w?.name ?? "?"})`;
    for (const key of ["name", "team", "note"]) {
      if (!isNonEmptyStr(w?.[key])) fail(`${wwhere}: '${key}' must be a non-empty string`);
    }
    if (!POSITIONS.includes(w.pos)) fail(`${wwhere}: 'pos' must be one of ${POSITIONS.join(", ")}`);
    if (!isNumber(w.price)) fail(`${wwhere}: 'price' must be a number`);
    if (!statuses.includes(w.status))
      fail(`${wwhere}: 'status' must be one of ${statuses.map((s) => `"${s}"`).join(", ")}`);
    if (w.ownership !== undefined && !isNonEmptyStr(w.ownership))
      fail(`${wwhere}: 'ownership' must be a non-empty string when present`);
  }
}

if (data.signals !== undefined) {
  if (!Array.isArray(data.signals)) fail("'signals' must be an array when present");
  const tags = ["injury", "rotation", "price", "news"];
  for (const [i, s] of data.signals.entries()) {
    const swhere = `signals[${i}]`;
    if (!tags.includes(s?.tag))
      fail(`${swhere}: 'tag' must be one of ${tags.map((t) => `"${t}"`).join(", ")}`);
    for (const key of ["text", "source", "action"]) {
      if (!isNonEmptyStr(s?.[key])) fail(`${swhere}: '${key}' must be a non-empty string`);
    }
    if (!isNonEmptyStr(s.player) && !isNonEmptyStr(s.team))
      fail(`${swhere}: needs at least one of 'player' or 'team'`);
    if (s.url !== undefined && (!isNonEmptyStr(s.url) || !urlRe.test(s.url)))
      fail(`${swhere}: 'url' must be a non-empty http(s) URL string when present`);
  }
}

if (data.ticker !== undefined) {
  const t = data.ticker;
  if (!isPlainObject(t)) fail("'ticker' must be an object");
  if (!isNumber(t.from_gw)) fail("ticker.from_gw must be a number");
  if (!isNumber(t.gws)) fail("ticker.gws must be a number");
  if (!Array.isArray(t.rows)) fail("ticker.rows must be an array");
  for (const [i, r] of t.rows.entries()) {
    const rwhere = `ticker.rows[${i}] (${r?.team ?? "?"})`;
    if (!isNonEmptyStr(r?.team)) fail(`${rwhere}: 'team' must be a non-empty string`);
    if (!isNumber(r?.avg)) fail(`${rwhere}: 'avg' must be a number`);
    if (!Array.isArray(r?.fixtures)) fail(`${rwhere}: 'fixtures' must be an array`);
    for (const [fi, f] of r.fixtures.entries()) {
      const fwhere = `${rwhere}, fixtures[${fi}]`;
      if (!isNumber(f?.gw)) fail(`${fwhere}: 'gw' must be a number`);
      if (!isNonEmptyStr(f?.opp)) fail(`${fwhere}: 'opp' must be a non-empty string`);
      if (typeof f?.home !== "boolean") fail(`${fwhere}: 'home' must be a boolean`);
      if (!Number.isInteger(f?.fdr) || f.fdr < 1 || f.fdr > 5)
        fail(`${fwhere}: 'fdr' must be an integer 1-5`);
    }
  }
}

if (data.plan !== undefined) {
  const p = data.plan;
  if (!isPlainObject(p)) fail("'plan' must be an object");
  if (!isNonEmptyStr(p.outlook)) fail("plan.outlook must be a non-empty string");
  if (p.items !== undefined) {
    if (!Array.isArray(p.items)) fail("plan.items must be an array when present");
    for (const [i, item] of p.items.entries()) {
      for (const key of ["label", "when", "note"]) {
        if (!isNonEmptyStr(item?.[key]))
          fail(`plan.items[${i}]: '${key}' must be a non-empty string`);
      }
    }
  }
}

const verdicts = ["hit", "miss", "open"];
for (const [i, l] of data.log.entries()) {
  const lwhere = `log[${i}] (gw ${l?.gw ?? "?"})`;
  if (!isNumber(l?.gw)) fail(`${lwhere}: 'gw' must be a number`);
  if (!dateRe.test(l?.date ?? "")) fail(`${lwhere}: 'date' must be YYYY-MM-DD`);
  if (!isNonEmptyStr(l?.call)) fail(`${lwhere}: 'call' must be a non-empty string`);
  if (!verdicts.includes(l?.verdict))
    fail(`${lwhere}: 'verdict' must be one of ${verdicts.map((v) => `"${v}"`).join(", ")}`);
  for (const key of ["outcome", "lesson"]) {
    if (l[key] !== undefined && !isNonEmptyStr(l[key]))
      fail(`${lwhere}: '${key}' must be a non-empty string when present`);
  }
}

console.log(`fpl.json OK — ${data.log.length} log entries${data.squad ? ", squad legal" : ""}`);
