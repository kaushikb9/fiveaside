#!/usr/bin/env node
// Validate site/data/fpl.json — the JUDGMENT layer, and the schema authority
// for it. Usage: node brain/validate-fpl.mjs [path]  (exit 0 ok / 1 invalid)
//
// What belongs in this file and what does not
// -------------------------------------------
// fpl.json holds only what the brain is entitled to write: opinion, with the
// reasoning attached. Everything measurable — prices, points, squads, picks,
// captaincy, chips played, ownership, fixtures — lives in players.json and
// gaffers.json, written mechanically by `uv run touchline fpl` and never
// routed through an LLM. Routing 600 player records through a model cost six
// figures of tokens per run to retype numbers, and invited transcription
// errors on the way. If a key here could be copied from the API, it is in the
// wrong file.
//
// It is a LIVING document, unlike append-only digests.json: every section is
// replaced wholesale each run, except `log`, which is append-and-settle. The
// seed file `{ "log": [] }` is valid.
//
// Removed on 2026-08-23 and rejected on sight: `call`, `squad`, `desk`,
// `race`, `season`, `wagers`, `captain_poll`, `template`, `penalties`,
// `new_this_season`. Each was either superseded by gaffers.json or dropped by
// the owner. Rejecting them loudly is the point — silent drift between the
// prompt, this validator and the renderer is the recurring bug class here.

import { readFileSync } from "node:fs";
import { lintFields, fplProseFields } from "./lint-prose.mjs";

// The Big Decision's caps, declared before the people loop that reads them:
// a const used above its declaration is a crash the moment the field is
// first written, and it validates cleanly until then.
const BIG_MAX = 2;
const BIG_CALL_MAX = 80;
const BIG_WHY_MAX = 260;

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

const isStr = (v) => typeof v === "string" && v.trim() !== "";
const isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const dateRe = /^\d{4}-\d{2}-\d{2}$/;
const urlRe = /^https?:\/\//;

if (!isObj(data)) fail("top-level JSON must be an object");

const NICKS = ["Xabi", "Sir Fergie", "Mr CR7", "The Special One", "Le Professeur"];
const VERDICTS = ["nailed", "solid", "watch", "sack"];
const MOVED = ["up", "down", "new", "held"];

// Real names are deleted at the facts layer; this is the backstop for the one
// file a language model writes. A first name in here would be a leak the tests
// cannot catch, because the brain could type one that was never in the data.
const BANNED_KEYS = ["player_name", "manager", "first_name", "last_name", "real_name"];
(function scanForNames(node, where) {
  if (Array.isArray(node)) return node.forEach((v, i) => scanForNames(v, `${where}[${i}]`));
  if (!isObj(node)) return;
  for (const key of Object.keys(node)) {
    if (BANNED_KEYS.includes(key)) fail(`${where}.${key}: real names never appear in this file`);
    scanForNames(node[key], `${where}.${key}`);
  }
})(data, "root");

for (const dead of [
  "call", "squad", "desk", "race", "season", "wagers",
  "captain_poll", "template", "penalties", "new_this_season",
]) {
  if (data[dead] !== undefined) {
    fail(`'${dead}' was removed from the schema on 2026-08-23 — the renderer does not read it`);
  }
}
// The roast was retired on 2026-09-06 — KB's call: "it's not working out".
// Its slot in the room went to Ted's own fifteen (see `ted` below).
if (data.roast !== undefined) {
  fail("'roast' was retired on 2026-09-06 — the renderer does not read it; Ted's fifteen took the slot");
}

if (data.generated_at !== undefined && !isStr(data.generated_at)) {
  fail("'generated_at' must be a non-empty ISO string when present");
}

