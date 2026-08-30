// Extract a compact, REAL data blob for the mockups from the live data files.
import { readFileSync, writeFileSync } from "node:fs";

const P = JSON.parse(readFileSync("site/data/players.json", "utf8"));
const CFG = JSON.parse(readFileSync("fiveaside.config.json", "utf8"));
const G = JSON.parse(readFileSync("site/data/gaffers.json", "utf8"));
const F = JSON.parse(readFileSync("site/data/fpl.json", "utf8"));

const byId = Object.fromEntries(P.players.map((p) => [p.id, p]));
const verdictById = Object.fromEntries((F.verdicts ?? []).map((v) => [v.id, v]));

const owned = P.players.filter((p) => p.owned_by?.length);
const flagged = P.players.filter((p) => p.status && p.status !== "a" && p.news);
const popular = [...P.players].sort((a, b) => b.ownership - a.ownership).slice(0, 60);

const seen = new Set();
const pool = [];
for (const p of [...owned, ...flagged, ...popular]) {
  if (seen.has(p.id)) continue;
  seen.add(p.id);
  pool.push({
    id: p.id,
    name: p.name,
    team: p.team,
    pos: p.pos,
    price: p.price,
    own: p.ownership,
    pts: p.points,
    form: p.form,
    status: p.status ?? "a",
    news: p.news ?? "",
    by: p.owned_by ?? [],
    next3: (p.next3 ?? []).map((f) => ({ gw: f.gw, opp: f.opp, h: f.home, fdr: f.fdr })),
    avg: p.next3_avg ?? null,
    pens: !!p.penalties,
    v: verdictById[p.id] ? { w: verdictById[p.id].verdict, m: verdictById[p.id].moved, why: verdictById[p.id].why, trig: verdictById[p.id].trigger } : null,
  });
}

const pick = (p) => ({
  id: p.element, n: p.name, t: p.team, pos: p.pos, pr: p.price,
  captain: !!p.captain, vice: !!p.vice, multiplier: p.multiplier ?? 1,
});
const CLUB_OF = Object.fromEntries((CFG.fpl?.people ?? []).map((p) => [p.nick, p.club]));
const people = G.people.map((g) => ({
  nick: g.nick,
  club: CLUB_OF[g.nick] ?? null,
  team: g.team_name,
  total: g.total_points,
  gw: g.gw_points,
  or: g.overall_rank,
  lg: g.league_rank,
  bank: g.bank,
  value: g.value,
  ft: g.free_transfers,
  active_chip: g.active_chip ?? null,
  bench_points: g.bench_points ?? null,
  xi: g.picks.filter((p) => p.role !== "bench").map(pick),
  bench: g.picks.filter((p) => p.role === "bench").map(pick),
  only: g.picks.filter((p) => byId[p.element]?.owned_by?.length === 1).map((p) => p.name),
}));

// The league room's newest entry — Touchline is the third area and has to be
// in the mockup for the platform to be judgeable as one thing.
const D = JSON.parse(readFileSync("site/data/digests.json", "utf8")).digests;
const latest = [...D].sort((x, y) => y.date.localeCompare(x.date))[0];

// "Differentials that stood out" — KB dropped the captain poll for this.
// Low-owned players who actually returned; computed, never asserted.
const differentials = [...P.players]
  .filter((p) => p.ownership < 10 && p.points > 0)
  .sort((a, b) => b.points - a.points || a.ownership - b.ownership)
  .slice(0, 8)
  .map((p) => ({
    name: p.name, team: p.team, pos: p.pos, price: p.price,
    own: p.ownership, pts: p.points, by: p.owned_by ?? [],
  }));

// Threshold options for the player file, with the real counts behind each.
const thresholds = [0, 1, 2, 3, 5, 10].map((t) => ({
  t,
  n: P.players.filter((p) => p.ownership >= t || p.owned_by?.length).length,
}));

const data = {
  digest: latest,
  differentials,
  thresholds,
  digestCount: D.length,
  gw: G.gameweek,
  live: G.live_gameweek,
  generated: F.generated_at,
  people,
  league: { name: G.league.name, rows: G.league.rows.map((r) => ({ rank: r.rank, name: r.name, total: r.total, gw: r.event_total, is: !!r.is_gaffer, nick: r.nick ?? null })) },
  pool,
  signals: F.signals,
  watchlist: F.watchlist,
  doctrine: F.doctrine,
  chips: F.chips,
  // wagers and captain_poll are gone from the design (KB, 2026-08-23) — they
  // are not shipped in the mockup data either, so nothing dead travels with it.
  ticker: F.ticker,
  plan: F.plan,
  log: F.log,
  shared: {
    all5: P.players.filter((p) => p.owned_by?.length === 5).map((p) => p.name),
    four: P.players.filter((p) => p.owned_by?.length === 4).map((p) => ({ n: p.name, missing: ["Xabi", "Sir Alex", "Ronaldo", "Enzo", "Arsene"].filter((x) => !p.owned_by.includes(x))[0] })),
  },
};

writeFileSync(process.argv[2], JSON.stringify(data));
console.error(`data: ${pool.length} players · ${people.length} people · ${flagged.length} flagged in file`);
