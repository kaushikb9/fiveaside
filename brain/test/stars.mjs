/* /api/stars — whose list does a star land in?
   =========================================================================
   The one test that has to exist. Before 2026-08-27 the POST body named the
   gaffer, so starring a player while looking at somebody else's squad wrote
   to THEIR watchlist. The fix is that the gaffer comes from the session
   cookie and the body is ignored; this pins that shut.

   Real handlers, stubbed KV, no network and no wrangler.
   Usage: node brain/test/stars.mjs
   ========================================================================= */

import * as auth from "../../functions/api/auth.js";
import * as stars from "../../functions/api/stars.js";

const store = new Map();
const KV = {
  async get(k, opts) {
    const v = store.get(k);
    if (v === undefined) return null;
    return opts && opts.type === "json" ? JSON.parse(v) : v;
  },
  async put(k, v) { store.set(k, v); },
};
const env = { STARS: KV, SESSION_SECRET: "test-secret-not-a-real-one" };

store.set("invite:AAAABBBBCCCC", JSON.stringify({ nick: "Xabi" }));
store.set("invite:DDDDEEEEFFFF", JSON.stringify({ nick: "Sir Fergie" }));

const req = (url, opts = {}) => new Request(url, opts);
const post = (body, cookie) => req("https://x/api/stars", {
  method: "POST",
  headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
  body: JSON.stringify(body),
});

let fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log((ok ? "  ok   " : "  FAIL ") + name +
    (ok ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`));
};

/* Signs in the way the browser does — POST a code, keep the Set-Cookie — so
   the session under test is a real minted one and not a hand-built claim. */
async function signIn(code) {
  const r = await auth.onRequestPost({
    request: req("https://x/api/auth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code }),
    }),
    env,
  });
  return r.headers.get("set-cookie").split(";")[0];
}

console.log("stars.js — whose list does a star land in?");

// Signed out is refused outright, and leaves nothing behind.
let r = await stars.onRequestPost({ request: post({ player: 411, on: true }), env });
check("signed out -> 401", r.status, 401);
check("signed out writes nothing", store.get("stars:Xabi"), undefined);

const xabi = await signIn("AAAABBBBCCCC");
const fergie = await signIn("DDDDEEEEFFFF");

r = await stars.onRequestPost({ request: post({ player: 411, on: true }, xabi), env });
check("Xabi stars 411 -> his list", await r.json(), { gaffer: "Xabi", stars: [411] });

// The bug itself: Xabi presses a star while looking at Fergie's squad, and
// the page sends Fergie's name along with it.
r = await stars.onRequestPost({
  request: post({ gaffer: "Sir Fergie", player: 426, on: true }, xabi), env });
check("body says Fergie, cookie says Xabi -> Xabi",
  await r.json(), { gaffer: "Xabi", stars: [411, 426] });
check("Fergie's list untouched", store.get("stars:Sir Fergie"), undefined);

r = await stars.onRequestPost({ request: post({ gaffer: "Xabi", player: 99, on: true }, fergie), env });
check("Fergie's cookie -> Fergie", await r.json(), { gaffer: "Sir Fergie", stars: [99] });
check("Xabi's list unchanged by Fergie", JSON.parse(store.get("stars:Xabi")), [411, 426]);

r = await stars.onRequestPost({ request: post({ player: 1, on: true }, "fa_session=abc.def"), env });
check("forged cookie -> 401", r.status, 401);

// The bounds check still has to run, and has to run on a signed-in request.
r = await stars.onRequestPost({ request: post({ player: "411", on: true }, xabi), env });
check("non-integer player -> 400", r.status, 400);

r = await stars.onRequestPost({ request: post({ player: 411, on: false }, xabi), env });
check("unstar removes it", (await r.json()).stars, [426]);

// Reading stays open by design — the room shows what everyone is watching.
r = await stars.onRequestGet({ env });
check("GET needs no cookie", (await r.json())["Sir Fergie"], [99]);

console.log(fail ? `\n${fail} FAILED` : "\nall passed");
process.exit(fail ? 1 : 0);
