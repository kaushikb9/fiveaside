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

if (data.generated_at !== undefined && !isStr(data.generated_at)) {
  fail("'generated_at' must be a non-empty ISO string when present");
}

// ---------------------------------------------------------------- people
// The editorial layer, split five ways. This is the change that made the page
// honest: one shared watchlist rendered under whoever was selected implied
// five people had made five sets of decisions when only one had.
function checkWatchItem(where, w) {
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
      if (p.week.next !== undefined && !isStr(p.week.next))
        fail(`${where}.week.next must be a non-empty string when present`);
    }

    // The Big Decision. One or two calls, and short, for the same reason the
    // roast is capped: a decision that needs a paragraph has not been made.
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
  const TAGS = ["injury", "doubt", "ban", "rotation", "price", "news", "managers"];
  for (const [i, s] of data.signals.entries()) {
    const where = `signals[${i}]`;
    if (!TAGS.includes(s?.tag)) fail(`${where}.tag must be one of ${TAGS.join(", ")}`);
    if (!isStr(s.team)) fail(`${where}.team must be a non-empty string`);
    if (!isStr(s.text)) fail(`${where}.text must be a non-empty string`);
    for (const k of ["player", "source", "action"]) {
      if (s[k] !== undefined && !isStr(s[k])) fail(`${where}.${k} must be a non-empty string when present`);
    }
    if (s.url !== undefined && !urlRe.test(s.url ?? "")) fail(`${where}.url must be http(s)`);
  }
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

const ROAST_MAX = 300;

// ---------------------------------------------------------------- roast
// Rules, agreed with the owner: post-gameweek only, never daily; always about
// a decision someone actually made, with the fact attached; never the same
// person twice running; and it roasts the machine too.
if (data.roast !== undefined) {
  const r = data.roast;
  if (!isObj(r)) fail("'roast' must be an object");
  if (!isStr(r.text)) fail("roast.text must be a non-empty string");
  // Two sentences, hard. The GW1 roast ran to 880 characters and four jokes;
  // a roast that needs a paragraph has become an essay about someone's bench.
  // KB's call, 2026-08-27. The cap is enforced here rather than trusted to the
  // prompt because "be brief" is the first instruction any model drops.
  if (isStr(r.text) && r.text.length > ROAST_MAX) {
    fail(`roast.text is ${r.text.length} characters; the limit is ${ROAST_MAX} (two sentences)`);
  }
  if (r.by !== undefined && !isStr(r.by)) fail("roast.by must be a non-empty string when present");
  if (r.target !== undefined && !NICKS.includes(r.target)) {
    fail(`roast.target must be one of ${NICKS.join(", ")} when present`);
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

const sections = Object.keys(data).length;
const people = (data.people ?? []).length;
const withWeek = (data.people ?? []).filter((p) => p.week).length;
console.log(
  `fpl.json OK — ${sections} sections, ${people} people (${withWeek} with a week written), ` +
  `${(data.verdicts ?? []).length} verdicts, ${(data.log ?? []).length} log entries`
);
