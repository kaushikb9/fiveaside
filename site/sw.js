/* Five-a-Side, offline-ish.
   =========================================================================
   The job here is modest on purpose: make the site installable and make it
   open when the tube has no signal. It is NOT trying to be an offline app.

   A service worker on a site that deploys several times a day is the classic
   way to serve a week-old page to somebody who is looking at it right now, so
   the caching rules are decided by what CAN safely go stale:

     /api/*        never cached. Live scores and sessions are the whole point
                   of being live, and a cached 401 would lock somebody out of
                   their own room.
     *?v=<hash>    cache-first, because deploy.sh stamps a content hash into
                   every asset URL. A changed file is a changed URL, so a hit
                   here is always the right bytes.
     /data/*.json  network-first, cache as a fallback. Yesterday's table beats
                   a blank page, and never beats today's.
     HTML          network-first, cache as a fallback, for the same reason.

   To switch it off: ship a sw.js whose install handler calls
   self.registration.unregister(). Bumping VERSION only clears the cache.
   ========================================================================= */

const VERSION = "fas-v1";
const SHELL = ["/", "/gaffers/", "/locker/", "/about/", "/archive/"];

self.addEventListener("install", (event) => {
  // Take the shell in so a first offline open has something to show. A failure
  // here must not block installation — being installable matters more than
  // being pre-warmed.
  event.waitUntil(
    caches.open(VERSION).then((c) => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const isHashed = (url) => url.searchParams.has("v");
const isData = (url) => url.pathname.startsWith("/data/");
const isApi = (url) => url.pathname.startsWith("/api/");

async function cacheFirst(request) {
  const hit = await caches.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res && res.ok) {
    const copy = res.clone();
    caches.open(VERSION).then((c) => c.put(request, copy)).catch(() => {});
  }
  return res;
}

async function networkFirst(request) {
  try {
    const res = await fetch(request);
    if (res && res.ok) {
      const copy = res.clone();
      caches.open(VERSION).then((c) => c.put(request, copy)).catch(() => {});
    }
    return res;
  } catch (err) {
    const hit = await caches.match(request);
    if (hit) return hit;
    // A navigation with nothing cached still has to render something.
    if (request.mode === "navigate") {
      const shell = await caches.match("/");
      if (shell) return shell;
    }
    throw err;
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  // Somebody else's server is not ours to cache — crests, article images.
  if (url.origin !== self.location.origin) return;
  if (isApi(url)) return;

  if (isHashed(url)) return event.respondWith(cacheFirst(request));
  if (isData(url) || request.mode === "navigate") {
    return event.respondWith(networkFirst(request));
  }
  // Icons, the manifest, the bare SVG: safe to serve fast, refreshed behind.
  event.respondWith(cacheFirst(request));
});
