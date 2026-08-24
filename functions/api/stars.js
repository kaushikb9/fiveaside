/* /api/stars — the watchlist star, shared across devices.
   =========================================================================
   KB's call: watchlists are per person and stored server-side keyed by
   gaffer, so a star set on a phone is there on the laptop and the house list
   is the same for everyone. localStorage cannot do either.

   Shape in KV: one key per gaffer, holding a JSON array of element ids.
   GET  -> { "Xabi": [411, 426], "The Special One": [...] }
   POST { gaffer, player, on } -> the updated array for that gaffer.

   No auth, by design and by scope: this is five friends and a list of
   footballers. The worst case is someone stars Haaland for you. What it must
   NOT do is accept unbounded input, so the gaffer must be one of the five and
   the player id must be a plausible element id.
   ========================================================================= */

const GAFFERS = ["Xabi", "Sir Fergie", "Mr CR7", "The Special One", "Le Professeur"];
const MAX_STARS = 60;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

async function readAll(kv) {
  const out = {};
  for (const g of GAFFERS) {
    const raw = await kv.get("stars:" + g);
    let list = [];
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) list = parsed.filter((n) => Number.isInteger(n));
      } catch (e) {
        // A corrupt value is not worth a 500 to five friends: treat it as empty
        // and let the next write heal it.
      }
    }
    out[g] = list;
  }
  return out;
}

export async function onRequestGet({ env }) {
  if (!env.STARS) return json({ error: "stars store not bound" }, 503);
  return json(await readAll(env.STARS));
}

export async function onRequestPost({ request, env }) {
  if (!env.STARS) return json({ error: "stars store not bound" }, 503);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: "body must be JSON" }, 400);
  }

  const gaffer = body && body.gaffer;
  const player = body && body.player;
  const on = !!(body && body.on);

  if (GAFFERS.indexOf(gaffer) === -1) return json({ error: "unknown gaffer" }, 400);
  if (!Number.isInteger(player) || player < 1 || player > 100000) {
    return json({ error: "player must be an element id" }, 400);
  }

  const key = "stars:" + gaffer;
  const raw = await env.STARS.get(key);
  let list = [];
  try {
    const parsed = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) list = parsed.filter((n) => Number.isInteger(n));
  } catch (e) { list = []; }

  const i = list.indexOf(player);
  if (on && i === -1) list.push(player);
  if (!on && i !== -1) list.splice(i, 1);
  if (list.length > MAX_STARS) list = list.slice(-MAX_STARS);

  await env.STARS.put(key, JSON.stringify(list));
  return json({ gaffer, stars: list });
}
