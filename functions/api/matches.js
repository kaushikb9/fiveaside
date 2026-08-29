/* /api/matches — every match a Premier League club plays, either side of today.
   =========================================================================
   This used to be built on the FPL API, and that was the bug. An FPL gameweek
   is a Premier League construct: a Tuesday Champions League tie or a January
   FA Cup round has nowhere to live inside one, so those matches could not be
   shown at all. And FPL's "current" gameweek stays current from the last
   whistle until the next kickoff, which meant Sunday evening to Friday the
   page showed a finished weekend and an empty midweek — exactly the days when
   European football is played.

   So the window is now the CALENDAR, not the gameweek: seven days back, seven
   forward, every competition a PL club can be in, grouped by day.

   GET /api/matches
     -> { updated, timezone, window: {from, to}, days: [DAY], errors: [string] }
        DAY   = { date: "2026-08-23", matches: [MATCH] }
        MATCH = { id, comp, comp_name, kickoff, status, minute,
                  home: SIDE, away: SIDE, scorers: [GOAL] }
        SIDE  = { name, short, crest, score }
        GOAL  = { name, side, minute, og, pen }

   Everything degrades: a competition that fails drops its matches and adds a
   line to `errors`. Six dead feeds still return 200 with an empty `days`, so
   the page renders its table rather than an error.
   ========================================================================= */

const ESPN = "https://site.api.espn.com/apis/site/v2/sports/soccer";

/* Slugs verified against the live API, and they are not guessable: the
   Conference League is uefa.europa.conf with a DOT, while uefa.europa_conf
   answers HTTP 400. Kept in step with _LEAGUE_MAP in src/touchline/sources/espn.py
   — two parsers of the same feed, because one runs in Python for the brain and
   one runs here for the page, and neither can call the other. */
const COMPS = [
  { code: "PL", slug: "eng.1", name: "Premier League" },
  { code: "UCL", slug: "uefa.champions", name: "Champions League" },
  { code: "EL", slug: "uefa.europa", name: "Europa League" },
  { code: "UECL", slug: "uefa.europa.conf", name: "Conference League" },
  { code: "FA", slug: "eng.fa", name: "FA Cup" },
  { code: "EFL", slug: "eng.league_cup", name: "EFL Cup" },
];

const DAYS_BACK = 7;
const DAYS_FORWARD = 7;

const LIVE = new Set([
  "STATUS_IN_PLAY", "STATUS_HALFTIME", "STATUS_FIRST_HALF", "STATUS_SECOND_HALF",
]);
const DONE = new Set([
  "STATUS_FINAL", "STATUS_FULL_TIME", "STATUS_AFTER_EXTRA_TIME", "STATUS_AFTER_PENALTIES",
]);

const ymd = (d) => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
const iso = (d) => d.toISOString().slice(0, 10);

function safeTimeZone(value) {
  if (typeof value !== "string" || !value) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return value;
  } catch {
    return "UTC";
  }
}

function dateInZone(date, timeZone) {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map((p) => [p.type, p.value]));
    return `${values.year}-${values.month}-${values.day}`;
  } catch {
    // A bad or unavailable timezone must not take the fixture tab down.
    return iso(date);
  }
}

/* ESPN's bot rules are the wrong way round, and it cost a deploy to find out.
   Measured against the live API on 2026-08-27:

     no User-Agent at all ........ 403
     Cloudflare-Workers default .. 403
     a normal desktop browser UA . 403
     curl/8.7.1 .................. 200

   It rejects things that look like browsers and accepts things that look like
   command-line tools, so the header below is deliberate and load-bearing
   rather than decoration. If this starts 403ing again, this is the first line
   to look at, and `errors[]` in the response will be carrying the status. */
const UA = "curl/8.7.1";

