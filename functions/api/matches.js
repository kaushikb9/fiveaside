/* /api/matches — this match week and the next one.
   =========================================================================
   The league room needs three things in one place: the table (which comes
   from digests.json and is already local), this match week's scores, and
   next match week's fixtures. Only the last two need the network, and the
   FPL API sends no CORS headers, so they come through here.

   One request, server-joined: bootstrap (teams, events, player names) plus
   the fixture list for each of the two gameweeks. The browser gets names and
   crests already resolved rather than three blobs to join itself.

   GET /api/matches
     -> { updated, now: WEEK|null, next: WEEK|null }
        WEEK = { gw, name, deadline, status, fixtures[] }

   "now" is the gameweek FPL calls current — which stays current after its
   last whistle until the next one kicks off, so a finished week keeps
   showing its results rather than blanking out mid-week. Everything
   degrades: a dead sub-fetch drops its week, never the response.
   ========================================================================= */

const API = "https://fantasy.premierleague.com/api";
const BADGE = (code) => `https://resources.premierleague.com/premierleague/badges/70/t${code}.png`;

const fetchJSON = async (path) => {
  const res = await fetch(`${API}${path}`, {
    headers: { accept: "application/json" },
    cf: { cacheTtl: 60, cacheEverything: true },
  });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
};

/* Goals out of a fixture's stat block. FPL reports who scored but never when,
   so the minute is genuinely not available — the row says "Saka, Saka" as
   "Saka (2)" rather than inventing a clock. Own goals are attributed to the
   side that benefits, flagged, because that is how a scoreline reads. */
function scorers(fixture, names) {
  const out = { h: [], a: [] };
  const push = (side, element, value, og) => {
    const name = names[element];
    if (!name) return;
    out[side].push({ name, goals: value, og: Boolean(og) });
  };
  for (const stat of fixture.stats || []) {
    if (stat.identifier === "goals_scored") {
      (stat.h || []).forEach((p) => push("h", p.element, p.value, false));
      (stat.a || []).forEach((p) => push("a", p.element, p.value, false));
    } else if (stat.identifier === "own_goals") {
      // An own goal by a home player is a goal for the away side.
      (stat.h || []).forEach((p) => push("a", p.element, p.value, true));
      (stat.a || []).forEach((p) => push("h", p.element, p.value, true));
    }
  }
  return out;
}

function weekFrom(event, fixtures, teams, names) {
  const rows = fixtures.map((f) => {
    const s = scorers(f, names);
    const side = (id, score, list) => {
      const t = teams[id] || {};
      return { name: t.name, short: t.short_name, crest: t.code ? BADGE(t.code) : null, score, scorers: list };
    };
    return {
      id: f.id,
      kickoff: f.kickoff_time,
      provisional_start: Boolean(f.provisional_start_time),
      minutes: f.minutes || 0,
      started: Boolean(f.started),
      finished: Boolean(f.finished_provisional ?? f.finished),
      home: side(f.team_h, f.team_h_score, s.h),
      away: side(f.team_a, f.team_a_score, s.a),
    };
  }).sort((x, y) => String(x.kickoff).localeCompare(String(y.kickoff)));

  const anyStarted = rows.some((f) => f.started);
  const allDone = rows.length > 0 && rows.every((f) => f.finished);
  return {
    gw: event.id,
    name: event.name,
    deadline: event.deadline_time,
    status: !anyStarted ? "pre" : allDone ? "done" : "live",
    fixtures: rows,
  };
}

export async function onRequestGet() {
  let bootstrap;
  try {
    bootstrap = await fetchJSON("/bootstrap-static/");
  } catch (err) {
    return new Response(`upstream unavailable: ${err.message}`, { status: 502 });
  }

  const teams = Object.fromEntries(bootstrap.teams.map((t) => [t.id, t]));
  const names = Object.fromEntries(bootstrap.elements.map((e) => [e.id, e.web_name]));
  const events = bootstrap.events || [];
  const current = events.find((e) => e.is_current) || null;
  const upcoming = events.find((e) => e.is_next) || null;

  const load = async (event) => {
    if (!event) return null;
    try {
      return weekFrom(event, await fetchJSON(`/fixtures/?event=${event.id}`), teams, names);
    } catch {
      return null; // one week missing is not a broken response
    }
  };

  const [now, next] = await Promise.all([load(current), load(upcoming)]);

  return Response.json(
    { updated: new Date().toISOString(), now, next },
    { headers: { "cache-control": "public, max-age=60" } },
  );
}
