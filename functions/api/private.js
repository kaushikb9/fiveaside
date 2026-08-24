/* /api/private — the gaffers room's data, behind the session.
   =========================================================================
   This is what stops the login wall being theatre. The five's squads, picks
   and weekly reads are NOT published as static files; deploy.sh pushes them
   into KV and this route is the only way to read them back, and only with a
   valid session cookie.

   Public and staying public, because they are league-wide reference rather
   than anyone's business: players.json, digests.json, and everything in
   fpl.json except `people`.

   Worth restating: none of this is confidential — the FPL API will hand the
   same squads to anyone with an entry id. The point is that the five's page
   is not open to the web, not that the data is unobtainable.
   ========================================================================= */

import { readSession } from "./auth.js";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

export async function onRequestGet({ request, env }) {
  if (!env.SESSION_SECRET) return json({ error: "auth not configured" }, 503);
  if (!env.STARS) return json({ error: "store not bound" }, 503);

  const session = await readSession(request, env.SESSION_SECRET);
  if (!session) return json({ error: "not signed in" }, 401);

  // Both blobs live in the same namespace as the stars — one binding is
  // plenty for five people and it keeps wrangler.toml honest.
  const [gaffers, people] = await Promise.all([
    env.STARS.get("private:gaffers"),
    env.STARS.get("private:people"),
  ]);

  if (!gaffers) {
    return json({ error: "no data published yet", detail: "run ./deploy.sh" }, 503);
  }

  return json({
    session,
    gaffers: JSON.parse(gaffers),
    people: people ? JSON.parse(people) : [],
  });
}
