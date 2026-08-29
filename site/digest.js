/* digest.js — how one digest entry is drawn.
   =========================================================================
   Lifted out of app.js when the home page stopped showing the archive: the
   latest entry renders here, and so does every entry on /archive/. One
   renderer, two pages, so an old entry never quietly drifts from a new one.

   Everything in here is pure markup from data. The league table is the one
   exception to "one function, one panel": it is served as a bare body so the
   home page can drop it into a tab alongside the fixtures.
   ========================================================================= */
(function () {
  "use strict";
  const { esc, linkPlayers } = FA;
  const D = (FA.Digest = {});

  D.fmtLong = (iso) => {
    const d = new Date(iso + "T00:00:00");
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString("en-GB", {
      weekday: "long", day: "numeric", month: "long", year: "numeric",
    });
  };
  D.fmtShort = (iso) => {
    const d = new Date(iso + "T00:00:00");
    return isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  };

  const crest = (u) => (u ? '<img class="crest" src="' + esc(u) + '" alt="" loading="lazy">' : "");
  D.crest = crest;

  /* ---------- the league table ----------
     Neutral, by KB's call on 2026-08-27: no allegiance on the front page. It
     was three permanent clubs plus two seeded ones, drawn in bold with a
     paragraph explaining the rule — a table that told you who it was for
     before it told you who was top. Every club is now the same weight, in the
     same font, and the paragraph is gone. `data-club` keeps the FULL name,
     because it is an identity; only the printed name is shortened. */
  /* Takes the TABLE, not the digest that used to carry it. Since 2026-08-27
     the home page's rows come from site/data/table.json, written mechanically
     by brain/split-league.mjs; the archive still passes each entry's own
     historical table, which is the whole reason this takes an argument rather
     than reaching for today's file itself. */
  /* `opts.cut` truncates to the first N rows behind a Show all button, and
     `opts.expanded` says which way that button is currently pointing. Only
     the home page asks for it: a twenty-row table above the fold pushed the
     matches, the week and everything under them off the screen. The archive
     passes nothing and gets the full table, because a historical entry is
     read once, deliberately, and folding it would only add a click. */
  D.tableBody = function (t, opts) {
    if (!t || !t.rows || !t.rows.length) return "";
    const cut = (opts && opts.cut) || 0;
    const expanded = !!(opts && opts.expanded);
    const folded = cut > 0 && t.rows.length > cut && !expanded;
    const rows = t.rows.map((r, i) =>
      "<tr" + (folded && i >= cut ? ' class="tr-hidden"' : "") +
      ' data-club="' + esc(r.team) + '">' +
      '<td class="n">' + esc(r.pos) + "</td>" +
      "<td>" + crest(r.crest) + esc(FA.club(r.team)) + "</td>" +
      '<td class="faint num">' + esc(r.form || "") + "</td>" +
      '<td class="n">' + esc(r.played) + "</td>" +
      '<td class="n"><strong>' + esc(r.points) + "</strong></td></tr>").join("");
    // No table note — retired 2026-08-28; the rows are the reading.
    const table = '<div class="scroll"><table class="sortable"><thead><tr><th class="n">#</th><th>Club</th>' +
      '<th data-nosort>Form</th><th class="n">P</th><th class="n">Pts</th></tr></thead><tbody>' + rows +
      "</tbody></table></div>";
    if (cut <= 0 || t.rows.length <= cut) return table;
    return '<div class="tbl-cut">' + table +
      '<div class="tbl-more-wrap"><button class="tbl-more" data-cut="' + cut +
      '" aria-expanded="' + String(expanded) + '">' +
      (expanded ? "Show top " + cut : "Show all " + t.rows.length) +
      "</button></div></div>";
  };

  /* The cut is by POSITION, not by club, so it has to be re-applied whenever
     the rows move: sorting by Form and leaving the original ten hidden where
     they landed would show a table that is top-ten of nothing. FA.wireSortable
     fires `fa:sorted` for exactly this. */
  D.wireTableCut = function (scope, onToggle) {
    scope.querySelectorAll(".tbl-cut").forEach((box) => {
      const btn = box.querySelector(".tbl-more");
      const body = box.querySelector("table tbody");
      if (!btn || !body) return;
      const cut = Number(btn.dataset.cut) || 10;
      const apply = () => {
        const open = btn.getAttribute("aria-expanded") === "true";
        [...body.rows].forEach((r, i) => r.classList.toggle("tr-hidden", !open && i >= cut));
      };
      btn.addEventListener("click", () => {
        const open = btn.getAttribute("aria-expanded") !== "true";
        btn.setAttribute("aria-expanded", String(open));
        btn.textContent = open ? "Show top " + cut : "Show all " + body.rows.length;
        apply();
        if (onToggle) onToggle(open);
      });
      box.addEventListener("fa:sorted", apply);
    });
  };

  D.tableHTML = function (d) {
    const body = D.tableBody(d.table);
    if (!body) return "";
    return '<div class="panel"><h3>' + esc(d.table.competition) + "</h3>" + body + "</div>";
  };

  /* ---------- the week: the primary feed ----------
     Around the top and Elsewhere are secondary by design. A story that leads
     here does not reappear below. */
  const FEED_PREVIEW_WORDS = 42;
  const words = (text) => text.trim().split(/\s+/).filter(Boolean);
  const preview = (text) => {
    const all = words(text);
    if (all.length <= FEED_PREVIEW_WORDS) return null;
    const firstSentence = text.match(/^(.+?[.!?])(?:\s|$)/)?.[1];
    if (firstSentence && words(firstSentence).length <= 60) return firstSentence;
    return all.slice(0, FEED_PREVIEW_WORDS).join(" ") + "…";
  };

  D.weekHTML = function (d, opts) {
    if (!d.week || !d.week.length) return "";
    const compact = !!(opts && opts.compact);
    /* Three chips and no more. A club chip per club mentioned that week made
       the bar as long as the feed and different every day, which is not a
       control so much as a second index. What it filters is the KIND of
       story — league or FPL — which is the only cut that means the same
       thing every week. */
    const bar = d.week.some((w) => w.tag)
      ? '<div class="filters" role="group" aria-label="Filter the week">' +
        '<button class="fc" data-filter="all" aria-pressed="true">All</button>' +
        '<button class="fc" data-filter="Football" aria-pressed="false">Football</button>' +
        '<button class="fc" data-filter="FPL" aria-pressed="false">FPL</button>' +
        "</div>"
      : "";
    const items = d.week.map((w) => {
      // `PL` is the legacy name for the football feed. Keep accepting it in
      // historical digests, but never expose it as if it meant Premier League:
      // the current feed also contains European football.
      const kind = w.tag === "FPL" ? "FPL" : "Football";
      const short = compact ? preview(w.text) : null;
      const body = short
        ? linkPlayers(short) +
          '<details class="feed-more"><summary>read full note</summary><div class="feed-full">' +
          linkPlayers(w.text) + "</div></details>"
        : linkPlayers(w.text);
      return '<li data-tag="' + kind + '" data-club="' + esc(w.club || "") + '">' +
        '<span class="wtag ' + (kind === "FPL" ? "fpl" : "") + '">' + esc(kind) + "</span>" +
        "<strong>" + esc(w.kicker) + "</strong> " + body +
        (w.club ? '<span class="clubchip">' + esc(FA.club(w.club)) + "</span>" : "") + "</li>";
    }).join("");
    return '<div class="panel"><h3>This week</h3>' +
      bar + '<ul class="feed">' + items + "</ul></div>";
  };

  D.aroundHTML = function (d, gw) {
    const focus = FA.focusClubs(gw, (d.table && d.table.rows) || []);
    const all = d.top_teams || d.rivals || [];
    const shown = all.filter((r) => focus.indexOf(r.club) !== -1);
    const dropped = all.filter((r) => focus.indexOf(r.club) === -1).map((r) => r.club);
    /* The rank-and-points line rides with the club name, not in a side column.
       As a `.row-side` it was `white-space: nowrap`, so inside a half-width
       grid track it took 108px off the note and cost 40px of height on every
       row — 149px against Elsewhere's 109px for the same component, purely
       because Elsewhere's rows carry no line. */
    const one = (r) =>
      '<div class="row"><div class="row-main"><div class="row-name">' +
      crest(r.crest) + esc(FA.club(r.club)) +
      (r.line ? '<span class="row-meta">' + esc(r.line) + "</span>" : "") + "</div>" +
      '<div class="row-sub">' + linkPlayers(r.note) + "</div></div></div>";

    const left = shown.length
      ? '<div class="panel"><h3>Around the top</h3>' +
        '<div class="rows">' + shown.map(one).join("") + "</div>" +
        (dropped.length
          ? '<p class="note" style="margin:12px 0 0">Not covered this week: ' +
            dropped.map((c) => esc(FA.club(c))).join(", ") + ".</p>"
          : "") + "</div>"
      : "";

    const rest = (d.elsewhere || []).map(one).join("");
    const right = rest
      ? '<div class="panel"><h3>Elsewhere</h3>' +
        '<div class="rows">' + rest + "</div></div>"
      : "";
    if (!left && !right) return "";
    return '<div class="grid2">' + left + right + "</div>";
  };

  const HEAT = { done: "done", "here we go": "done", close: "close", talks: "talks", smoke: "smoke" };
  D.rumoursHTML = function (d) {
    if (!d.rumours || !d.rumours.length) return "";
    return '<div class="panel"><h3>Rumour mill</h3><div class="rows">' +
      d.rumours.map((r) =>
        '<div class="row"><div class="row-main"><div class="row-name">' + linkPlayers(r.player) + "</div>" +
        '<div class="row-sub">' + esc(FA.club(r.from)) + " &rarr; " + esc(FA.club(r.to)) +
        (r.fee ? " &middot; " + esc(r.fee) : "") + " &middot; " + esc(r.note) + "</div></div>" +
        '<div class="row-side"><span class="heat ' + (HEAT[r.heat] || "smoke") + '">' +
        esc(r.heat) + "</span></div></div>").join("") +
      "</div></div>";
  };

  /* Deterministic colour for a link with no image, so the grid never has a
     hole in it and never fetches something that might not exist. */
  const THUMB = ["#ff5722", "#052962", "#1e7d4c", "#7b3fa0", "#b8860b", "#345995"];
  function hash(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h;
  }
  function linkCard(item) {
    const thumb = item.image
      ? '<div class="lthumb" style="background-image:url(' + esc(item.image) + ')"></div>'
      : '<div class="lthumb" style="background:' + THUMB[hash(item.title) % THUMB.length] +
        '"><span class="letter">' + esc((item.source || item.title).charAt(0)) + "</span></div>";
    return '<a class="lcard" href="' + esc(item.url) + '" target="_blank" rel="noopener">' + thumb +
      '<div class="lbody"><div class="lt">' + esc(item.title) + "</div>" +
      '<div class="lh">' + esc(item.hook) + "</div>" +
      (item.source ? '<div class="ls">' + esc(item.source) + "</div>" : "") + "</div></a>";
  }

  D.linksHTML = function (d) {
    const items = [];
    if (d.read) items.push(d.read);
    (d.wider || []).forEach((w) => items.push(w));
    if (!items.length) return "";
    return '<div class="panel"><h3>Worth the click</h3>' +
      '<div class="cards">' + items.map(linkCard).join("") + "</div></div>";
  };

  /* The whole entry, table included. The home page passes withTable:false
     because its table lives in the match-week tabs instead. */
  D.entryHTML = function (d, gw, opts) {
    const withTable = !opts || opts.withTable !== false;
    return '<div class="eyebrow">' + esc(D.fmtLong(d.date)) + "</div>" +
      '<h2 class="digest-headline" style="font-size:clamp(21px,3.4vw,30px);margin:6px 0 18px">' +
      esc(d.headline) + "</h2>" +
      (withTable ? D.tableHTML(d) : "") +
      D.weekHTML(d) + D.aroundHTML(d, gw) +
      D.rumoursHTML(d) + D.linksHTML(d);
  };

  /* Narrows the feed by tag. It used to dim the league table as well, but
     that only ever fired for a club chip, and the club chips are gone —
     dimming half a neutral table on "FPL" would mean nothing. */
  D.wireFilter = function (scope) {
    // Find the bar by what is IN it, not by its class: the league panel's tab
    // strip reuses .filters for its chips, and grabbing the first one on the
    // page wired the listener to the tabs and silently killed the dimming.
    const first = scope.querySelector(".filters .fc[data-filter]");
    const bar = first && first.closest(".filters");
    if (!bar) return;
    bar.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-filter]");
      if (!btn) return;
      bar.querySelectorAll(".fc").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
      const f = btn.dataset.filter;
      scope.querySelectorAll("ul.feed > li").forEach((li) => {
        li.hidden = !(f === "all" || li.dataset.tag === f);
      });
    });
  };
})();