// ---------------------------------------------------------------- people
// The editorial layer, split five ways. This is the change that made the page
// honest: one shared watchlist rendered under whoever was selected implied
// five people had made five sets of decisions when only one had.
function checkWatchItem(where, w) {
  if (!Number.isInteger(w?.id) || w.id < 1) fail(`${where}.id must be a positive player id`);
  for (const k of ["name", "team", "pos", "status", "note"]) {
    if (!isStr(w?.[k])) fail(`${where}.${k} must be a non-empty string`);
  }
  if (!isNum(w.price)) fail(`${where}.price must be a number`);
  if (!isStr(w.ownership)) fail(`${where}.ownership must be a string like "10.6%"`);
  if (!["hold", "rising", "cooling", "new"].includes(w.status)) {
    fail(`${where}.status must be one of hold, rising, cooling, new`);
  }
}

if (data.people !== undefined) {
  if (!Array.isArray(data.people)) fail("'people' must be an array");
  const seen = new Set();
  for (const [i, p] of data.people.entries()) {
    const where = `people[${i}] (${p?.nick ?? "?"})`;
    if (!NICKS.includes(p?.nick)) fail(`${where}: 'nick' must be one of ${NICKS.join(", ")}`);
    if (seen.has(p.nick)) fail(`${where}: duplicate nick`);
    seen.add(p.nick);

    // The weekly read, looking BACKWARDS. `next` was retired on 2026-08-28:
    // it had become a seven-hundred-character essay about a transfer nobody
    // had decided to make, inside a panel that is otherwise a retrospective.
    // What comes next is a decision, and decisions live in `big`.
    if (p.week !== undefined) {
      if (!isObj(p.week)) fail(`${where}.week must be an object`);
      for (const k of ["worked", "didnt"]) {
        if (!isStr(p.week[k])) fail(`${where}.week.${k} must be a non-empty string`);
      }
      if (p.week.next !== undefined)
        fail(`${where}.week.next is retired — decisions belong in 'big'`);
    }

    // The Big Decision. One or two calls, and short: a decision that needs a
    // paragraph has not been made.
    // The page only shows these in the last day before the deadline.
    if (p.big !== undefined) {
      if (!Array.isArray(p.big)) fail(`${where}.big must be an array`);
      if (p.big.length > BIG_MAX) {
        fail(`${where}.big has ${p.big.length} calls; ${BIG_MAX} is the limit — pick the big ones`);
      }
      for (const [bi, c] of p.big.entries()) {
        const bw = `${where}.big[${bi}]`;
        if (!isStr(c?.call)) fail(`${bw}.call must be a non-empty string`);
        if (!isStr(c?.why)) fail(`${bw}.why must be a non-empty string`);
        if (isStr(c?.call) && c.call.length > BIG_CALL_MAX)
          fail(`${bw}.call is ${c.call.length} characters; ${BIG_CALL_MAX} is the limit — it is a heading`);
        if (isStr(c?.why) && c.why.length > BIG_WHY_MAX)
          fail(`${bw}.why is ${c.why.length} characters; ${BIG_WHY_MAX} is the limit`);
      }
    }
    if (p.watchlist !== undefined) {
      if (!Array.isArray(p.watchlist)) fail(`${where}.watchlist must be an array`);
      p.watchlist.forEach((w, j) => checkWatchItem(`${where}.watchlist[${j}]`, w));
    }
  }
}

// The house list: watched by the room rather than by one person.
if (data.watchlist !== undefined) {
  if (!Array.isArray(data.watchlist)) fail("'watchlist' must be an array");
  data.watchlist.forEach((w, i) => checkWatchItem(`watchlist[${i}]`, w));
}

// ---------------------------------------------------------------- verdicts
// Four words, a direction, one line of why, and — written BEFORE the fact —
// what would change our mind. The trigger is the whole discipline: it turns a
// retro into a settlement rather than an argument.
if (data.verdicts !== undefined) {
  if (!Array.isArray(data.verdicts)) fail("'verdicts' must be an array");
  const seen = new Set();
  for (const [i, v] of data.verdicts.entries()) {
    const where = `verdicts[${i}] (${v?.name ?? "?"})`;
    if (!Number.isInteger(v?.id)) fail(`${where}.id must be an element id (integer)`);
    if (seen.has(v.id)) fail(`${where}: duplicate id`);
    seen.add(v.id);
    if (!isStr(v.name)) fail(`${where}.name must be a non-empty string`);
    if (!VERDICTS.includes(v.verdict)) fail(`${where}.verdict must be one of ${VERDICTS.join(", ")}`);
    if (!MOVED.includes(v.moved)) fail(`${where}.moved must be one of ${MOVED.join(", ")}`);
    if (!isStr(v.why)) fail(`${where}.why must be a non-empty string`);
    if (!isStr(v.trigger)) fail(`${where}.trigger must be a non-empty string`);
  }
}