async function scoreboard(slug, window) {
  const url = `${ESPN}/${slug}/scoreboard?dates=${window}&limit=400`;
  const res = await fetch(url, {
    headers: { accept: "application/json", "user-agent": UA },
    cf: { cacheTtl: 60, cacheEverything: true },
  });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

/* ESPN carries what FPL never did: the minute a goal went in, whether it was a
   penalty, and whether it was an own goal. The old code said "FPL reports who
   scored but never when, so the line is names and counts — no invented clock."
   That limitation belonged to the feed, not to football. */
function goalsFrom(competition, homeId) {
  const out = [];
  for (const d of competition.details || []) {
    if (!d.scoringPlay) continue;
    const who = (d.athletesInvolved || [])[0];
    if (!who) continue;
    // An own goal is credited to the side it helped, which is the other one.
    const scoredFor = d.ownGoal
      ? (String(d.team?.id) === String(homeId) ? "away" : "home")
      : (String(d.team?.id) === String(homeId) ? "home" : "away");
    out.push({
      name: who.displayName || who.fullName || "",
      side: scoredFor,
      minute: d.clock?.displayValue || null,
      og: Boolean(d.ownGoal),
      pen: Boolean(d.penaltyKick),
    });
  }
  return out;
}

/* ESPN sends score "0" for a match that has not kicked off, so a scheduled
   fixture will claim to be a goalless draw unless the status is consulted.
   A score exists only once there is a match to have scored in. */
function sideFrom(competitor, played) {
  const t = competitor?.team || {};
  const raw = competitor?.score;
  const hasScore = played && raw !== undefined && raw !== null && raw !== "";
  return {
    name: (t.displayName || t.name || "").trim(),
    short: t.abbreviation || t.shortDisplayName || null,
    crest: t.logo || null,
    score: hasScore ? Number(raw) : null,
  };
}

function matchFrom(event, comp) {
  const c = (event.competitions || [])[0];
  if (!c) return null;
  const competitors = c.competitors || [];
  const homeC = competitors.find((x) => x.homeAway === "home");
  const awayC = competitors.find((x) => x.homeAway === "away");
  if (!homeC || !awayC) return null;

  const state = event.status?.type?.name || c.status?.type?.name || "";
  const status = LIVE.has(state) ? "LIVE" : DONE.has(state) ? "FINISHED" : "SCHEDULED";

  const played = status !== "SCHEDULED";

  return {
    id: String(event.id),
    comp: comp.code,
    comp_name: comp.name,
    kickoff: event.date || c.date || null,
    status,
    minute: status === "LIVE" ? (event.status?.displayClock || null) : null,
    home: sideFrom(homeC, played),
    away: sideFrom(awayC, played),
    scorers: played ? goalsFrom(c, homeC.team?.id) : [],
  };
}

/* The page follows Premier League clubs, so a tie earns a row only when one of
   them is in it: Chelsea v Benfica yes, Bayern v Real Madrid no.

   The 20 names come from site/data/table.json, which this deployment already
   publishes and which is correct as of the morning's run — cheaper and more
   honest than a seventh request to ESPN for standings we already have. If it
   cannot be read we keep PL matches only, which is the safe direction to fail:
   fewer rows, never wrong ones. */
async function premierLeagueClubs(request) {
  try {
    const res = await fetch(new URL("/data/table.json", request.url).toString(), {
      cf: { cacheTtl: 300, cacheEverything: true },
    });
    if (!res.ok) throw new Error(String(res.status));
    const t = await res.json();
    const names = (t.rows || []).map((r) => r.team).filter(Boolean);
    return {
      clubs: names.length ? new Set(names.map((n) => n.toLowerCase())) : null,
      timeZone: safeTimeZone(t.timezone),
    };
  } catch { /* fall through */ }
  return { clubs: null, timeZone: "UTC" };
}

export async function onRequestGet({ request }) {
  const now = new Date();
  const from = new Date(now.getTime() - DAYS_BACK * 864e5);
  const to = new Date(now.getTime() + DAYS_FORWARD * 864e5);
  const window = `${ymd(from)}-${ymd(to)}`;

  const league = await premierLeagueClubs(request);
  const { clubs, timeZone } = league;
  const errors = [];

  const pulls = await Promise.all(
    COMPS.map(async (comp) => {
      try {
        const payload = await scoreboard(comp.slug, window);
        return (payload.events || [])
          .map((e) => matchFrom(e, comp))
          .filter(Boolean);
      } catch (err) {
        // One dead competition is not a dead page.
        errors.push(`${comp.code}: ${err.message}`);
        return [];
      }
    })
  );

  const isPL = (m) =>
    m.comp === "PL" ||
    Boolean(clubs && (
      clubs.has(m.home.name.toLowerCase()) ||
      clubs.has(m.away.name.toLowerCase())
    ));

  const matches = pulls.flat().filter((m) => m.kickoff && isPL(m));

  // Grouped by the configured local date, days ascending, matches within a day
  // by kickoff. ESPN's timestamps are UTC; using toISOString() here would put
  // a late evening fixture on the previous local day in Asia/Kolkata.
  const byDay = new Map();
  for (const m of matches) {
    const key = dateInZone(new Date(m.kickoff), timeZone);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(m);
  }
  const days = [...byDay.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, list]) => ({
      date,
      matches: list.sort((x, y) => String(x.kickoff).localeCompare(String(y.kickoff))),
    }));

  return Response.json(
    {
      updated: now.toISOString(),
      timezone: timeZone,
      window: { from: dateInZone(from, timeZone), to: dateInZone(to, timeZone) },
      days,
      errors,
    },
    { headers: { "cache-control": "public, max-age=60" } },
  );
}
