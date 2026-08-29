/* /api/report — somebody found something wrong.
   =========================================================================
   Five people now have codes and none of them read the repo. When the pitch
   is empty or a name is spelt wrong, the report has to be one tap from the
   thing that is broken, not a message somebody remembers to send later.

   WHY NOT A mailto:. It would be simpler and it would also publish an email
   address on an open page for anything that scrapes one. This keeps the
   report inside the site: KV, ninety days, readable by the owner on /usage/
   with the same invite code that opens the gaffers room.

   The same shape as /api/telemetry, for the same reasons: the body says only
   WHAT is wrong, the server works out who (readSession) and when (its own
   clock), the whole record lives in the KV key's metadata so reading them is
   one list(), and the key counts down so the newest is first.

   The one difference is that this is not fire-and-forget. Telemetry may fail
   silently because nobody is waiting on it; a person who has just typed out a
   bug IS waiting, and being told it sent when it did not would be worse than
   the bug.

   POST { text, path } -> { ok: true } or a 4xx that says why
   GET                 -> { reports } for the owner; 404 for everybody else
   ========================================================================= */

import { readSession, isAdmin } from "./auth.js";

const TTL = 60 * 60 * 24 * 90;
const KEY_SPACE = 1e13;
const MAX_TEXT = 1000;
const MAX_PATH = 120;
// A person reporting a bug sends one, maybe three. Twenty in ten minutes is
// somebody holding down a key, and the cap is per session or per daily hash.
const RATE_LIMIT = 20;
const RATE_WINDOW = 600;
const PAGE = 200;
const MAX_PAGES = 4;

const notFound = () =>
  new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

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

/* ---------------- not a person ----------------
   The deploy check posts a real report to prove the endpoint answers, and it
   then sits at the top of /usage/ pretending to be feedback. Same reason as
   the telemetry next door: KB should see the five, not the test harness.

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

/* Who to rate-limit, without keeping an address. A signed-in gaffer is his
   nickname; everybody else is six characters of HMAC over ip+UA salted with
   today's date — the same construction /api/telemetry uses, and the same
   reason: enough to stop a flood today, gone tomorrow. */
async function bucket(request, env, session) {
  if (session) return "n:" + session.nick;
  const ip = request.headers.get("cf-connecting-ip") || "";
  const ua = request.headers.get("user-agent") || "";
  if (!ip && !ua) return "anon";
  const day = new Date().toISOString().slice(0, 10);
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(env.SESSION_SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign(
    "HMAC", key, new TextEncoder().encode(day + "|" + ip + "|" + ua)
  );
  return "v:" + [...new Uint8Array(sig)].slice(0, 3)
    .map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function rateLimited(env, id) {
  const k = "rrate:" + id;
  const n = Number(await env.STARS.get(k)) || 0;
  if (n >= RATE_LIMIT) return true;
  await env.STARS.put(k, String(n + 1), { expirationTtl: RATE_WINDOW });
  return false;
}

export async function onRequestPost({ request, env }) {
  if (!env.STARS || !env.SESSION_SECRET) {
    return json({ error: "reports are not configured" }, 503);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "body must be JSON" }, 400);
  }

  const text = String((body && body.text) || "").trim();
  if (!text) return json({ error: "say what went wrong" }, 400);
  if (text.length > MAX_TEXT) {
    return json({ error: "that is longer than " + MAX_TEXT + " characters" }, 400);
  }

  // A verification run is not somebody with a problem. Answer it honestly so
  // the check still proves the endpoint works, but do not file it.
  const automated = isAutomated(request.headers.get("user-agent"));

  const session = await readSession(request, env).catch(() => null);
  const id = await bucket(request, env, session);
  if (await rateLimited(env, id)) {
    return json({ error: "that is a lot of reports at once. Give it ten minutes." }, 429);
  }

  const now = Date.now();
  const key = "rep:" + String(KEY_SPACE - now).padStart(14, "0") + ":" +
    Math.random().toString(36).slice(2, 8);

  const report = {
    t: new Date(now).toISOString(),
    // Who, from the cookie. A signed-out reporter is nobody, not a guess.
    w: session ? session.nick : null,
    x: text,
    p: String((body && body.path) || "").slice(0, MAX_PATH) || null,
    d: deviceOf(request.headers.get("user-agent")),
    done: false,
  };

  // Unlike telemetry, this one reports failure: somebody is waiting on it.
  if (!automated) await env.STARS.put(key, "", { expirationTtl: TTL, metadata: report });
  return json({ ok: true });
}

export async function onRequestGet({ request, env }) {
  if (!env.STARS || !env.SESSION_SECRET) return notFound();
  const session = await readSession(request, env).catch(() => null);
  // 404 rather than 403: an endpoint that admits to existing is an invitation.
  if (!isAdmin(session)) return notFound();

  const reports = [];
  let cursor;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await env.STARS.list({ prefix: "rep:", limit: PAGE, cursor });
    for (const k of res.keys) {
      if (k.metadata) reports.push(k.metadata);
    }
    if (res.list_complete) break;
    cursor = res.cursor;
  }
  return json({ reports });
}