// ---------------------------------------------------------------- signals
if (data.signals !== undefined) {
  if (!Array.isArray(data.signals)) fail("'signals' must be an array");
  const TAGS = ["injury", "doubt", "ban", "rotation", "price", "news", "managers",
                "setpieces", "shape", "minutes", "squad"];
  // Club-level items (no `player`) render as the Team radar, and the radar is
  // for the upcoming gameweek only. Tightened 2026-08-28, when the panel had
  // filled with transfer gossip, a Champions League draw and a club's
  // pre-season travel — true, sourced, and of no use to anyone picking a team.
  // A radar tag is one of the things that changes a lineup, and `action` — the
  // FPL consequence — is the test: if you cannot write it, it is not radar.
  const RADAR_TAGS = ["rotation", "injury", "setpieces", "shape", "minutes", "squad", "managers"];
  let radar = 0;
  for (const [i, s] of data.signals.entries()) {
    const where = `signals[${i}]`;
    if (!TAGS.includes(s?.tag)) fail(`${where}.tag must be one of ${TAGS.join(", ")}`);
    if (!isStr(s.team)) fail(`${where}.team must be a non-empty string`);
    if (!isStr(s.text)) fail(`${where}.text must be a non-empty string`);
    for (const k of ["player", "source", "action"]) {
      if (s[k] !== undefined && !isStr(s[k])) fail(`${where}.${k} must be a non-empty string when present`);
    }
    if (s.url !== undefined && !urlRe.test(s.url ?? "")) fail(`${where}.url must be http(s)`);
    if (s.player === undefined) {
      radar++;
      if (!RADAR_TAGS.includes(s.tag))
        fail(`${where}: a club-level signal is Team radar, so its tag must be one of ` +
             `${RADAR_TAGS.join(", ")} — '${s.tag}' is a player-level or newsdesk tag. ` +
             `Name the player and it goes to his card, or drop it.`);
      if (!isStr(s.action))
        fail(`${where}: a club-level signal needs 'action' — what it means for the ` +
             `upcoming gameweek. If you cannot write one, it is not Team radar.`);
      if (!isStr(s.source))
        fail(`${where}: a club-level signal needs 'source'`);
    }
  }
  if (radar > 8)
    fail(`'signals': ${radar} club-level items — the Team radar takes at most 8. ` +
         `Cut to the ones that change a team this gameweek.`);
}

// ---------------------------------------------------------------- ticker
// Copied from the facts bundle, never authored — it is here only because the
// locker room renders it and the brain passes it through untouched.
if (data.ticker !== undefined) {
  const t = data.ticker;
  if (!isObj(t)) fail("'ticker' must be an object");
  if (!Number.isInteger(t.from_gw)) fail("ticker.from_gw must be an integer");
  if (!Number.isInteger(t.gws)) fail("ticker.gws must be an integer");
  if (!Array.isArray(t.rows) || !t.rows.length) fail("ticker.rows must be a non-empty array");
  for (const [i, r] of t.rows.entries()) {
    const where = `ticker.rows[${i}] (${r?.team ?? "?"})`;
    if (!isStr(r.team)) fail(`${where}.team must be a non-empty string`);
    if (!isNum(r.avg)) fail(`${where}.avg must be a number`);
    if (!Array.isArray(r.fixtures)) fail(`${where}.fixtures must be an array`);
    for (const [j, f] of r.fixtures.entries()) {
      const fw = `${where}.fixtures[${j}]`;
      if (!Number.isInteger(f?.gw)) fail(`${fw}.gw must be an integer`);
      if (!isStr(f.opp)) fail(`${fw}.opp must be a non-empty string`);
      if (typeof f.home !== "boolean") fail(`${fw}.home must be a boolean`);
      if (!Number.isInteger(f.fdr) || f.fdr < 1 || f.fdr > 5) fail(`${fw}.fdr must be 1-5`);
    }
  }
}

