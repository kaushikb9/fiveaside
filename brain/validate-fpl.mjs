#!/usr/bin/env node
// Validate site/data/fpl.json: parse, section schemas, FPL squad legality.
// Usage: node brain/validate-fpl.mjs [path]   (exit 0 ok / exit 1 invalid)
//
// fpl.json is a LIVING document (unlike append-only digests.json): every
// current-state section is replaced wholesale each run; only `log` persists,
// append-and-settle. The seed file `{ "log": [] }` is valid.
//
// Two tiers share this file: the COMMONS (public — anyone's FPL page) and the
// PERSONAL layer (revealed by the sync toggle). Both are optional so the page
// degrades to whatever exists.
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

// The gameweek being played, when one is in flight — drives the live view.
if (data.live_gameweek !== undefined) {
  const l = data.live_gameweek;
  if (!isPlainObject(l)) fail("'live_gameweek' must be an object");
  if (!isNumber(l.id)) fail("live_gameweek.id must be a number");
}

/**
 * A legal FPL 15: 2/5/5/3 by position, 11 starters + bench_order 1-4,
 * exactly one captain and one vice among the starters, max 3 per club.
 * Shared by `squad` (the recommendation) and the `bus` / `wildcard` shadows.
 */
function checkSquad(where, s, { requireBank = false } = {}) {
  if (!isPlainObject(s)) fail(`'${where}' must be an object`);
  if (!/^\d-\d-\d$/.test(s.formation ?? "")) fail(`${where}.formation must look like '3-5-2'`);
  if (requireBank && !isNonEmptyStr(s.bank)) fail(`${where}.bank must be a non-empty string`);
  if (s.bank !== undefined && !isNonEmptyStr(s.bank))
    fail(`${where}.bank must be a non-empty string when present`);
  if (s.value !== undefined && !isNonEmptyStr(s.value))
    fail(`${where}.value must be a non-empty string when present`);
  if (s.note !== undefined && !isNonEmptyStr(s.note))
    fail(`${where}.note must be a non-empty string when present`);
  if (!Array.isArray(s.players) || s.players.length !== 15)
    fail(`${where}.players must be an array of exactly 15`);

  const posCount = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
  const teamCount = {};
  const benchOrders = new Set();
  let starters = 0;
  let captains = 0;
  let vices = 0;
  let captainName = null;
  let viceName = null;

  for (const [i, p] of s.players.entries()) {
    const pwhere = `${where}.players[${i}] (${p?.name ?? "?"})`;
    for (const key of ["name", "team"]) {
      if (!isNonEmptyStr(p?.[key])) fail(`${pwhere}: '${key}' must be a non-empty string`);
    }
    if (!POSITIONS.includes(p.pos)) fail(`${pwhere}: 'pos' must be one of ${POSITIONS.join(", ")}`);
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
    fail(`${where} must be 2 GK / 5 DEF / 5 MID / 3 FWD (got ${JSON.stringify(posCount)})`);
  if (starters !== 11) fail(`${where} needs exactly 11 starters (got ${starters})`);
  if (captains !== 1) fail(`${where} needs exactly one captain (got ${captains})`);
  if (vices !== 1) fail(`${where} needs exactly one vice-captain (got ${vices})`);
  for (const [team, n] of Object.entries(teamCount)) {
    if (n > 3) fail(`${where}: more than 3 players from ${team} — illegal in FPL`);
  }
  return { captainName, viceName };
}

// ---------------------------------------------------------------- personal

if (data.call !== undefined) {
  const c = data.call;
  if (!isPlainObject(c)) fail("'call' must be an object");
  if (data.squad === undefined) fail("'call' requires 'squad' — a call without a team is noise");
  for (const key of ["headline", "reasoning", "captain", "vice"]) {
    if (!isNonEmptyStr(c[key])) fail(`call.${key} must be a non-empty string`);
  }
  if (c.template_drift !== undefined && !isNonEmptyStr(c.template_drift))
    fail("call.template_drift must be a non-empty string when present");
  if (c.execute !== undefined && !isNonEmptyStr(c.execute))
    fail("call.execute must be a non-empty string when present");
  if (c.wager !== undefined && !isNonEmptyStr(c.wager))
    fail("call.wager must be a non-empty string when present");
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
  // The FYI strip: at most two alternatives, never sold as equals to the Call.
  if (c.alternatives !== undefined) {
    if (!Array.isArray(c.alternatives) || c.alternatives.length > 2)
      fail("call.alternatives must be an array of at most 2 when present");
    for (const [i, a] of c.alternatives.entries()) {
      for (const key of ["kind", "move", "note"]) {
        if (!isNonEmptyStr(a?.[key]))
          fail(`call.alternatives[${i}]: '${key}' must be a non-empty string`);
      }
    }
  }
}

if (data.squad !== undefined) {
  const { captainName, viceName } = checkSquad("squad", data.squad, { requireBank: true });
  if (data.call !== undefined) {
    if (data.call.captain !== captainName)
      fail(`call.captain (${data.call.captain}) must match the flagged captain (${captainName})`);
    if (data.call.vice !== viceName)
      fail(`call.vice (${data.call.vice}) must match the flagged vice (${viceName})`);
  }
}

// The owner's real team state, copied from the entry API by the facts CLI.
if (data.desk !== undefined) {
  const d = data.desk;
  if (!isPlainObject(d)) fail("'desk' must be an object");
  if (!isNonEmptyStr(d.team_name)) fail("desk.team_name must be a non-empty string");
  if (typeof d.entered !== "boolean") fail("desk.entered must be a boolean");
  for (const key of ["overall_rank", "total_points", "gw_points", "bank", "value"]) {
    if (d[key] !== undefined && d[key] !== null && !isNumber(d[key]))
      fail(`desk.${key} must be a number or null when present`);
  }
  if (d.league !== undefined) {
    if (!isPlainObject(d.league)) fail("desk.league must be an object when present");
    if (!isNonEmptyStr(d.league.name)) fail("desk.league.name must be a non-empty string");
  }
  if (d.picks !== undefined) {
    if (!Array.isArray(d.picks) || d.picks.length !== 15)
      fail("desk.picks must be an array of exactly 15 when present");
    for (const [i, p] of d.picks.entries()) {
      const pwhere = `desk.picks[${i}] (${p?.name ?? "?"})`;
      if (!isNonEmptyStr(p?.name)) fail(`${pwhere}: 'name' must be a non-empty string`);
      if (!POSITIONS.includes(p.pos)) fail(`${pwhere}: 'pos' must be one of ${POSITIONS.join(", ")}`);
      if (!["start", "bench"].includes(p.role))
        fail(`${pwhere}: 'role' must be "start" or "bench"`);
    }
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
    if (w.starred !== undefined && typeof w.starred !== "boolean")
      fail(`${wwhere}: 'starred' must be a boolean when present`);
  }
}

// Open positions: every claim carries a number and a settle-by gameweek, so the
// retro grades what was written at decision time rather than hindsight.
if (data.wagers !== undefined) {
  if (!Array.isArray(data.wagers)) fail("'wagers' must be an array when present");
  for (const [i, w] of data.wagers.entries()) {
    const wwhere = `wagers[${i}]`;
    if (!isNonEmptyStr(w?.claim)) fail(`${wwhere}: 'claim' must be a non-empty string`);
    if (!isNumber(w?.settles_gw)) fail(`${wwhere}: 'settles_gw' must be a number`);
    if (w.owner !== undefined && !["brain", "kb"].includes(w.owner))
      fail(`${wwhere}: 'owner' must be "brain" or "kb" when present`);
    if (w.standing !== undefined && !isNonEmptyStr(w.standing))
      fail(`${wwhere}: 'standing' must be a non-empty string when present`);
  }
}

// Beliefs graduate observation -> pattern -> doctrine; only doctrine edits the prompt.
if (data.doctrine !== undefined) {
  if (!Array.isArray(data.doctrine)) fail("'doctrine' must be an array when present");
  const grades = ["observation", "pattern", "doctrine"];
  for (const [i, d] of data.doctrine.entries()) {
    const dwhere = `doctrine[${i}] (${d?.id ?? "?"})`;
    for (const key of ["id", "text", "established"]) {
      if (!isNonEmptyStr(d?.[key])) fail(`${dwhere}: '${key}' must be a non-empty string`);
    }
    if (d.grade !== undefined && !grades.includes(d.grade))
      fail(`${dwhere}: 'grade' must be one of ${grades.join(", ")}`);
    if (d.status !== undefined && !["standing", "new", "revised", "struck"].includes(d.status))
      fail(`${dwhere}: 'status' must be standing|new|revised|struck when present`);
  }
}

// The race: the owner's mini-league plus the two shadow benchmarks.
if (data.race !== undefined) {
  const r = data.race;
  if (!isPlainObject(r)) fail("'race' must be an object");
  if (!isNonEmptyStr(r.league_name)) fail("race.league_name must be a non-empty string");
  if (!["pre", "live", "settled"].includes(r.state))
    fail('race.state must be "pre", "live" or "settled"');
  if (r.note !== undefined && !isNonEmptyStr(r.note))
    fail("race.note must be a non-empty string when present");
  if (r.rows !== undefined) {
    if (!Array.isArray(r.rows)) fail("race.rows must be an array when present");
    for (const [i, row] of r.rows.entries()) {
      const rwhere = `race.rows[${i}] (${row?.name ?? "?"})`;
      if (!isNonEmptyStr(row?.name)) fail(`${rwhere}: 'name' must be a non-empty string`);
      if (row.total !== undefined && row.total !== null && !isNumber(row.total))
        fail(`${rwhere}: 'total' must be a number or null when present`);
      if (row.is_owner !== undefined && typeof row.is_owner !== "boolean")
        fail(`${rwhere}: 'is_owner' must be a boolean when present`);
    }
  }
  if (r.benchmarks !== undefined) {
    if (!Array.isArray(r.benchmarks)) fail("race.benchmarks must be an array when present");
    for (const [i, b] of r.benchmarks.entries()) {
      if (!isNonEmptyStr(b?.name)) fail(`race.benchmarks[${i}]: 'name' must be a non-empty string`);
      if (b.total !== undefined && b.total !== null && !isNumber(b.total))
        fail(`race.benchmarks[${i}]: 'total' must be a number or null when present`);
    }
  }
}

// ----------------------------------------------------------------- commons

if (data.new_this_season !== undefined) {
  if (!Array.isArray(data.new_this_season)) fail("'new_this_season' must be an array when present");
  for (const [i, n] of data.new_this_season.entries()) {
    for (const key of ["title", "note"]) {
      if (!isNonEmptyStr(n?.[key]))
        fail(`new_this_season[${i}]: '${key}' must be a non-empty string`);
    }
  }
}

if (data.signals !== undefined) {
  if (!Array.isArray(data.signals)) fail("'signals' must be an array when present");
  const tags = ["injury", "doubt", "ban", "rotation", "price", "news", "managers"];
  for (const [i, s] of data.signals.entries()) {
    const swhere = `signals[${i}]`;
    if (!tags.includes(s?.tag))
      fail(`${swhere}: 'tag' must be one of ${tags.map((t) => `"${t}"`).join(", ")}`);
    for (const key of ["text", "source"]) {
      if (!isNonEmptyStr(s?.[key])) fail(`${swhere}: '${key}' must be a non-empty string`);
    }
    if (s.action !== undefined && !isNonEmptyStr(s.action))
      fail(`${swhere}: 'action' must be a non-empty string when present`);
    if (!isNonEmptyStr(s.player) && !isNonEmptyStr(s.team))
      fail(`${swhere}: needs at least one of 'player' or 'team'`);
    if (s.url !== undefined && (!isNonEmptyStr(s.url) || !urlRe.test(s.url)))
      fail(`${swhere}: 'url' must be a non-empty http(s) URL string when present`);
  }
}

// The crowd's shape — copied verbatim from the facts bundle, never authored.
if (data.template !== undefined) {
  if (!Array.isArray(data.template)) fail("'template' must be an array when present");
  for (const [i, g] of data.template.entries()) {
    const gwhere = `template[${i}] (${g?.pos ?? "?"})`;
    if (!POSITIONS.includes(g?.pos)) fail(`${gwhere}: 'pos' must be one of ${POSITIONS.join(", ")}`);
    if (!Array.isArray(g.rows)) fail(`${gwhere}: 'rows' must be an array`);
    for (const [j, r] of g.rows.entries()) {
      const rwhere = `${gwhere}.rows[${j}] (${r?.name ?? "?"})`;
      for (const key of ["name", "team"]) {
        if (!isNonEmptyStr(r?.[key])) fail(`${rwhere}: '${key}' must be a non-empty string`);
      }
      if (!isNumber(r.ownership)) fail(`${rwhere}: 'ownership' must be a number`);
    }
  }
}

if (data.captain_poll !== undefined) {
  const c = data.captain_poll;
  if (!isPlainObject(c)) fail("'captain_poll' must be an object");
  if (c.most_captained !== undefined && c.most_captained !== null) {
    if (!isNonEmptyStr(c.most_captained.name))
      fail("captain_poll.most_captained.name must be a non-empty string");
  }
  if (c.rows !== undefined) {
    if (!Array.isArray(c.rows)) fail("captain_poll.rows must be an array when present");
    for (const [i, r] of c.rows.entries()) {
      if (!isNonEmptyStr(r?.name)) fail(`captain_poll.rows[${i}]: 'name' must be non-empty`);
      if (!isNumber(r?.ownership)) fail(`captain_poll.rows[${i}]: 'ownership' must be a number`);
    }
  }
  if (c.note !== undefined && !isNonEmptyStr(c.note))
    fail("captain_poll.note must be a non-empty string when present");
}

if (data.penalties !== undefined) {
  const p = data.penalties;
  if (!isPlainObject(p)) fail("'penalties' must be an object");
  if (!Array.isArray(p.rows)) fail("penalties.rows must be an array");
  for (const [i, r] of p.rows.entries()) {
    const rwhere = `penalties.rows[${i}] (${r?.team ?? "?"})`;
    for (const key of ["team", "taker"]) {
      if (!isNonEmptyStr(r?.[key])) fail(`${rwhere}: '${key}' must be a non-empty string`);
    }
    if (r.note !== undefined && !isNonEmptyStr(r.note))
      fail(`${rwhere}: 'note' must be a non-empty string when present`);
  }
  if (p.note !== undefined && !isNonEmptyStr(p.note))
    fail("penalties.note must be a non-empty string when present");
}

// The two standing benchmarks — both must be legal FPL squads.
for (const key of ["bus", "wildcard"]) {
  if (data[key] !== undefined) checkSquad(key, data[key]);
}

if (data.chips !== undefined) {
  const c = data.chips;
  if (!isPlainObject(c)) fail("'chips' must be an object");
  if (!Array.isArray(c.rows)) fail("chips.rows must be an array");
  for (const [i, r] of c.rows.entries()) {
    const rwhere = `chips.rows[${i}] (${r?.code ?? "?"})`;
    for (const key of ["code", "window", "expires"]) {
      if (!isNonEmptyStr(r?.[key])) fail(`${rwhere}: '${key}' must be a non-empty string`);
    }
  }
  if (c.note !== undefined && !isNonEmptyStr(c.note))
    fail("chips.note must be a non-empty string when present");
}

// The judgment layer over the player file. The file itself (site/data/players.json)
// is mechanical and validated separately; this is the brain's opinion on the
// handful of players that warrant one — four words, a direction, and a trigger
// written before the fact so it can be settled later.
if (data.verdicts !== undefined) {
  if (!Array.isArray(data.verdicts)) fail("'verdicts' must be an array when present");
  const words = ["nailed", "solid", "watch", "sack"];
  const moves = ["up", "down", "new", "held"];
  const seen = new Set();
  for (const [i, v] of data.verdicts.entries()) {
    const vwhere = `verdicts[${i}] (${v?.name ?? "?"})`;
    if (!isNumber(v?.id)) fail(`${vwhere}: 'id' must be the player's element id`);
    if (seen.has(v.id)) fail(`${vwhere}: duplicate verdict for the same player`);
    seen.add(v.id);
    if (!isNonEmptyStr(v.name)) fail(`${vwhere}: 'name' must be a non-empty string`);
    if (!words.includes(v.verdict))
      fail(`${vwhere}: 'verdict' must be one of ${words.join(", ")}`);
    if (!moves.includes(v.moved)) fail(`${vwhere}: 'moved' must be one of ${moves.join(", ")}`);
    if (!isNonEmptyStr(v.why)) fail(`${vwhere}: 'why' must be a non-empty sentence`);
    // The trigger is what makes a verdict settleable rather than an opinion.
    if (!isNonEmptyStr(v.trigger)) fail(`${vwhere}: 'trigger' must say what would change our mind`);
    if (v.was !== undefined && !words.includes(v.was))
      fail(`${vwhere}: 'was' must be a previous verdict word when present`);
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

// The ledger. Four verdicts, because two teach outcome-worship: UNLUCKY and
// LUCKY are where calibration lives.
const verdicts = ["hit", "miss", "unlucky", "lucky", "open"];
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
  if (l.grade !== undefined && !["observation", "pattern", "doctrine"].includes(l.grade))
    fail(`${lwhere}: 'grade' must be observation|pattern|doctrine when present`);
}

const sections = [
  "new_this_season",
  "signals",
  "template",
  "captain_poll",
  "verdicts",
  "penalties",
  "ticker",
  "bus",
  "wildcard",
  "chips",
  "call",
  "squad",
  "desk",
  "watchlist",
  "wagers",
  "doctrine",
  "race",
  "plan",
].filter((k) => data[k] !== undefined).length;

console.log(`fpl.json OK — ${sections} sections, ${data.log.length} log entries`);
