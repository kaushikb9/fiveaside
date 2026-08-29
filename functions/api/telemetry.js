/* /api/telemetry — who turned up, when, from where, and what they opened.
   =========================================================================
   WHY THIS EXISTS. Five-a-Side is written for five people and had no way of
   knowing whether any of them came back. Not analytics in the industry sense
   — no funnels, no retention curves, no third party. One line per page view
   and per tab tap, kept for ninety days, readable by one person.

   WHAT IT IS HONEST ABOUT. The client says only WHAT HAPPENED. Everything
   that could be lied about the server works out for itself:

     who      from the session cookie via readSession(), never from the body.
              A signed-out reader is nobody, not "anonymous user 12".
     where    request.cf.country / .city, which Cloudflare hands us free.
     device   the UA reduced to one coarse word. Not a fingerprint.
     when     the server clock.

   NO IP IS STORED. Not in a field, not in a key. Signed-out traffic gets a
   `vid`: six characters of HMAC over ip+UA salted with TODAY'S DATE, so two
   hits from the same stranger on one day count as one person and the same
   stranger tomorrow is a new one. That is enough to say "three strangers
   this week" and not enough to follow anybody.

   WHY KV METADATA AND NOT VALUES. The whole event lives in the key's
   metadata, and the value is empty. A `list()` returns metadata with the
   names, so reading three months back is one paginated list rather than
   three thousand gets.

   WHY THE KEY COUNTS DOWN. `tel:<1e13 - ms>:<rand>` sorts NEWEST FIRST in
   KV's lexicographic listing, so "the last day" stops after one page instead
   of paging through the entire ninety.

   POST { e, p, s }  -> 204, always. Telemetry never breaks a room.
   GET  ?days=7      -> { events } for the admin; 404 for everybody else.
   ========================================================================= */

import { readSession, isAdmin, rateBucket, overRate } from "./auth.js";

const TTL = 60 * 60 * 24 * 90; // ninety days, then it forgets by itself
const KEY_SPACE = 1e13; // comfortably past any ms timestamp this century

/* The five rooms that exist. An event for anything else is dropped rather
   than recorded, so a stranger cannot write arbitrary strings into the page
   KB reads. /usage/ is deliberately absent: it does not watch itself. */
const PATHS = ["/", "/gaffers/", "/locker/", "/archive/", "/about/"];
const EVENTS = ["view", "tab"];

/* Enough writes for five people reading football on a busy Saturday, few
   enough that a stranger with a loop cannot spend the day's KV budget. */
const RATE_LIMIT = 120;
const RATE_WINDOW = 600;

const noContent = () =>
  new Response(null, { status: 204, headers: { "cache-control": "no-store" } });

const notFound = () =>
  new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

/* ---------------- what the client is allowed to say ---------------- */

/* A tab label is a human string ("Next match week"), so it cannot be an
   allowlist — but it can be small, plain, and stripped of everything that
   could matter in HTML. The page escapes on top of this; both, not either. */
