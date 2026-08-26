/* /api/auth — invite codes for the gaffers room.
   =========================================================================
   WHAT THIS PROTECTS, HONESTLY. Nothing here is a secret: the FPL API serves
   every one of these squads to anyone who asks, keyed by entry id. The gate
   exists so the five's business is not sitting on an open web page that a
   search engine can index — obscurity and tidiness, not confidentiality. It
   is worth saying plainly rather than implying a security property the
   system does not have.

   What it must NOT be is theatre. A login wall in front of a page whose data
   sits at /data/gaffers.json is worth nothing, so the personal data is not
   published as a static file at all: deploy.sh pushes it into KV and
   /api/private serves it only with a valid session. See that file.

   WHY CODES AND NOT GOOGLE. Five friends, one room. Google sign-in meant an
   OAuth client, a console, an email allowlist and a third party in the loop
   to identify people who already know each other. A code per gaffer does the
   same job with a KV key: KB mints one with `node brain/invite.mjs "<nick>"`,
   sends it however he likes, and it is good on any device until he revokes
   it. No password, nothing to reset, nothing to forget.

   FLOW
     1. KB mints a code. It lives at KV `invite:<CODE>` -> { nick, issued }.
     2. The gaffer types it, or taps /gaffers/?i=<CODE> which fills it in.
     3. We look the code up, and mint OUR OWN session cookie, HMAC-signed with
        SESSION_SECRET, HttpOnly so script cannot read it. The code is proof
        of identity once per device; the cookie is the session.
     4. Every later request re-reads the code from KV, so deleting it signs
        that person out everywhere within a request rather than in 30 days.

   GET    -> { nick } when signed in, 401 when not
   POST   -> { code }, sets the cookie
   DELETE -> clears the cookie
   ========================================================================= */

const COOKIE = "fa_session";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

/* Crockford base32: no I, L, O or U, so a code cannot be misread as another
   code and cannot accidentally spell anything. Twelve characters is 60 bits
   — not guessable at any rate an attacker could actually run. */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CODE_LEN = 12;

/* What a person types is not what is stored: they will add the dashes we
   printed, lower-case it, or type O for zero. Normalise before comparing. */
export function normalizeCode(raw) {
  const s = String(raw || "").toUpperCase()
    .replace(/[^0-9A-Z]/g, "")
    .replace(/O/g, "0").replace(/[IL]/g, "1");
  return /^[0-9A-Z]{4,64}$/.test(s) ? s : null;
}

export const formatCode = (code) => (code.match(/.{1,4}/g) || []).join("-");

export function newCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LEN));
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
  });

const b64urlToBytes = (s) => {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(pad + "=".repeat((4 - (pad.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};
const bytesToB64url = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/* ---------------- our own session ---------------- */

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  return crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
}

async function mintSession(secret, code, nick) {
  const payload = bytesToB64url(
    new TextEncoder().encode(JSON.stringify({ c: code, n: nick, x: Date.now() + MAX_AGE * 1000 }))
  );
  return payload + "." + bytesToB64url(await hmac(secret, payload));
}

/* Takes env, not just the secret, because the invite has to be re-read on
   every request — a session that outlives the code it was minted from is a
   revoke button that does nothing. */
export async function readSession(request, env) {
  if (!env || !env.SESSION_SECRET || !env.STARS) return null;
  const cookie = request.headers.get("cookie") || "";
  const hit = cookie.split(/;\s*/).find((c) => c.startsWith(COOKIE + "="));
  if (!hit) return null;
  const [payload, sig] = hit.slice(COOKIE.length + 1).split(".");
  if (!payload || !sig) return null;

  // Constant-ish time compare via the signature bytes, not a string ===.
  const expected = bytesToB64url(await hmac(env.SESSION_SECRET, payload));
  if (expected.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  if (diff !== 0) return null;

  let claims;
  try {
    claims = JSON.parse(new TextDecoder().decode(b64urlToBytes(payload)));
  } catch {
    return null;
  }
  if (!claims.x || claims.x < Date.now()) return null;
  if (!claims.c) return null;

  const invite = await env.STARS.get("invite:" + claims.c, { type: "json" });
  if (!invite) return null;
  // The nick comes from KV, not from the cookie: renaming a gaffer takes
  // effect on the next request instead of at the next sign-in.
  return { nick: invite.nick, code: claims.c };
}

const cookieHeader = (value, maxAge) =>
  `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

/* ---------------- throttle ----------------
   Sixty bits is not brute-forceable, but an endpoint that will answer a
   guess as fast as you can send one is still worth slowing down. Ten wrong
   codes from one address buys a ten-minute rest. KV's minimum TTL is 60s;
   the counter is best-effort and never blocks a correct code that already
   passed. */
const RATE_LIMIT = 10;
const RATE_WINDOW = 600;

async function tooManyTries(env, ip) {
  if (!ip) return false;
  const n = Number(await env.STARS.get("throttle:" + ip)) || 0;
  return n >= RATE_LIMIT;
}
async function noteFailure(env, ip) {
  if (!ip) return;
  const n = (Number(await env.STARS.get("throttle:" + ip)) || 0) + 1;
  await env.STARS.put("throttle:" + ip, String(n), { expirationTtl: RATE_WINDOW });
}

/* ---------------- routes ---------------- */

export async function onRequestGet({ request, env }) {
  if (!env.SESSION_SECRET || !env.STARS) return json({ error: "auth not configured" }, 503);
  const session = await readSession(request, env);
  if (!session) return json({ error: "not signed in" }, 401);
  return json(session);
}

export async function onRequestPost({ request, env }) {
  if (!env.SESSION_SECRET || !env.STARS) {
    return json({ error: "auth not configured", detail: "SESSION_SECRET and the STARS binding must be set" }, 503);
  }
  let body;
  try { body = await request.json(); } catch { return json({ error: "body must be JSON" }, 400); }

  const ip = request.headers.get("cf-connecting-ip") || "";
  if (await tooManyTries(env, ip)) {
    return json({ error: "too many tries", detail: "Wait ten minutes and try again." }, 429);
  }

  const code = normalizeCode(body && body.code);
  const invite = code ? await env.STARS.get("invite:" + code, { type: "json" }) : null;
  if (!invite || !invite.nick) {
    await noteFailure(env, ip);
    return json({ error: "no such code" }, 403);
  }

  // Last-used is a convenience for KB, not a login record: it is the one
  // thing that tells him whether a code he sent was ever actually used.
  try {
    await env.STARS.put("invite:" + code, JSON.stringify({ ...invite, last_used: new Date().toISOString() }));
  } catch { /* the sign-in matters, the bookkeeping does not */ }

  const token = await mintSession(env.SESSION_SECRET, code, invite.nick);
  return json({ nick: invite.nick }, 200, { "set-cookie": cookieHeader(token, MAX_AGE) });
}

export async function onRequestDelete() {
  return json({ ok: true }, 200, { "set-cookie": cookieHeader("", 0) });
}
