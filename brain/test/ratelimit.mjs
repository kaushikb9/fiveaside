/* The rate limits — a bucket the caller picks is not a limit.
   =========================================================================
   Every cap on this site used to be keyed on HMAC(day | ip | UA). The UA is
   a header, so a caller who changed it got a fresh allowance: the telemetry
   cap of 120 and the report cap of 20 were both decorative, and one address
   could write into KV until it got bored. /api/auth was worse in the other
   direction — it keyed its throttle on the RAW address, which made "no IP is
   stored" true of the telemetry and false of the site.

   Both are pinned here, because the failure is silent: nothing errors, the
   limit simply never fires, and the only symptom is a usage page filling up
   with junk weeks later.

   The stub store is synchronous, so the caps here are exact. LIVE KV IS NOT:
   its reads are edge-cached for at least sixty seconds, so a burst overshoots
   before the limit engages — twenty-five posts against a cap of twenty all
   landed, and everything after was refused. These tests pin the RULE (which
   bucket is counted, and that no key holds an address); they do not promise a
   hard ceiling, and no comment in this repo should claim one.

   Real handlers, stubbed KV, no network.
   Usage: node brain/test/ratelimit.mjs
   ========================================================================= */

import * as auth from "../../functions/api/auth.js";
import * as telemetry from "../../functions/api/telemetry.js";
import * as report from "../../functions/api/report.js";

let fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log((ok ? "  ok   " : "  FAIL ") + name +
    (ok ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`));
};

const store = new Map();
const KV = {
  async get(k, opts) {
    const v = store.get(k);
    if (v === undefined) return null;
    return opts && opts.type === "json" ? JSON.parse(v) : v;
  },
  async put(k, v, o) { store.set(k, v); if (o && o.metadata) store.set(k + "#m", o.metadata); },
  async list({ prefix }) {
    return { keys: [...store.keys()].filter((k) => k.startsWith(prefix) && !k.endsWith("#m"))
      .map((name) => ({ name, metadata: store.get(name + "#m") })), list_complete: true };
  },
};
const env = { STARS: KV, SESSION_SECRET: "test-secret-not-a-real-one" };

const REAL_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1";
const post = (path, body, { ip = "203.0.113.7", ua = REAL_UA } = {}) =>
  new Request("https://example.test" + path, {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": ip, "user-agent": ua },
    body: JSON.stringify(body),
  });

const rows = (p) => [...store.keys()].filter((k) => k.startsWith(p) && !k.endsWith("#m")).length;

console.log("the rate limits");

/* ---- the bypass ---- */
// 130 telemetry posts, every one from a DIFFERENT user-agent, one address.
// The cap is 120. Under the old bucket every request was its own bucket and
// all 130 landed.
store.clear();
for (let i = 0; i < 130; i++) {
  await telemetry.onRequestPost({
    request: post("/api/telemetry", { e: "view", p: "/" }, { ua: REAL_UA + " build/" + i }),
    env,
  });
}
const wrote = rows("tel:");
check("rotating the UA does not buy a fresh allowance", wrote <= 120, true);
console.log("       130 posts, 130 user-agents, one address -> " + wrote + " rows (cap 120)");

// The same address with ONE user-agent must be capped identically — proving
// the limit is about the address and not about UA variety.
store.clear();
for (let i = 0; i < 130; i++) {
  await telemetry.onRequestPost({ request: post("/api/telemetry", { e: "view", p: "/" }), env });
}
check("one UA is capped the same", rows("tel:") <= 120, true);

// A different address is a different bucket, or the site would rate-limit
// the five friends against each other.
const before = rows("tel:");
await telemetry.onRequestPost({
  request: post("/api/telemetry", { e: "view", p: "/" }, { ip: "198.51.100.4" }), env,
});
check("a different address still gets through", rows("tel:") > before, true);

/* ---- reports ---- */
store.clear();
let last;
for (let i = 0; i < 25; i++) {
  last = await report.onRequestPost({
    request: post("/api/report", { text: "something is broken " + i }, { ua: REAL_UA + " b" + i }),
    env,
  });
}
check("reports cap despite a rotating UA", rows("rep:") <= 20, true);
check("and the 25th is told so, not silently dropped", last.status, 429);

/* ---- no address is stored ---- */
store.clear();
await telemetry.onRequestPost({ request: post("/api/telemetry", { e: "view", p: "/" }), env });
await report.onRequestPost({ request: post("/api/report", { text: "hello" }), env });
await auth.onRequestPost({ request: post("/api/auth", { code: "WRONGCODE123" }), env });
const leaked = [...store.keys()].filter((k) => k.includes("203.0.113.7"));
check("no key anywhere contains the address", leaked, []);
// The sign-in throttle is the one that used to.
const throttles = [...store.keys()].filter((k) => k.startsWith("throttle:"));
check("the sign-in throttle counted the attempt", throttles.length, 1);
check("keyed on a hash, not an address", /^throttle:[0-9a-f]{6}$/.test(throttles[0]), true);

/* ---- the harness stays out ---- */
store.clear();
await telemetry.onRequestPost({
  request: post("/api/telemetry", { e: "view", p: "/" }, { ua: "HeadlessChrome/145.0.0.0" }), env,
});
check("a headless browser is not counted", rows("tel:"), 0);
const r = await report.onRequestPost({
  request: post("/api/report", { text: "deploy check" }, { ua: "curl/8.7.1" }), env,
});
check("the deploy check files nothing", rows("rep:"), 0);
check("but is still told the endpoint works", r.status, 200);

/* ---- the throttle must not have broken sign-in ----
   Re-keying the counter touched the one code path that lets anybody in, and a
   throttle that locks out the five is worse than the bypass it replaced. */
store.clear();
const CODE = auth.newCode();
store.set("invite:" + CODE, JSON.stringify({ nick: "Xabi", issued: "2026-08-29" }));
let r2 = await auth.onRequestPost({
  request: post("/api/auth", { code: auth.formatCode(CODE).toLowerCase() }), env,
});
check("a valid code signs in, dashed and lower-cased", r2.status, 200);
const cookie = (r2.headers.get("set-cookie") || "").split(";")[0];
const session = await auth.readSession(new Request("https://example.test/", { headers: { cookie } }), env);
check("and the session reads back as the right person", session && session.nick, "Xabi");
check("who owns the place", auth.isAdmin(session), true);

for (let i = 0; i < 11; i++) await auth.onRequestPost({ request: post("/api/auth", { code: "BADCODE" + i }), env });
r2 = await auth.onRequestPost({ request: post("/api/auth", { code: "BADCODEX" }), env });
check("eleven wrong codes buys a rest", r2.status, 429);

console.log(fail ? `\n${fail} FAILED` : "\nall passed");
process.exit(fail ? 1 : 0);
