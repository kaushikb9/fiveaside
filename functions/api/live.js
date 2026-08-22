// Live gameweek data for the FPL page.
//
// The official FPL API sends no CORS headers, so the browser cannot call it
// directly. This is the whole reason the function exists: a same-origin,
// read-only, whitelisted proxy that also does the joining server-side, so the
// page makes ONE request instead of fifteen.
//
// GET /api/live?gw=2[&entry=7149204][&league=391164]
//   -> { gw, status, updated, fixtures[], squad[], totals, league[] }
//
// Everything degrades: a dead sub-fetch drops its section, never the response.

const API = "https://fantasy.premierleague.com/api";

// Upstream is cached by Cloudflare using the origin's own max-age (300s).
// Live scores tolerate that; nothing here is worth hammering the API for.
const fetchJSON = async (path) => {
  const res = await fetch(`${API}${path}`, {
    headers: { accept: "application/json" },
    cf: { cacheTtl: 60, cacheEverything: true },
  });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
};

const int = (v, max) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 && n <= max ? n : null;
};

const POS = { 1: "GK", 2: "DEF", 3: "MID", 4: "FWD" };

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const gw = int(url.searchParams.get("gw"), 38);
  const entryId = int(url.searchParams.get("entry"), 99999999);
  const leagueId = int(url.searchParams.get("league"), 99999999);
  if (!gw) return new Response("bad request: gw must be 1-38", { status: 400 });

  let bootstrap;
  let live;
  let fixtures;
  try {
    [bootstrap, live, fixtures] = await Promise.all([
      fetchJSON("/bootstrap-static/"),
      fetchJSON(`/event/${gw}/live/`),
      fetchJSON(`/fixtures/?event=${gw}`),
    ]);
  } catch (err) {
    return new Response(`upstream unavailable: ${err.message}`, { status: 502 });
  }

  const teams = Object.fromEntries(bootstrap.teams.map((t) => [t.id, t.short_name]));
  const elements = Object.fromEntries(bootstrap.elements.map((e) => [e.id, e]));
  const stats = Object.fromEntries(live.elements.map((e) => [e.id, e.stats]));

  const fixtureRows = fixtures.map((f) => ({
    home: teams[f.team_h],
    away: teams[f.team_a],
    home_score: f.team_h_score,
    away_score: f.team_a_score,
    minutes: f.minutes,
    started: Boolean(f.started),
    finished: Boolean(f.finished_provisional ?? f.finished),
    kickoff: f.kickoff_time,
  }));

  const anyStarted = fixtureRows.some((f) => f.started);
  const allDone = fixtureRows.length > 0 && fixtureRows.every((f) => f.finished);
  const status = !anyStarted ? "pre" : allDone ? "done" : "live";

  // Provisional bonus: during a match the API reports bonus as 0 until the
  // game ends, so derive it from the live BPS ranking of players on the pitch.
  const provisional = {};
  for (const f of fixtures) {
    if (!f.started || f.finished_provisional) continue;
    const bps = (f.stats || []).find((s) => s.identifier === "bps");
    if (!bps) continue;
    const all = [...(bps.h || []), ...(bps.a || [])].sort((x, y) => y.value - x.value);
    const tiers = [...new Set(all.map((p) => p.value))].slice(0, 3);
    for (const p of all) {
      const rank = tiers.indexOf(p.value);
      if (rank === 0) provisional[p.element] = 3;
      else if (rank === 1) provisional[p.element] = 2;
      else if (rank === 2) provisional[p.element] = 1;
    }
  }

  const body = { gw, status, updated: new Date().toISOString(), fixtures: fixtureRows };

  if (entryId) {
    try {
      const picks = await fetchJSON(`/entry/${entryId}/event/${gw}/picks/`);
      let starters = 0;
      let bench = 0;
      body.squad = (picks.picks || []).map((p) => {
        const el = elements[p.element] || {};
        const st = stats[p.element] || {};
        const bonus = provisional[p.element] || 0;
        const points = (st.total_points || 0) + bonus;
        const scored = points * (p.multiplier || 0);
        if (p.position > 11) bench += st.total_points || 0;
        else starters += scored;
        return {
          name: el.web_name,
          team: teams[el.team],
          pos: POS[el.element_type],
          position: p.position,
          role: p.position > 11 ? "bench" : "start",
          captain: Boolean(p.is_captain),
          vice: Boolean(p.is_vice_captain),
          multiplier: p.multiplier,
          minutes: st.minutes || 0,
          points,
          provisional_bonus: bonus,
          goals: st.goals_scored || 0,
          assists: st.assists || 0,
          played: Boolean(st.minutes),
        };
      });
      const hits = (picks.entry_history || {}).event_transfers_cost || 0;
      body.totals = { starters, bench, hits, net: starters - hits };
    } catch {
      /* no picks for this gameweek yet — the page simply shows no squad */
    }
  }

  if (leagueId) {
    try {
      const standings = await fetchJSON(`/leagues-classic/${leagueId}/standings/`);
      const rows = ((standings.standings || {}).results || []).slice(0, 20);
      body.league = {
        name: (standings.league || {}).name,
        rows: rows.map((r) => ({
          rank: r.rank,
          name: r.entry_name,
          manager: r.player_name,
          entry: r.entry,
          total: r.total,
          event_total: r.event_total,
          is_owner: r.entry === entryId,
        })),
      };
    } catch {
      /* league unavailable — the static race table stays */
    }
  }

  return Response.json(body, {
    headers: { "cache-control": "public, max-age=60" },
  });
}