// ---------------------------------------------------------------- chips
if (data.chips !== undefined) {
  const c = data.chips;
  if (!isObj(c)) fail("'chips' must be an object");
  if (!Array.isArray(c.rows)) fail("chips.rows must be an array");
  for (const [i, r] of c.rows.entries()) {
    const where = `chips.rows[${i}]`;
    for (const k of ["code", "name", "window", "expires"]) {
      if (!isStr(r?.[k])) fail(`${where}.${k} must be a non-empty string`);
    }
  }
  if (c.note !== undefined && !isStr(c.note)) fail("chips.note must be a non-empty string when present");
}

// ---------------------------------------------------------------- doctrine
// Beliefs graduate observation -> pattern -> doctrine. Only doctrine is
// allowed to change how the next call is made.
if (data.doctrine !== undefined) {
  if (!Array.isArray(data.doctrine)) fail("'doctrine' must be an array");
  const GRADES = ["observation", "pattern", "doctrine"];
  // "new" is a real state: an observation minted this week that has not yet
  // had a chance to hold or fail.
  const STATUS = ["new", "standing", "under review", "retired"];
  for (const [i, d] of data.doctrine.entries()) {
    const where = `doctrine[${i}] (${d?.id ?? "?"})`;
    if (!isStr(d?.id)) fail(`${where}.id must be a non-empty string`);
    if (!isStr(d.text)) fail(`${where}.text must be a non-empty string`);
    if (!isStr(d.established)) fail(`${where}.established must be a non-empty string`);
    if (!GRADES.includes(d.grade)) fail(`${where}.grade must be one of ${GRADES.join(", ")}`);
    if (!STATUS.includes(d.status)) fail(`${where}.status must be one of ${STATUS.join(", ")}`);
  }
}

// ---------------------------------------------------------------- ted
// The ghost manager. A fresh fifteen every gameweek, picked from scratch —
// no transfers, no chips, never in the league. Ids only: price, position,
// club and fixtures are joined from players.json at render time, so a value
// the API could supply never sits here. Legality is checked against that
// file when it is beside this one: fifteen men, 2-5-5-3, three per club at
// most, £100.0m, an eleven that is a formation, one captain and one vice
// among the starters.
const TED_BUDGET = 100.0;
const TED_QUOTA = { GK: 2, DEF: 5, MID: 5, FWD: 3 };
const TED_XI = { GK: [1, 1], DEF: [3, 5], MID: [2, 5], FWD: [1, 3] };
const TED_WHY_MAX = 320;
const TED_REBUILD_MAX = 480;