function cleanLabel(raw) {
  const s = String(raw == null ? "" : raw)
    .replace(/[^A-Za-z0-9 '&.’-]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 32);
  return s || null;
}

/* Coarse on purpose. "What are they reading this on" is a real question;
   "which of the four hundred Chrome builds" is not, and the narrower the
   string the closer it gets to identifying a device rather than a kind. */
function deviceOf(ua) {
  const s = String(ua || "");
  if (/iPhone/i.test(s)) return "iPhone";
  if (/iPad/i.test(s)) return "iPad";
  if (/Android/i.test(s)) return "Android";
  if (/Macintosh|Mac OS X/i.test(s)) return "Mac";
  if (/Windows/i.test(s)) return "Windows";
  if (/Linux/i.test(s)) return "Linux";
  return "Other";
}

/* The daily rotating id. Salted with the secret so it cannot be recomputed
   from outside, and with the date so it cannot be followed across days. */
async function dailyId(env, request) {
  const ip = request.headers.get("cf-connecting-ip") || "";
  const ua = request.headers.get("user-agent") || "";
  if (!ip && !ua) return null;
  const day = new Date().toISOString().slice(0, 10);
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(String(env.SESSION_SECRET || "no-secret")),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign(
    "HMAC", key, new TextEncoder().encode(day + "|" + ip + "|" + ua)
  );
  return [...new Uint8Array(sig)].slice(0, 3)
    .map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* ---------------- not a person ----------------
   smoke.sh drives a real browser through every room and taps every tab, so a
   single verification run wrote ~30 views and buried the five friends it was
   meant to count: on launch day one headless visitor was 76% of the traffic
   and looked exactly like a bot to the one person reading the page.

   Checked on the UA rather than navigator.webdriver, which is FALSE here —
   browse attaches over CDP to an ordinary Chrome and only the UA gives it
   away. Server-side rather than in the page, so it cannot be defeated by a
   cached script, and dropped rather than tagged: an event nobody wants to see
   is not worth a KV write. This is noise control, not a security control —
   anything determined can send any UA it likes, and lying its way OUT of the
   analytics is not an attack worth defending against. */
const isAutomated = (ua) =>
  /HeadlessChrome|Puppeteer|Playwright|\bbot\b|crawler|spider|curl\/|wget|python-requests/i
    .test(String(ua || ""));

/* ---------------- write ---------------- */

export async function onRequestPost({ request, env }) {
  // No store bound is not the reader's problem, and it is not worth a 500 to
  // a page that is otherwise working perfectly.
  if (!env.STARS) return noContent();

  let body;
  try { body = await request.json(); } catch { return noContent(); }

  const e = EVENTS.includes(body && body.e) ? body.e : null;
  const p = PATHS.includes(body && body.p) ? body.p : null;
  if (!e || !p) return noContent();
  const s = e === "tab" ? cleanLabel(body.s) : null;
  if (e === "tab" && !s) return noContent();

  if (isAutomated(request.headers.get("user-agent"))) return noContent();

  // TWO different buckets, and the difference is the point. `v` counts
  // PEOPLE, so it includes the UA: one reader on a phone and a laptop is
  // honestly two. The rate limit counts REQUESTS, so it must not — a UA is
  // chosen by the caller, and a bucket the caller can change is not a limit.
  if (await overRate(env, await rateBucket(request, env), "telrate:", RATE_LIMIT, RATE_WINDOW)) {
    return noContent();
  }
  const id = await dailyId(env, request);

  const session = await readSession(request, env).catch(() => null);
  const cf = request.cf || {};
  const now = Date.now();

  const event = {
    t: new Date(now).toISOString(),
    w: session ? session.nick : null,       // who, or nobody
    v: session ? null : id,                 // a stranger, counted for one day
    e, p, s,
    c: String(cf.country || "").slice(0, 2) || null,
    y: String(cf.city || "").slice(0, 40) || null,
    d: deviceOf(request.headers.get("user-agent")),
  };

  const key = "tel:" + String(KEY_SPACE - now).padStart(14, "0") +
    ":" + Math.random().toString(36).slice(2, 6);

  try {
    await env.STARS.put(key, "", { expirationTtl: TTL, metadata: event });
  } catch { /* a lost event is not worth a word to the reader */ }

  return noContent();
}

/* ---------------- read ---------------- */

const RANGES = { 1: 1, 7: 7, 30: 30, 90: 90 };
const PAGE = 1000;
const MAX_PAGES = 6;

export async function onRequestGet({ request, env }) {
  if (!env.STARS || !env.SESSION_SECRET) return notFound();

  // Not signed in and signed in as one of the other four are the same answer.
  // A 403 would confirm the endpoint exists; the page is unlisted, so this is.
  const session = await readSession(request, env);
  if (!isAdmin(session)) return notFound();

  const url = new URL(request.url);
  const days = RANGES[Number(url.searchParams.get("days"))] || 7;
  const cutoff = Date.now() - days * 86400000;

  const events = [];
  let cursor;
  let truncated = false;

  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await env.STARS.list({ prefix: "tel:", limit: PAGE, cursor });
    let past = false;
    for (const k of res.keys) {
      const m = k.metadata;
      if (!m || !m.t) continue;
      // Keys count down, so the first one older than the cutoff means every
      // key after it is older too.
      if (Date.parse(m.t) < cutoff) { past = true; break; }
      events.push(m);
    }
    if (past || res.list_complete) { cursor = null; break; }
    cursor = res.cursor;
    if (page === MAX_PAGES - 1) truncated = true;
  }

  return json({ days, since: new Date(cutoff).toISOString(), truncated, events });
}
