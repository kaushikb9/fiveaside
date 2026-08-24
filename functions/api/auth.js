/* /api/auth — Google sign-in for the gaffers room.
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

   FLOW
     1. The browser gets a Google ID token from Google Identity Services.
     2. POST it here. We verify the signature against Google's published keys
        — never trust a JWT the client decoded for us — then check issuer,
        audience, expiry and that the email is verified AND allowlisted.
     3. We mint our OWN session cookie, HMAC-signed with SESSION_SECRET,
        HttpOnly so script cannot read it. Google's token is then discarded;
        it is proof of identity once, not a session.

   GET    -> { email, nick } when signed in, 401 when not
   POST   -> { credential } from Google, sets the cookie
   DELETE -> clears the cookie
   ========================================================================= */

const COOKIE = "fa_session";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days
const GOOGLE_ISS = ["accounts.google.com", "https://accounts.google.com"];
const JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";

/* The allowlist. Email -> nickname, so a session already knows whose room it
   is. Only KB's address is live while this is being tested; the other four
   are listed as null so the mapping is obvious when their addresses arrive
   and nobody has to guess the shape. */
const ALLOWED = {
  "kaushik1025@gmail.com": "Xabi",
  // "…": "Sir Fergie",
  // "…": "Mr CR7",
  // "…": "The Special One",
  // "…": "Le Professeur",
};

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

/* ---------------- verifying Google's token ---------------- */

async function verifyGoogleToken(jwt, clientId) {
  const parts = String(jwt || "").split(".");
  if (parts.length !== 3) throw new Error("malformed token");
  const [headB64, payloadB64, sigB64] = parts;

  const header = JSON.parse(new TextDecoder().decode(b64urlToBytes(headB64)));
  const claims = JSON.parse(new TextDecoder().decode(b64urlToBytes(payloadB64)));
  if (header.alg !== "RS256") throw new Error("unexpected algorithm");

  // Google publishes its signing keys; pick the one this token names.
  const jwks = await fetch(JWKS_URL, { cf: { cacheTtl: 3600 } }).then((r) => r.json());
  const jwk = (jwks.keys || []).find((k) => k.kid === header.kid);
  if (!jwk) throw new Error("signing key not found");

  const key = await crypto.subtle.importKey(
    "jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]
  );
  const ok = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5", key,
    b64urlToBytes(sigB64),
    new TextEncoder().encode(headB64 + "." + payloadB64)
  );
  if (!ok) throw new Error("bad signature");

  // Signature valid — now the claims have to be for US, and current.
  if (!GOOGLE_ISS.includes(claims.iss)) throw new Error("wrong issuer");
  if (claims.aud !== clientId) throw new Error("wrong audience");
  if (typeof claims.exp !== "number" || claims.exp * 1000 < Date.now()) throw new Error("expired");
  if (claims.email_verified !== true && claims.email_verified !== "true") {
    throw new Error("email not verified");
  }
  return String(claims.email || "").toLowerCase();
}

/* ---------------- our own session ---------------- */

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  return crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
}

async function mintSession(secret, email, nick) {
  const payload = bytesToB64url(
    new TextEncoder().encode(JSON.stringify({ e: email, n: nick, x: Date.now() + MAX_AGE * 1000 }))
  );
  return payload + "." + bytesToB64url(await hmac(secret, payload));
}

export async function readSession(request, secret) {
  const cookie = request.headers.get("cookie") || "";
  const hit = cookie.split(/;\s*/).find((c) => c.startsWith(COOKIE + "="));
  if (!hit) return null;
  const [payload, sig] = hit.slice(COOKIE.length + 1).split(".");
  if (!payload || !sig) return null;

  // Constant-ish time compare via the signature bytes, not a string ===.
  const expected = bytesToB64url(await hmac(secret, payload));
  if (expected.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  if (diff !== 0) return null;

  try {
    const claims = JSON.parse(new TextDecoder().decode(b64urlToBytes(payload)));
    if (!claims.x || claims.x < Date.now()) return null;
    // The allowlist is checked again on every request, not just at sign-in,
    // so removing someone takes effect immediately rather than in 30 days.
    if (!ALLOWED[claims.e]) return null;
    return { email: claims.e, nick: claims.n };
  } catch {
    return null;
  }
}

const cookieHeader = (value, maxAge) =>
  `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

/* ---------------- routes ---------------- */

export async function onRequestGet({ request, env }) {
  if (!env.SESSION_SECRET) return json({ error: "auth not configured" }, 503);
  const session = await readSession(request, env.SESSION_SECRET);
  if (!session) return json({ error: "not signed in" }, 401);
  return json(session);
}

export async function onRequestPost({ request, env }) {
  if (!env.SESSION_SECRET || !env.GOOGLE_CLIENT_ID) {
    return json({ error: "auth not configured", detail: "GOOGLE_CLIENT_ID and SESSION_SECRET must be set" }, 503);
  }
  let body;
  try { body = await request.json(); } catch { return json({ error: "body must be JSON" }, 400); }

  let email;
  try {
    email = await verifyGoogleToken(body && body.credential, env.GOOGLE_CLIENT_ID);
  } catch (e) {
    return json({ error: "sign-in rejected", detail: e.message }, 401);
  }

  const nick = ALLOWED[email];
  if (!nick) {
    // Deliberately says which address was refused: this is a five-person room,
    // and "you are not on the list" is more useful than a blank denial.
    return json({ error: "not on the list", email }, 403);
  }

  const token = await mintSession(env.SESSION_SECRET, email, nick);
  return json({ email, nick }, 200, { "set-cookie": cookieHeader(token, MAX_AGE) });
}

export async function onRequestDelete() {
  return json({ ok: true }, 200, { "set-cookie": cookieHeader("", 0) });
}