if (data.ted !== undefined && data.ted !== null) {
  const t = data.ted;
  if (!isObj(t)) fail("'ted' must be an object");
  if (!Number.isInteger(t.gw) || t.gw < 1 || t.gw > 38) fail("ted.gw must be a gameweek number");
  for (const k of ["written", "first_draft"]) {
    if (t[k] !== undefined && t[k] !== null && !dateRe.test(t[k])) fail(`ted.${k} must be YYYY-MM-DD`);
  }
  if (t.rebuild !== undefined) {
    if (!isStr(t.rebuild)) fail("ted.rebuild must be a non-empty string when present");
    if (t.rebuild.length > TED_REBUILD_MAX)
      fail(`ted.rebuild is ${t.rebuild.length} characters; ${TED_REBUILD_MAX} is the limit — two or three sentences`);
  }
  if (t.picks !== undefined) {
    if (!Array.isArray(t.picks)) fail("ted.picks must be an array");
    if (t.picks.length !== 15) fail(`ted.picks has ${t.picks.length} players; a squad is 15`);
    const ids = new Set();
    let caps = 0, vices = 0;
    for (const [i, p] of t.picks.entries()) {
      const where = `ted.picks[${i}] (${p?.name ?? "?"})`;
      if (!Number.isInteger(p?.id) || p.id < 1) fail(`${where}.id must be a positive player id`);
      if (ids.has(p.id)) fail(`${where}: duplicate id`);
      ids.add(p.id);
      if (!isStr(p.name)) fail(`${where}.name must be a non-empty string`);
      if (!["start", "bench"].includes(p.role)) fail(`${where}.role must be start or bench`);
      if (p.captain === true) { caps++; if (p.role !== "start") fail(`${where}: the captain must start`); }
      if (p.vice === true) { vices++; if (p.role !== "start") fail(`${where}: the vice-captain must start`); }
      if (p.captain === true && p.vice === true) fail(`${where}: captain and vice are two men`);
      for (const k of ["price", "team", "pos", "points", "ownership"]) {
        if (p[k] !== undefined) fail(`${where}.${k}: copied from the API — players.json has it, this file must not`);
      }
    }
    if (caps !== 1) fail(`ted.picks: ${caps} captains; exactly one`);
    if (vices !== 1) fail(`ted.picks: ${vices} vice-captains; exactly one`);
    const starters = t.picks.filter((p) => p.role === "start");
    if (starters.length !== 11) fail(`ted.picks: ${starters.length} starters; an eleven is eleven`);

    // Legality against the player file, when it is where it should be.
    let players = null;
    try {
      const pf = path.replace(/fpl\.json$/, "players.json");
      players = JSON.parse(readFileSync(pf, "utf8")).players ?? null;
    } catch { players = null; }
    if (players) {
      const byId = new Map(players.map((p) => [p.id, p]));
      let cost = 0;
      const perPos = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
      const xiPos = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
      const perClub = {};
      for (const p of t.picks) {
        const r = byId.get(p.id);
        if (!r) fail(`ted.picks (${p.name}): id ${p.id} is not in players.json`);
        if (r.name !== p.name) fail(`ted.picks: id ${p.id} is ${r.name} in players.json, not ${p.name}`);
        cost += r.price ?? 0;
        perPos[r.pos] = (perPos[r.pos] ?? 0) + 1;
        if (p.role === "start") xiPos[r.pos] = (xiPos[r.pos] ?? 0) + 1;
        perClub[r.team] = (perClub[r.team] ?? 0) + 1;
      }
      if (cost > TED_BUDGET + 1e-9) fail(`ted.picks cost £${cost.toFixed(1)}m; the budget is £${TED_BUDGET.toFixed(1)}m`);
      for (const [pos, n] of Object.entries(TED_QUOTA)) {
        if (perPos[pos] !== n) fail(`ted.picks: ${perPos[pos] ?? 0} ${pos}; a squad carries ${n}`);
      }
      for (const [pos, [lo, hi]] of Object.entries(TED_XI)) {
        if ((xiPos[pos] ?? 0) < lo || (xiPos[pos] ?? 0) > hi)
          fail(`ted.picks: ${xiPos[pos] ?? 0} ${pos} starting; a formation has ${lo}-${hi}`);
      }
      for (const [club, n] of Object.entries(perClub)) {
        if (n > 3) fail(`ted.picks: ${n} from ${club}; three per club is the limit`);
      }
    }
    if (!Array.isArray(t.why) || !t.why.length) fail("ted.why must be a non-empty array when picks are written");
  }
  if (t.why !== undefined) {
    if (!Array.isArray(t.why)) fail("ted.why must be an array");
    const pickIds = new Set((t.picks ?? []).map((p) => p.id));
    for (const [i, w] of t.why.entries()) {
      const where = `ted.why[${i}] (${w?.name ?? "?"})`;
      if (!Number.isInteger(w?.id)) fail(`${where}.id must be a player id`);
      if (!pickIds.has(w.id)) fail(`${where}: not one of the fifteen — 'why' explains players in the side`);
      if (!isStr(w.name)) fail(`${where}.name must be a non-empty string`);
      if (!isStr(w.text)) fail(`${where}.text must be a non-empty string`);
      if (w.text.length > TED_WHY_MAX) fail(`${where}.text is ${w.text.length} characters; ${TED_WHY_MAX} is the limit`);
    }
  }
  if (t.left_out !== undefined && t.left_out !== null) {
    const l = t.left_out;
    if (!isObj(l)) fail("ted.left_out must be an object");
    if (!Number.isInteger(l.id)) fail("ted.left_out.id must be a player id");
    if (!isStr(l.name)) fail("ted.left_out.name must be a non-empty string");
    if (!isStr(l.text)) fail("ted.left_out.text must be a non-empty string");
    if (l.text.length > TED_WHY_MAX) fail(`ted.left_out.text is ${l.text.length} characters; ${TED_WHY_MAX} is the limit`);
    if ((t.picks ?? []).some((p) => p.id === l.id)) fail("ted.left_out names a man who is in the fifteen");
  }
  if (t.watchlist !== undefined) {
    if (!Array.isArray(t.watchlist)) fail("ted.watchlist must be an array");
    t.watchlist.forEach((w, j) => checkWatchItem(`ted.watchlist[${j}]`, w));
    const pickIds = new Set((t.picks ?? []).map((p) => p.id));
    for (const w of t.watchlist) {
      if (pickIds.has(w.id)) fail(`ted.watchlist (${w.name}): he is in the fifteen — the watchlist is who is NOT`);
    }
  }
  if (t.changes !== undefined) {
    const c = t.changes;
    if (!isObj(c)) fail("ted.changes must be an object");
    for (const k of ["in", "out"]) {
      if (!Array.isArray(c[k]) || !c[k].every(isStr)) fail(`ted.changes.${k} must be an array of names`);
    }
  }
}

