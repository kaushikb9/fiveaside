/* usage — who's been in.
   =========================================================================
   The fourth page, and the only one that is not a room: nothing links here,
   and it is empty for everyone but KB, whose invite code doubles as the admin
   key. /api/telemetry answers 404 to anybody else, so this page cannot show
   anything it was not given.

   The aggregation lives here rather than in the Function on purpose. The
   server's job is to remember; deciding that "the five, and everyone else" is
   the interesting cut — and changing that decision next week — is a page
   concern, and a page can be reloaded without a deploy of anything else.

   What it counts, in one line each:
     the strip   visits and heads today, and how long since the last one
     the five    one row per gaffer whether or not they have ever been in.
                 An absence is the most useful thing on this page.
     opened      rooms by visit, then the chips and folds actually tapped
     the last    fifty events, plainly, because a total hides the story of a
                 Saturday evening and a list does not
   ========================================================================= */
(function () {
  "use strict";
  const { esc, $ } = FA;

  const RANGES = [
    { d: 1, label: "24 hours" },
    { d: 7, label: "7 days" },
    { d: 30, label: "30 days" },
    { d: 90, label: "90 days" },
  ];
  let range = 7;

  /* The API stores paths because a path cannot drift; the page says the
     rooms' names because KB does not think in URLs. */
  const ROOM = {
    "/": "touchline",
    "/gaffers/": "the gaffers",
    "/locker/": "the locker room",
    "/archive/": "the archive",
    "/about/": "about",
  };
  const room = (p) => ROOM[p] || p;

  /* ---------------- small helps ---------------- */

  function ago(iso) {
    const ms = Date.now() - Date.parse(iso);
    if (!isFinite(ms)) return "";
    const m = Math.round(ms / 60000);
    if (m < 1) return "just now";
    if (m < 60) return m + "m ago";
    const h = Math.round(m / 60);
    if (h < 24) return h + "h ago";
    const d = Math.round(h / 24);
    return d + "d ago";
  }

  const clock = (iso) => {
    const d = new Date(iso);
    return isNaN(d.getTime()) ? "" :
      d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  };

  const dayName = (iso) => {
    const d = new Date(iso);
    return isNaN(d.getTime()) ? "" :
      d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  };

  /* City and country arrive separately and either can be missing — a VPN, a
     desktop on a corporate range. "Bengaluru, IN" or "IN" or nothing, never
     "undefined, IN". */
  function place(ev) {
    const bits = [];
    if (ev.y) bits.push(ev.y);
    if (ev.c) bits.push(ev.c);
    return bits.join(", ");
  }

  const top = (counts) =>
    Object.keys(counts).sort((a, b) => counts[b] - counts[a]);

  /* ---------------- the door ----------------
     Deliberately less than the gaffers' door says. That one is a locked room
     five people know about; this one should not confirm there is anything
     behind it at all. */
  function doorHTML(state) {
    const say = {
      denied: '<p class="door-note" style="color:var(--hot)">No.</p>',
      throttled: '<p class="door-note" style="color:var(--hot)">That’s enough guesses ' +
        "for one go. Ten minutes, then come back.</p>",
      error: '<p class="door-note" style="color:var(--hot)">That didn’t go through. ' +
        "Give it another go.</p>",
    }[state] || "";

    return '<section class="section"><div class="section-head"><h2>usage</h2></div>' +
      '<div class="door">' +
      '<div class="door-k">Staff only</div>' +
      (FA.faceSVG ? '<span class="facewrap door-ted">' + FA.faceSVG(FA.COACH) + "</span>" : "") +
      "<h3>Not this door.</h3>" +
      '<p class="door-p">Nothing through here for you — and if you’re reading a room ' +
      "instead, that’s the one you want. Go on.</p>" +
      say +
      '<div class="door-cta"><form id="codeform" class="codeform" autocomplete="off">' +
      '<label class="vh" for="code">Code</label>' +
      '<input id="code" name="code" type="text" inputmode="latin" autocapitalize="characters" ' +
      'spellcheck="false" maxlength="19" placeholder="XXXX-XXXX-XXXX">' +
      '<button type="submit">Enter</button></form></div>' +
      "</div></section>";
  }

  const groupCode = (v) =>
    (String(v).toUpperCase().replace(/[^0-9A-Z]/g, "").slice(0, 16).match(/.{1,4}/g) || []).join("-");

  function renderDoor(state) {
    $("#main").innerHTML = doorHTML(state);
    const form = document.getElementById("codeform");
    const input = document.getElementById("code");
    input.addEventListener("input", () => {
      const at = input.selectionStart === input.value.length;
      input.value = groupCode(input.value);
      if (at) input.setSelectionRange(input.value.length, input.value.length);
    });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const clean = input.value.replace(/[^0-9A-Za-z]/g, "");
      if (!clean) return;
      const btn = form.querySelector("button");
      btn.disabled = true; btn.textContent = "Checking…";
      try {
        const r = await fetch("/api/auth", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ code: clean }),
        });
        if (r.status === 429) return renderDoor("throttled");
        if (!r.ok) return renderDoor("denied");
        main();
      } catch (err) {
        renderDoor("error");
      }
    });
    input.focus();
  }

  /* ---------------- the numbers ----------------
     One pass over the events; every panel reads off the same summary, so the
     strip and the rows can never disagree with each other. */
  function summarise(events) {
    const s = {
      views: 0,
      todayViews: 0,
      todayHeads: {},
      last: null,
      byNick: {},
      strangers: {},
      rooms: {},
      sections: {},
    };
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);

    events.forEach((ev) => {
      if (!s.last || Date.parse(ev.t) > Date.parse(s.last)) s.last = ev.t;
      const who = ev.w || null;
      const today = Date.parse(ev.t) >= midnight.getTime();

      if (ev.e === "view") {
        s.views++;
        s.rooms[ev.p] = (s.rooms[ev.p] || 0) + 1;
        if (today) {
          s.todayViews++;
          s.todayHeads[who || ("?" + (ev.v || "x"))] = true;
        }
      } else if (ev.e === "tab" && ev.s) {
        const k = ev.s + "\t" + ev.p;
        s.sections[k] = (s.sections[k] || 0) + 1;
      }

      if (who) {
        const g = s.byNick[who] || (s.byNick[who] = {
          views: 0, taps: 0, last: null, rooms: {}, place: "", device: "",
        });
        if (ev.e === "view") g.views++; else g.taps++;
        if (!g.last || Date.parse(ev.t) > Date.parse(g.last)) {
          g.last = ev.t;
          g.place = place(ev);   // where they were the LAST time, not an average
          g.device = ev.d || "";
        }
        if (ev.e === "view") g.rooms[ev.p] = (g.rooms[ev.p] || 0) + 1;
      } else if (ev.v) {
        const v = s.strangers[ev.v] || (s.strangers[ev.v] = { views: 0, place: "", device: "", last: null });
        if (ev.e === "view") v.views++;
        if (!v.last || Date.parse(ev.t) > Date.parse(v.last)) {
          v.last = ev.t; v.place = place(ev); v.device = ev.d || "";
        }
      }
    });
    return s;
  }

  /* ---------------- panels ---------------- */

  function stripHTML(s) {
    const heads = Object.keys(s.todayHeads).length;
    const inToday = Object.keys(s.todayHeads).filter((k) => k.charAt(0) !== "?").length;
    return '<div class="panel ustrip">' +
      '<div class="ustat"><b class="num">' + s.todayViews + "</b><span>visits today</span></div>" +
      '<div class="ustat"><b class="num">' + inToday + " of 5</b><span>the five, today</span></div>" +
      '<div class="ustat"><b class="num">' + (heads - inToday) + "</b><span>strangers today</span></div>" +
      '<div class="ustat"><b class="num">' + (s.last ? esc(ago(s.last)) : "—") +
        "</b><span>last seen</span></div>" +
      "</div>";
  }

  function fiveHTML(s) {
    const rows = FA.NICKS.map((n) => {
      const g = s.byNick[n];
      const face = FA.faceSVG ? '<span class="facewrap ucap">' + FA.faceSVG(n) + "</span>" : "";
      if (!g) {
        return '<div class="row urow"><div class="ucapwrap">' + face + "</div>" +
          '<div class="row-main"><div class="row-name">' + esc(n) + "</div>" +
          '<div class="row-sub faint">Not in at all.</div></div>' +
          '<div class="row-side">—</div></div>';
      }
      const favourite = top(g.rooms)[0];
      const sub = [
        g.place || "somewhere",
        g.device,
        favourite ? "mostly " + room(favourite) : "",
      ].filter(Boolean).join(" · ");
      return '<div class="row urow"><div class="ucapwrap">' + face + "</div>" +
        '<div class="row-main"><div class="row-name">' + esc(n) +
          '<span class="row-meta">' + g.views + " visits, " + g.taps + " taps</span></div>" +
        '<div class="row-sub">' + esc(sub) + "</div></div>" +
        '<div class="row-side">' + esc(ago(g.last)) + "</div></div>";
    }).join("");

    const ids = Object.keys(s.strangers);
    let strangers = '<p class="note" style="margin-top:12px">Nobody else came by.</p>';
    if (ids.length) {
      const views = ids.reduce((a, k) => a + s.strangers[k].views, 0);
      const where = [...new Set(ids.map((k) => s.strangers[k].place).filter(Boolean))].slice(0, 4);
      strangers = '<div class="row urow"><div class="ucapwrap"><span class="uanon">?</span></div>' +
        '<div class="row-main"><div class="row-name">' + ids.length +
          (ids.length === 1 ? " stranger" : " strangers") +
          '<span class="row-meta">' + views + " visits</span></div>" +
        '<div class="row-sub">' + (where.length ? esc(where.join(" · ")) : "no location given") +
        "</div></div><div class=\"row-side\"></div></div>";
    }

    return '<div class="panel"><h3>The five</h3>' +
      '<p class="note">Counted by their invite code, so the same person on a phone and a ' +
      "laptop is one gaffer. Where and what they read on is from the last time they were in.</p>" +
      '<div class="rows">' + rows + "</div>" +
      '<h3 style="margin-top:16px">Everyone else</h3>' +
      '<p class="note">A stranger is counted once a day and then forgotten — no address is ' +
      "kept, here or in the store.</p>" +
      (ids.length ? '<div class="rows">' + strangers + "</div>" : strangers) +
      "</div>";
  }

  function bar(label, n, max, kind) {
    const pct = max ? Math.max(2, Math.round((n / max) * 100)) : 0;
    return '<div class="ubar' + (kind === "sub" ? " ubar-sub" : "") + '">' +
      '<div class="ubar-top"><span class="ubar-l">' + esc(label) + "</span>" +
      '<span class="ubar-n num">' + n + "</span></div>" +
      '<span class="ubar-t"><i style="width:' + pct + '%"></i></span></div>';
  }

  function openedHTML(s) {
    const rooms = top(s.rooms);
    const maxRoom = rooms.length ? s.rooms[rooms[0]] : 0;
    const roomBars = rooms.map((p) => bar(room(p), s.rooms[p], maxRoom)).join("") ||
      '<p class="note">No visits in this stretch.</p>';

    const secs = top(s.sections).slice(0, 10);
    const maxSec = secs.length ? s.sections[secs[0]] : 0;
    const secBars = secs.map((k) => {
      const [label, p] = k.split("\t");
      return bar(label + "  ·  " + room(p), s.sections[k], maxSec, "sub");
    }).join("") || '<p class="note">Nothing tapped — just pages opened.</p>';

    return '<div class="panel"><h3>What they opened</h3>' +
      '<p class="note">Rooms first, then the chips and folds actually tapped inside them.</p>' +
      roomBars +
      '<div class="usubhead">Tapped</div>' + secBars +
      "</div>";
  }

  function timelineHTML(events) {
    /* Fifty events can reach back three days, and a column of bare clock
       times says they all happened this evening. The date goes in as a
       divider the moment it changes, so 22:29 is never read as tonight. */
    let day = "";
    const rows = events.slice(0, 50).map((ev) => {
      const d = dayName(ev.t);
      const head = d === day ? "" :
        '<tr class="uday"><td colspan="5">' + esc(d) + "</td></tr>";
      day = d;
      const what = ev.e === "view" ? room(ev.p) : ev.s;
      return head +
        '<tr><td class="faint num utime">' + esc(clock(ev.t)) + "</td>" +
        "<td>" + esc(ev.w || "stranger" + (ev.v ? " " + ev.v : "")) + "</td>" +
        '<td class="faint">' + (ev.e === "view" ? "opened" : "tapped") + "</td>" +
        "<td>" + esc(what || "") + (ev.e === "tab" ?
          ' <span class="faint">in ' + esc(room(ev.p)) + "</span>" : "") + "</td>" +
        '<td class="faint">' + esc([place(ev), ev.d].filter(Boolean).join(" · ")) + "</td></tr>";
    }).join("");

    return '<div class="panel"><h3>The last fifty</h3>' +
      '<p class="note">Newest first. Times are yours, not theirs.</p>' +
      (rows ? '<div class="scroll"><table class="utable"><tbody>' + rows + "</tbody></table></div>" :
        '<p class="empty">Nothing yet.</p>') +
      "</div>";
  }

  function render(payload) {
    const events = payload.events || [];
    const s = summarise(events);
    const tabs = RANGES.map((r) =>
      '<button class="fc" data-range="' + r.d + '" aria-pressed="' + (r.d === range) + '">' +
      r.label + "</button>").join("");

    $("#main").innerHTML =
      '<section class="section"><div class="section-head"><h2>usage</h2>' +
      '<span class="mute" style="font-size:13px">who’s been in</span>' +
      '<span class="tag ghost" style="margin-left:auto">unlisted</span></div>' +
      '<div class="filters" role="group" aria-label="How far back">' +
      '<span class="flabel">Last</span>' + tabs + "</div>" +
      stripHTML(s) +
      '<div class="grid2">' + fiveHTML(s) + openedHTML(s) + "</div>" +
      timelineHTML(events) +
      (payload.truncated ?
        '<p class="note">More than six thousand events in this stretch; the oldest are not ' +
        "counted above.</p>" : "") +
      "</section>";

    $("#main").querySelector(".filters").addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-range]");
      if (!btn) return;
      range = Number(btn.dataset.range);
      main();
    });

    if (s.last) FA.stamp(s.last, "last event");
  }

  /* ---------------- the door, or the page ---------------- */

  async function main() {
    let r;
    try {
      r = await fetch("/api/telemetry?days=" + range, { cache: "no-store" });
    } catch (e) {
      return FA.fail($("#main"), "Could not reach the store.");
    }
    // 404 is the honest answer for both "not signed in" and "signed in, but
    // not KB". The page cannot tell them apart either, and should not.
    if (!r.ok) return renderDoor();
    render(await r.json());
  }

  FA.initTheme();
  main();
})();
