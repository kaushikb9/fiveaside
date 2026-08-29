/* Five-a-Side — the smallest possible record of who turned up.
   =========================================================================
   One page view per load, one line per chip or fold tapped. That is the
   whole feature. It exists because a site written for five people had no way
   of telling whether any of them came back, and "ask them" stopped being
   funny after the second time.

   WHAT IT DOES NOT DO. No id is minted here, no cookie is set, nothing is
   kept in localStorage, and nothing about the reader is measured or sent.
   The post carries what happened and nothing else — the server works out who
   from the session cookie it already has, and where from Cloudflare's own
   headers. See functions/api/telemetry.js.

   WHY IT IS A SEPARATE FILE AND ONE DELEGATED LISTENER. The rooms do not
   know this exists. app.js, digest.js and faces.js are untouched, so a chip
   added to the locker room next month is tracked with no telemetry code
   written, and deleting this file plus one <script> line removes the feature
   completely. Nothing here can throw into a room's own handlers: it listens
   in the capture phase on document, does no work but a fire-and-forget post,
   and never calls preventDefault.
   ========================================================================= */

(function () {
  "use strict";

  /* The rooms, as the API names them. A path that is not one of these — a
     preview, a stray URL, /usage/ itself — sends nothing at all. */
  var PATHS = ["/", "/gaffers/", "/locker/", "/archive/", "/about/"];

  /* A page load that fired forty events was a stuck handler, not a reader.
     The server has its own limit; this one stops us reaching it. */
  var MAX = 40;
  var sent = 0;

  function path() {
    var p = location.pathname.replace(/index\.html$/, "");
    if (p.length > 1 && p.charAt(p.length - 1) !== "/") p += "/";
    return PATHS.indexOf(p) === -1 ? null : p;
  }

  var HERE = path();
  if (!HERE) return;

  function post(body) {
    if (sent++ >= MAX) return;
    var payload = JSON.stringify(body);
    try {
      // sendBeacon survives the page being closed mid-flight, which a plain
      // fetch does not, and it carries the session cookie same-origin.
      if (navigator.sendBeacon &&
          navigator.sendBeacon("/api/telemetry", new Blob([payload], { type: "application/json" }))) {
        return;
      }
      fetch("/api/telemetry", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: payload,
        keepalive: true,
      }).catch(function () {});
    } catch (e) { /* never the reader's problem */ }
  }

  post({ e: "view", p: HERE });

  /* Coming back from the back button is a visit too, and a bfcache restore
     runs no script otherwise. */
  window.addEventListener("pageshow", function (ev) {
    if (ev.persisted) post({ e: "view", p: HERE });
  });

  /* Everything the reader can choose in a room is a chip or a fold, and both
     carry their own label. Reading the label off the element rather than
     mapping ids here is what keeps this file ignorant of the rooms. */
  document.addEventListener("click", function (ev) {
    var t = ev.target;
    if (!t || !t.closest) return;
    var el = t.closest("button.fc, button.gchip, summary");
    if (!el) return;
    var label = (el.textContent || "").replace(/\s+/g, " ").trim();
    if (!label) return;
    post({ e: "tab", p: HERE, s: label.slice(0, 32) });
  }, true);
})();