// ---------------------------------------------------------------- plan
if (data.plan !== undefined) {
  if (!isObj(data.plan)) fail("'plan' must be an object");
  if (!isStr(data.plan.outlook)) fail("plan.outlook must be a non-empty string");
}

// ---------------------------------------------------------------- log
// Append-and-settle: open entries get a verdict later, settled ones freeze.
if (data.log !== undefined) {
  if (!Array.isArray(data.log)) fail("'log' must be an array");
  const OUTCOMES = ["open", "hit", "miss", "unlucky", "lucky"];
  for (const [i, e] of data.log.entries()) {
    const where = `log[${i}]`;
    if (!Number.isInteger(e?.gw)) fail(`${where}.gw must be an integer`);
    if (!dateRe.test(e.date ?? "")) fail(`${where}.date must be YYYY-MM-DD`);
    if (!isStr(e.call)) fail(`${where}.call must be a non-empty string`);
    if (!OUTCOMES.includes(e.verdict)) fail(`${where}.verdict must be one of ${OUTCOMES.join(", ")}`);
  }
}

// ---------------------------------------------------------------- prose
// Added 2026-09-05. Every current-state prose field is Ted's to rewrite each
// run, so all of it is held to brain/lint-prose.mjs; settled log entries are
// frozen and skipped. All failures print before the exit so one pass fixes them.
{
  const { errors } = lintFields(fplProseFields(data));
  if (errors.length) {
    for (const e of errors) console.error(`  prose: ${e.where}: ${e.msg}`);
    fail(`${errors.length} prose failure${errors.length > 1 ? "s" : ""} — see brain/fpl-prompt.md "Plain language"`);
  }
}

const sections = Object.keys(data).length;
const people = (data.people ?? []).length;
const withWeek = (data.people ?? []).filter((p) => p.week).length;
console.log(
  `fpl.json OK — ${sections} sections, ${people} people (${withWeek} with a week written), ` +
  `${(data.verdicts ?? []).length} verdicts, ${(data.log ?? []).length} log entries` +
  (data.ted ? `, Ted GW${data.ted.gw}${data.ted.picks ? " (" + data.ted.picks.length + " picked)" : " (no team)"}` : "")
);
