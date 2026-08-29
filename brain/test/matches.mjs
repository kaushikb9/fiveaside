/* /api/matches — does the river hold together?
   =========================================================================
   The handler is a Pages Function, so it only needs `fetch` and `Response`,
   both of which node has. Stub the network, feed it a REAL ESPN payload
   captured on 2026-08-27, and assert on the shape the page depends on.

   Usage: node brain/test/matches.mjs
   ========================================================================= */

import { readFileSync } from "node:fs";
import { onRequestGet } from "../../functions/api/matches.js";

const EPL = JSON.parse(readFileSync(new URL("./fixtures/espn-eng1.json", import.meta.url)));

/* The 20 clubs, exactly as the deployed table.json publishes them. */
const TABLE = {
  timezone: "Asia/Kolkata",
  rows: [
    "Brighton & Hove Albion", "Arsenal", "Brentford", "Everton", "Hull City",
    "Chelsea", "Ipswich Town", "Manchester City", "Leeds United", "Liverpool",
    "Newcastle United", "Fulham", "AFC Bournemouth", "Sunderland",
    "Nottingham Forest", "Crystal Palace", "Manchester United", "Coventry City",
    "Tottenham Hotspur", "Aston Villa",
  ].map((team, i) => ({ pos: i + 1, team })),
};

let fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log((ok ? "  ok   " : "  FAIL ") + name +
    (ok ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`));
};
const ok = (name, cond, detail) => check(name, cond ? true : (detail ?? false), true);

/* One knob per competition so a test can make any of them fail. */
function install({ comps = {}, table = TABLE, tableOk = true } = {}) {
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/data/table.json")) {
      if (!tableOk) return { ok: false, status: 500 };
      return { ok: true, status: 200, json: async () => table };
    }
    const slug = (u.match(/soccer\/([^/]+)\/scoreboard/) || [])[1];
    const handler = comps[slug];
    if (handler === "fail") return { ok: false, status: 502 };
    return { ok: true, status: 200, json: async () => handler || { events: [] } };
  };
}

const call = async () => {
  const res = await onRequestGet({ request: { url: "https://fiveaside.pages.dev/api/matches" } });
  return { status: res.status, body: await res.json() };
};

console.log("matches.js — the calendar river");

// ---- the happy path: PL loaded, everything else empty (today's real state) --
install({ comps: { "eng.1": EPL } });
let { status, body } = await call();
check("200", status, 200);
ok("days are grouped and ascending",
  body.days.length > 0 && body.days.every((d, i, a) => i === 0 || a[i - 1].date < d.date));
ok("every match carries a competition tag", body.days.every((d) =>
  d.matches.every((m) => typeof m.comp === "string" && m.comp.length > 0)));
ok("every match has both sides named", body.days.every((d) =>
  d.matches.every((m) => m.home.name && m.away.name)));
ok("kickoffs sort within a day", body.days.every((d) =>
  d.matches.every((m, i, a) => i === 0 || a[i - 1].kickoff <= m.kickoff)));
check("no competition errored", body.errors, []);
check("the table timezone is carried into the response", body.timezone, "Asia/Kolkata");

const all = body.days.flatMap((d) => d.matches);
ok("a finished match carries a score",
  all.some((m) => m.status === "FINISHED" && m.home.score !== null && m.away.score !== null));
ok("a finished match carries scorers with minutes", (() => {
  const m = all.find((x) => x.scorers.length);
  return m && m.scorers.every((g) => g.name && (g.side === "home" || g.side === "away"));
})());
ok("goal minutes survive the parse — the thing FPL could never give",
  all.flatMap((m) => m.scorers).some((g) => /\d/.test(g.minute || "")));
/* ESPN sends score "0" for a fixture that has not kicked off, so without a
   status check every upcoming match renders as a goalless draw. */
ok("a scheduled match has NO score, not 0-0", (() => {
  const s = all.filter((m) => m.status === "SCHEDULED");
  return s.length > 0 && s.every((m) => m.home.score === null && m.away.score === null);
})());
ok("and no scorers either",
  all.filter((m) => m.status === "SCHEDULED").every((m) => m.scorers.length === 0));

// ---- D5: a tie only counts when a PL club is in it ------------------------
const EURO = {
  events: [
    { id: "e1", date: "2026-08-26T19:00Z", status: { type: { name: "STATUS_FULL_TIME" } },
      competitions: [{ competitors: [
        { homeAway: "home", score: "2", team: { id: "1", displayName: "Bayern Munich" } },
        { homeAway: "away", score: "1", team: { id: "2", displayName: "Real Madrid" } }], details: [] }] },
    { id: "e2", date: "2026-08-26T19:00Z", status: { type: { name: "STATUS_FULL_TIME" } },
      competitions: [{ competitors: [
        { homeAway: "home", score: "3", team: { id: "3", displayName: "Chelsea" } },
        { homeAway: "away", score: "0", team: { id: "4", displayName: "Benfica" } }], details: [] }] },
  ],
};
install({ comps: { "uefa.champions": EURO } });
({ body } = await call());
const euro = body.days.flatMap((d) => d.matches);
check("Chelsea v Benfica is kept", euro.map((m) => m.home.name), ["Chelsea"]);
ok("Bayern v Real Madrid is dropped", !euro.some((m) => m.home.name === "Bayern Munich"));

// ---- the filter fails safe: no club list means PL only, never wrong rows ---
install({ comps: { "uefa.champions": EURO, "eng.1": EPL }, tableOk: false });
({ body } = await call());
const noTable = body.days.flatMap((d) => d.matches);
ok("with no club list, PL still shows", noTable.some((m) => m.comp === "PL"));
ok("with no club list, foreign ties are still let through rather than guessed at",
  noTable.some((m) => m.home.name === "Bayern Munich"));

// ---- degrade, never fail ---------------------------------------------------
install({ comps: Object.fromEntries(
  ["eng.1", "uefa.champions", "uefa.europa", "uefa.europa.conf", "eng.fa", "eng.league_cup"]
    .map((s) => [s, "fail"])) });
({ status, body } = await call());
check("all six dead -> still 200", status, 200);
check("all six dead -> no days", body.days, []);
check("all six dead -> six errors", body.errors.length, 6);

install({ comps: { "eng.1": EPL, "uefa.champions": "fail" } });
({ body } = await call());
ok("one dead competition does not take the others with it", body.days.length > 0);
check("and it is named in errors", body.errors.length, 1);

// ---- local day boundaries --------------------------------------------------
install({ comps: { "eng.1": { events: [
  { id: "midnight", date: "2026-08-28T19:00:00Z",
    status: { type: { name: "STATUS_FINAL" } },
    competitions: [{ competitors: [
      { homeAway: "home", score: "1", team: { id: "H", displayName: "Chelsea" } },
      { homeAway: "away", score: "0", team: { id: "A", displayName: "Arsenal" } }], details: [] }] },
] } } });
({ body } = await call());
check("a 19:00Z fixture is grouped on its Asia/Kolkata calendar day",
  body.days.find((d) => d.matches.some((m) => m.id === "midnight"))?.date,
  "2026-08-29");

// ---- an own goal is credited to the side it helped -------------------------
install({ comps: { "eng.1": { events: [
  { id: "og", date: "2026-08-26T19:00Z", status: { type: { name: "STATUS_FULL_TIME" } },
    competitions: [{ competitors: [
      { homeAway: "home", score: "1", team: { id: "H", displayName: "Chelsea" } },
      { homeAway: "away", score: "0", team: { id: "A", displayName: "Arsenal" } }],
      details: [{ scoringPlay: true, ownGoal: true, team: { id: "A" },
                  clock: { displayValue: "54'" },
                  athletesInvolved: [{ displayName: "Gabriel" }] }] }] },
] } } });
({ body } = await call());
const og = body.days[0].matches[0].scorers[0];
check("an Arsenal own goal counts for Chelsea", { side: og.side, og: og.og }, { side: "home", og: true });
check("and keeps its minute", og.minute, "54'");

console.log(fail ? `\n${fail} FAILED` : "\nall passed");
process.exit(fail ? 1 : 0);
