/* ted.mjs — the ghost manager's clock and the freeze.
   =========================================================================
   Ted's fifteen is rewritten by the brain, and the brain will rewrite it
   whenever it is asked to. The phase is what says when it may, and `settle`
   is what makes that a diff rather than an instruction. These pin both, and
   the validator's squad law on a real player file.

   Usage: node brain/test/ted.mjs
   ========================================================================= */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { tedPhase, settleTed } from "../ted.mjs";

let fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log((ok ? "  ok   " : "  FAIL ") + name +
    (ok ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`));
};

// A Saturday 18:00 IST deadline: 12:30Z. Draft opens 96h before, freeze 3h.
const G = {
  gameweek: 4,
  deadline_utc: "2026-09-12T12:30:00Z",
  live_gameweek: { id: 3, finished: true },
  ted: { draft_opens_utc: "2026-09-08T12:30:00Z", freeze_utc: "2026-09-12T09:30:00Z" },
};
const at = (iso) => Date.parse(iso);

console.log("phase");
check("matches on -> live", tedPhase({ ...G, live_gameweek: { id: 3, finished: false } }, at("2026-09-06T15:00:00Z")).phase, "live");
check("Sunday night -> rebuilding", tedPhase(G, at("2026-09-06T20:00:00Z")).phase, "rebuilding");
check("Tuesday, window just open -> draft", tedPhase(G, at("2026-09-08T12:31:00Z")).phase, "draft");
check("Friday -> draft", tedPhase(G, at("2026-09-11T20:00:00Z")).phase, "draft");
check("Saturday 09:31Z, inside freeze -> frozen", tedPhase(G, at("2026-09-12T09:31:00Z")).phase, "frozen");
check("after the deadline, not yet live -> frozen", tedPhase(G, at("2026-09-12T13:00:00Z")).phase, "frozen");
check("no clock in the file -> rebuilding", tedPhase({ gameweek: 4, deadline_utc: G.deadline_utc, live_gameweek: G.live_gameweek }, at("2026-09-11T20:00:00Z")).phase, "rebuilding");
check("gw is the one being planned", tedPhase(G, at("2026-09-11T20:00:00Z")).gw, 4);

console.log("settle");
const pick = (id, name, role = "start", extra = {}) => ({ id, name, role, captain: false, vice: false, ...extra });
const gw3 = { gw: 3, written: "2026-09-01", picks: [pick(1, "A"), pick(2, "B")], why: [{ id: 1, name: "A", text: "x" }] };
const gw4 = { gw: 4, written: "2026-09-08", picks: [pick(1, "A"), pick(3, "C")], why: [{ id: 3, name: "C", text: "y" }] };

let r = settleTed({ ted: gw3 }, { ted: gw4 }, G, at("2026-09-06T15:00:00Z"));
check("live: the brain's rewrite is discarded", r.ted, gw3);
r = settleTed({ ted: gw3 }, { ted: { ...gw4, rebuild: "GW3 was fine." } }, G, at("2026-09-06T20:00:00Z"));
check("rebuilding: picks stay GW3, rebuild note taken", [r.ted.gw, r.ted.picks.length, r.ted.rebuild], [3, 2, "GW3 was fine."]);
r = settleTed({ ted: gw3 }, { ted: gw4 }, G, at("2026-09-08T13:00:00Z"));
check("draft: first draft for GW4 written, no changes yet", [r.ted.gw, r.ted.changes, r.ted.first_draft, r.ted.first_names], [4, undefined, "2026-09-08", ["A", "C"]]);
const gw4b = { gw: 4, written: "2026-09-10", picks: [pick(1, "A"), pick(4, "D")], why: [{ id: 4, name: "D", text: "z" }] };
r = settleTed({ ted: r.ted }, { ted: gw4b }, G, at("2026-09-10T13:00:00Z"));
check("draft: second draft records in/out since the first", r.ted.changes, { since: "2026-09-08", in: ["D"], out: ["C"] });
const gw4c = { gw: 4, written: "2026-09-11", picks: [pick(1, "A"), pick(3, "C")], why: [{ id: 3, name: "C", text: "y" }] };
r = settleTed({ ted: r.ted }, { ted: gw4c }, G, at("2026-09-11T13:00:00Z"));
check("draft: a man put back is no longer a change", r.ted.changes, undefined);
r = settleTed({ ted: gw4 }, { ted: { ...gw4, picks: [pick(9, "Z")] } }, G, at("2026-09-12T10:00:00Z"));
check("frozen: the team sheet is restored", r.ted, gw4);
r = settleTed({ ted: gw4 }, {}, G, at("2026-09-10T13:00:00Z"));
check("draft, brain wrote nothing: previous team kept", r.ted, gw4);
r = settleTed({}, { ted: { rebuild: "nothing to say" } }, G, at("2026-09-06T20:00:00Z"));
check("week one, rebuilding: a note and no team", r.ted, { gw: 4, rebuild: "nothing to say" });

// ---------------------------------------------------------- the squad law
console.log("validator");
const root = fileURLToPath(new URL("../..", import.meta.url));
const players = JSON.parse(readFileSync(join(root, "site/data/players.json"), "utf8")).players;
const byPos = (pos) => players.filter((p) => p.pos === pos).sort((a, b) => a.price - b.price);
const legal = () => {
  // Cheapest legal fifteen, three-per-club respected, so the file itself
  // decides whether the test can run.
  const clubs = {};
  const take = (pos, n) => {
    const out = [];
    for (const p of byPos(pos)) {
      if (out.length === n) break;
      if ((clubs[p.team] || 0) >= 3) continue;
      clubs[p.team] = (clubs[p.team] || 0) + 1;
      out.push(p);
    }
    return out;
  };
  const gk = take("GK", 2), df = take("DEF", 5), md = take("MID", 5), fw = take("FWD", 3);
  const xi = [gk[0], ...df.slice(0, 4), ...md.slice(0, 4), ...fw.slice(0, 2)];
  const bench = [gk[1], df[4], md[4], fw[2]];
  return xi.map((p, i) => pick(p.id, p.name, "start", i === 5 ? { captain: true } : i === 6 ? { vice: true } : {}))
    .concat(bench.map((p) => pick(p.id, p.name, "bench")));
};
const dir = mkdtempSync(join(tmpdir(), "ted-"));
writeFileSync(join(dir, "players.json"), JSON.stringify({ players }));
const run = (ted) => {
  const f = join(dir, "fpl.json");
  writeFileSync(f, JSON.stringify({ log: [], ted }));
  try {
    execFileSync("node", [join(root, "brain/validate-fpl.mjs"), f], { stdio: ["ignore", "pipe", "pipe"] });
    return "ok";
  } catch (e) { return String(e.stderr).trim().split("\n").pop(); }
};
const base = legal();
const why = [{ id: base[5].id, name: base[5].name, text: "In because he is cheap and starts." }];
check("a legal fifteen passes", run({ gw: 4, picks: base, why }), "ok");
check("fourteen men fail", /15/.test(run({ gw: 4, picks: base.slice(0, 14), why })), true);
check("two captains fail", /captains/.test(run({ gw: 4, picks: base.map((p, i) => i === 7 ? { ...p, captain: true } : p), why })), true);
check("a price in the file fails", /copied from the API/.test(run({ gw: 4, picks: base.map((p, i) => i === 0 ? { ...p, price: 4.0 } : p), why })), true);
check("a 'why' about a man not picked fails", /not one of the fifteen/.test(run({ gw: 4, picks: base, why: [{ id: 999999, name: "X", text: "no" }] })), true);
const expensive = base.map((p, i) => i === 9 ? (() => { const h = byPos("FWD").slice(-1)[0]; return pick(h.id, h.name); })() : p);
const cost = expensive.reduce((n, p) => n + players.find((q) => q.id === p.id).price, 0);
if (cost > 100) check("over budget fails", /budget/.test(run({ gw: 4, picks: expensive, why })), true);
const roastFile = join(dir, "fpl.json");
writeFileSync(roastFile, JSON.stringify({ log: [], roast: { text: "x" } }));
let roastSaid = "";
try { execFileSync("node", [join(root, "brain/validate-fpl.mjs"), roastFile], { stdio: ["ignore", "pipe", "pipe"] }); }
catch (e) { roastSaid = String(e.stderr); }
check("the roast is rejected on sight", /retired/.test(roastSaid), true);

console.log(fail ? `\n${fail} failing` : "\nall passing");
process.exit(fail ? 1 : 0);
