/* Five-a-Side — shared behaviour for all three rooms.
   =========================================================================
   Loaded by every page before its own app.js. Exposes one global, `FA`.

   The rule this file exists to enforce: the three rooms are one product, so
   the theme, the nicknames, the kits and above all the PLAYER CARD behave
   identically wherever you are. A player name in touchline and the same name
   in the gaffers room must open the same card, or they are just three pages
   that happen to share a stylesheet.
   ========================================================================= */
(function () {
  "use strict";

  const FA = {};

  /* ---------------- basics ---------------- */
  FA.esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const esc = FA.esc;

  FA.$ = (sel) => document.querySelector(sel);

  FA.loadJSON = async function (path) {
    const res = await fetch(path, { cache: "no-cache" });
    if (!res.ok) throw new Error(path + ": HTTP " + res.status);
    return res.json();
  };

  /* ---------------- theme: auto / light / dark ----------------
     "auto" removes the attribute entirely and lets prefers-color-scheme
     decide — it is a preference, not a third palette. */
  const TKEY = "fiveaside-theme";
  FA.setTheme = function (t) {
    if (t === "auto") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = t;
    try { localStorage.setItem(TKEY, t); } catch (e) { /* private mode */ }
    document.querySelectorAll("#themectl button").forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.t === t)));
  };

  FA.initTheme = function () {
    const ctl = document.getElementById("themectl");
    if (ctl) {
      ctl.addEventListener("click", (e) => {
        const b = e.target.closest("button[data-t]");
        if (b) FA.setTheme(b.dataset.t);
      });
    }
    let saved = "auto";
    try { saved = localStorage.getItem(TKEY) || "auto"; } catch (e) { /* ignore */ }
    FA.setTheme(saved);
  };

  /* ---------------- the five ----------------
     Nicknames only, ever. The FPL API hands back real names and they are
     dropped at the facts layer; nothing here should ever reintroduce one. */
  FA.NICKS = ["Xabi", "Sir Fergie", "Mr CR7", "The Special One", "Le Professeur"];
  FA.ME = "Xabi";
  /* Owner dots are one or two characters, so multi-word nicknames need a
     chosen abbreviation — "Sir Fergie" and "The Special One" would otherwise
     both collapse to "S". */
  FA.INITIALS = {
    "Xabi": "X",
    "Sir Fergie": "SF",
    "Mr CR7": "C7",
    "The Special One": "SO",
    "Le Professeur": "LP",
  };
  FA.initial = (n) => FA.INITIALS[n] || n.charAt(0);

  /* Mark gaffer nicknames in prose, longest first so "The Special One" is
     never half-matched.

     The previous single-word nicknames needed a guard against "Enzo Maresca"
     — a nickname followed by a capitalised word was a real person rather than
     one of us. These nicknames are themselves multi-word, so that guard would
     now reject every one of them; it is gone. The names are distinctive, and
     gname is only ever applied inside the gaffers room. */
  const NICK_RE = new RegExp(
    "(" + FA.NICKS.slice().sort((a, b) => b.length - a.length)
      .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")",
    "g"
  );
  FA.gname = (t) => esc(t).replace(NICK_RE, '<span class="gname">$1</span>');

  FA.ownerDots = function (by, me) {
    if (!by || !by.length) return "";
    return '<span class="owners">' + by.map((n) =>
      '<span class="own' + (n === me ? " mine" : "") + '" title="' + esc(n) + '">' +
      esc(FA.initial(n)) + "</span>").join("") + "</span>";
  };

  /* ---------------- verdicts ---------------- */
  FA.vdChip = function (v) {
    if (!v) return "";
    const arrow = v.moved === "up" ? "&#9650;" : v.moved === "down" ? "&#9660;" : v.moved === "new" ? "new" : "";
    return '<span class="vd vd-' + esc(v.verdict) + '">' + esc(v.verdict) + "</span>" +
      (arrow ? '<span class="mv ' + esc(v.moved) + '">' + arrow + "</span>" : "");
  };

  /* ---------------- fixture difficulty ---------------- */
  FA.fdrStrip = function (fixtures) {
    if (!fixtures || !fixtures.length) return "";
    return '<span class="fdr">' + fixtures.map((f) =>
      '<i data-f="' + f.fdr + '" title="GW' + f.gw + " " + (f.home ? "vs" : "at") + " " +
      esc(f.opp) + " &middot; difficulty " + f.fdr + '">' + esc(f.opp) + "</i>").join("") + "</span>";
  };

  /* Form behind the fixtures. Trims to what has been played, so gameweek one
     shows one match and the clubs yet to start show none — which is the
     honest answer, not an empty state to apologise for. */
  FA.formRun = function (recent) {
    if (!recent || !recent.length) {
      return '<span class="faint" style="font-size:13px">No league matches played yet.</span>';
    }
    return '<span class="frun">' + recent.map((r) =>
      '<i data-r="' + esc(r.result) + '" title="GW' + r.gw + " " + (r.home ? "vs " : "away to ") +
      esc(r.opp) + " &middot; " + r.gf + "-" + r.ga + '">' +
      '<b>' + esc(r.result) + "</b>" + r.gf + "&ndash;" + r.ga +
      '<em>' + (r.home ? "" : "@") + esc(r.opp) + "</em></i>").join("") + "</span>";
  };

  FA.fdrKey = '<div class="fdr-key">' +
    '<span><span class="sw" style="background:var(--fdr1)"></span>1 kind</span>' +
    '<span><span class="sw" style="background:var(--fdr2)"></span>2</span>' +
    '<span><span class="sw" style="background:var(--fdr3)"></span>3</span>' +
    '<span><span class="sw" style="background:var(--fdr4)"></span>4</span>' +
    '<span><span class="sw" style="background:var(--fdr5)"></span>5 brutal</span></div>';

  /* ---------------- club kits ----------------
     [body, sleeve, detail]. Drawn, never fetched: no external images, works
     offline, and one shape tints for every club. */
  const KITS = {
    ARS: ["#EF0107", "#FFFFFF", "plain"], AVL: ["#670E36", "#95BFE5", "plain"],
    BHA: ["#0057B8", "#FFFFFF", "stripe"], BOU: ["#DA291C", "#000000", "stripe"],
    BRE: ["#E30613", "#FFFFFF", "stripe"], CHE: ["#034694", "#034694", "plain"],
    COV: ["#78D0F3", "#FFFFFF", "plain"], CRY: ["#1B458F", "#C4122E", "stripe"],
    EVE: ["#003399", "#FFFFFF", "plain"], FUL: ["#FFFFFF", "#000000", "plain"],
    HUL: ["#F5A12D", "#000000", "stripe"], IPS: ["#3A64A3", "#FFFFFF", "plain"],
    LEE: ["#FFFFFF", "#1D428A", "plain"], LIV: ["#C8102E", "#C8102E", "plain"],
    MCI: ["#6CABDD", "#FFFFFF", "plain"], MUN: ["#DA291C", "#000000", "plain"],
    NEW: ["#241F20", "#FFFFFF", "stripe"], NFO: ["#DD0000", "#FFFFFF", "plain"],
    SUN: ["#EB172B", "#FFFFFF", "stripe"], TOT: ["#FFFFFF", "#132257", "plain"],
  };
  const GK_KIT = ["#2FBF71", "#116B3C", "plain"];

  FA.kitSVG = function (team, isGK) {
    const kit = (isGK ? GK_KIT : KITS[team]) || ["#8A9295", "#5F6A6E", "plain"];
    const body = kit[0], sleeve = kit[1], detail = kit[2];

    // One closed path for the whole garment. The previous version drew the
    // sleeves as separate wedges nearly as wide as the torso, sticking out
    // sideways — at 46px that reads as a paper aeroplane, not a shirt. Here
    // the torso is the widest thing (24 of 44 units) and the sleeves hang
    // DOWN from the shoulder rather than out from it.
    const shirt =
      "M22 9 L26 6 a6 5 0 0 0 12 0 L42 9 " +   // shoulders, with a collar scoop
      "L53 16 L48 28 L44 25.5 " +               // right sleeve: out, down, back in
      "L44 57 L20 57 L20 25.5 " +               // torso
      "L16 28 L11 16 Z";                        // left sleeve

    // Stripes live inside the torso only, clipped so they never bleed onto a
    // sleeve — that was the other thing making the old mark look wrong.
    const cid = "t" + (isGK ? "gk" : team);
    const stripes = detail === "stripe"
      ? '<clipPath id="' + cid + '"><path d="M20 9 h24 v48 h-24 Z"/></clipPath>' +
        '<g clip-path="url(#' + cid + ')">' +
        [25, 34].map((x) =>
          '<rect x="' + x + '" y="6" width="5" height="52" fill="' + sleeve + '" opacity=".95"/>').join("") +
        "</g>"
      : "";

    return '<svg class="kit" viewBox="0 0 64 64" role="img" aria-label="' + esc(team) + ' kit">' +
      '<path d="' + shirt + '" fill="' + body + '"/>' + stripes +
      '<path d="' + shirt + '" fill="none" stroke="rgba(0,0,0,.34)" stroke-width="1.4" stroke-linejoin="round"/>' +
      '<path d="M26 6 a6 5 0 0 0 12 0" fill="none" stroke="rgba(0,0,0,.34)" stroke-width="1.4"/>' +
      "</svg>";
  };

  FA.CLUB_COLOR = { Chelsea: "#034694", "Man Utd": "#DA291C", Arsenal: "#EF0107" };

  /* ---------------- the locker-room card ----------------
     One delegated listener for the whole document. Any element carrying
     data-player opens the card, in any room. */
  let CARD_INDEX = null;

  FA.initPlayerCards = function (players, verdicts, me) {
    const byVerdict = {};
    (verdicts || []).forEach((v) => { byVerdict[v.id] = v; });
    CARD_INDEX = { byName: {}, verdicts: byVerdict, me: me || FA.ME };
    (players || []).forEach((p) => { CARD_INDEX.byName[p.name] = p; });

    if (!document.getElementById("fa-backdrop")) {
      const el = document.createElement("div");
      el.className = "backdrop";
      el.id = "fa-backdrop";
      el.hidden = true;
      el.innerHTML = '<div class="pcard" id="fa-pcard" role="dialog" aria-modal="true" aria-label="Player file"></div>';
      document.body.appendChild(el);
    }

    document.addEventListener("click", (e) => {
      const link = e.target.closest("[data-player]");
      if (link) { e.preventDefault(); FA.openCard(link.dataset.player); return; }
      if (e.target.closest("[data-fa-close]") || e.target.id === "fa-backdrop") FA.closeCard();
    });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") FA.closeCard(); });
  };

  /* Wrap known player names in prose so they open the card. Long names first,
     and nothing under five characters — "Sarr" would match inside other words. */
  // Lookbehind is ES2018 and Safari only got it in 16.4. A SyntaxError here
  // would be thrown while RENDERING, taking the whole page down on an older
  // phone rather than degrading, so it is feature-detected once and a
  // capturing-group form is used where it is missing.
  const HAS_LOOKBEHIND = (function () {
    try { new RegExp("(?<!x)y"); return true; } catch (e) { return false; }
  })();

  FA.linkPlayers = function (text) {
    if (!CARD_INDEX) return esc(text);
    let out = esc(text);
    const names = Object.keys(CARD_INDEX.byName).sort((a, b) => b.length - a.length);
    for (const n of names) {
      if (n.length < 5) continue;
      const safe = esc(n).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (HAS_LOOKBEHIND) {
        const re = new RegExp("(?<![\\w>])(" + safe + ")(?![\\w<])");
        if (re.test(out)) out = out.replace(re, '<a class="plink" data-player="$1">$1</a>');
      } else {
        // Capture the preceding character instead of asserting it, then put
        // it back. Same guard: not mid-word, and not inside a tag.
        const re = new RegExp("(^|[^\\w>])(" + safe + ")(?![\\w<])");
        if (re.test(out)) {
          out = out.replace(re, '$1<a class="plink" data-player="' + esc(n) + '">$2</a>');
        }
      }
    }
    return out;
  };

  FA.openCard = function (name) {
    if (!CARD_INDEX) return;
    const p = CARD_INDEX.byName[name];
    if (!p) return;
    const v = CARD_INDEX.verdicts[p.id];
    const me = CARD_INDEX.me;
    const owners = (p.owned_by && p.owned_by.length)
      ? p.owned_by.map((n) =>
          '<span class="own' + (n === me ? " mine" : "") + '">' + esc(FA.initial(n)) + "</span>").join("")
      : '<span class="faint" style="font-size:13px">nobody in the five</span>';

    document.getElementById("fa-pcard").innerHTML =
      '<button class="close" data-fa-close>close</button>' +
      "<h3>" + esc(p.name) + " " + (v ? FA.vdChip(v) : "") + "</h3>" +
      '<div class="meta">' + esc(p.pos) + " &middot; " + esc(p.team) + " &middot; &pound;" +
        p.price.toFixed(1) + "m" + (p.penalties ? ' &middot; <span class="pill">penalties</span>' : "") + "</div>" +
      (p.status && p.status !== "a" && p.news
        ? '<p class="trig" style="border-left-color:var(--hot);margin-bottom:14px">' + esc(p.news) + "</p>" : "") +
      '<div class="stats">' +
        '<div class="stat"><b>' + p.points + "</b><span>points</span></div>" +
        '<div class="stat"><b>' + p.ownership + "%</b><span>owned</span></div>" +
        '<div class="stat"><b>' + esc(p.form) + "</b><span>form</span></div>" +
        '<div class="stat"><b>' + (p.fdr_avg == null ? "&mdash;" : p.fdr_avg) + "</b><span>avg fdr</span></div>" +
      "</div>" +
      '<div class="sect">Last five</div>' + FA.formRun(p.recent) +
      '<div class="sect">Next five</div>' + FA.fdrStrip(p.fixtures) +
      '<div class="sect">Owned in the five</div><div class="owners" style="margin:0">' + owners + "</div>" +
      (v
        ? '<div class="sect">Our verdict</div><p class="why">' + esc(v.why) + "</p>" +
          '<p class="trig"><strong>What changes it:</strong> ' + esc(v.trigger) + "</p>"
        : '<div class="sect">Our verdict</div><p class="why faint">No verdict written yet &mdash; evidence only.</p>');

    document.getElementById("fa-backdrop").hidden = false;
  };

  FA.closeCard = function () {
    const b = document.getElementById("fa-backdrop");
    if (b) b.hidden = true;
  };

  /* ---------------- sortable tables ----------------
     Any <table class="sortable">: click a header to sort by that column.
     The type is inferred from the cells rather than declared, so a new table
     gets it for free — a column whose cells all contain a number sorts
     numerically (ignoring the pound signs and percents), everything else
     sorts as text. Mark a column data-nosort to opt out; the fixture strips
     have no meaningful order. */
  const sortValue = (cell) => {
    const t = (cell.textContent || "").trim();
    // Strip currency, percent and thousands separators before parsing, so
    // "£12.0m", "69.1%" and "1,204" all sort as the numbers they look like.
    const n = parseFloat(t.replace(/[£$,%\s]/g, "").replace(/m$/i, ""));
    return { n: Number.isFinite(n) ? n : null, t: t.toLowerCase() };
  };

  FA.wireSortable = function (root) {
    (root || document).querySelectorAll("table.sortable").forEach((table) => {
      const head = table.tHead && table.tHead.rows[0];
      const body = table.tBodies[0];
      if (!head || !body) return;
      // Idempotent. A table inside a closed <details> is already in the DOM,
      // so the page-level pass wires it AND the toggle handler wires it again
      // — and two handlers on one header means every click sorts twice, which
      // reads as "the first click sorts the wrong way round".
      if (table.dataset.sortWired) return;
      table.dataset.sortWired = "1";

      [...head.cells].forEach((th, col) => {
        if (th.hasAttribute("data-nosort")) return;
        th.classList.add("th-sort");
        th.tabIndex = 0;
        const run = () => {
          const dir = th.dataset.dir === "asc" ? "desc" : "asc";
          [...head.cells].forEach((o) => { delete o.dataset.dir; o.classList.remove("sorted"); });
          th.dataset.dir = dir;
          th.classList.add("sorted");

          const rows = [...body.rows];
          // Every cell in the column must look numeric before sorting numerically:
          // one stray "—" should not silently reorder the rest as text.
          const vals = rows.map((r) => sortValue(r.cells[col] || document.createElement("td")));
          const numeric = vals.length > 0 && vals.every((v) => v.n !== null);
          const sign = dir === "asc" ? 1 : -1;
          rows
            .map((r, i) => ({ r, v: vals[i] }))
            .sort((a, b) => sign * (numeric ? a.v.n - b.v.n : a.v.t.localeCompare(b.v.t)))
            .forEach((x) => body.appendChild(x.r));
        };
        th.addEventListener("click", run);
        th.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); run(); }
        });
      });
    });
  };

  /* ---------------- focus clubs ----------------
     A rule, not a list. Three clubs are permanent because that is who the
     five support; until GW10 the other two are seeded because an early table
     is noise; from GW10 the rest is the real top six, recomputed weekly. */
  FA.ALLEGIANCE = ["Chelsea", "Manchester United", "Arsenal"];
  FA.SEED_CLUBS = ["Liverpool", "Manchester City"];
  FA.FOCUS_FROM_GW = 10;
  FA.FOCUS_TOP = 6;

  FA.focusClubs = function (gw, tableRows) {
    if (!gw || gw < FA.FOCUS_FROM_GW) return FA.ALLEGIANCE.concat(FA.SEED_CLUBS);
    const top = (tableRows || []).slice()
      .sort((a, b) => a.pos - b.pos)
      .slice(0, FA.FOCUS_TOP)
      .map((r) => r.team);
    const out = [];
    FA.ALLEGIANCE.concat(top).forEach((c) => { if (out.indexOf(c) === -1) out.push(c); });
    return out;
  };

  /* ---------------- the watchlist star ----------------
     Server-side in KV keyed by gaffer, so a star set on a phone is there on a
     laptop and the house list is shared. Falls back to this browser when the
     endpoint is unavailable, which is what happens on a local preview. */
  const LKEY = "fiveaside-stars";
  FA.stars = { data: {}, remote: false };

  FA.loadStars = async function () {
    try {
      const res = await fetch("/api/stars", { cache: "no-cache" });
      if (res.ok) {
        FA.stars.data = await res.json();
        FA.stars.remote = true;
        return FA.stars.data;
      }
    } catch (e) { /* fall through to local */ }
    try { FA.stars.data = JSON.parse(localStorage.getItem(LKEY)) || {}; } catch (e) { FA.stars.data = {}; }
    return FA.stars.data;
  };

  FA.toggleStar = async function (gaffer, playerId) {
    const list = FA.stars.data[gaffer] || (FA.stars.data[gaffer] = []);
    const i = list.indexOf(playerId);
    if (i === -1) list.push(playerId); else list.splice(i, 1);

    if (FA.stars.remote) {
      try {
        await fetch("/api/stars", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ gaffer: gaffer, player: playerId, on: i === -1 }),
        });
      } catch (e) { /* the optimistic update stands; next load reconciles */ }
    } else {
      try { localStorage.setItem(LKEY, JSON.stringify(FA.stars.data)); } catch (e) { /* ignore */ }
    }
    return i === -1;
  };

  FA.isStarred = (gaffer, playerId) =>
    (FA.stars.data[gaffer] || []).indexOf(playerId) !== -1;

  /* ---------------- shell ---------------- */
  FA.stamp = function (iso) {
    const el = document.getElementById("stamp");
    if (!el || !iso) return;
    const d = new Date(iso);
    if (isNaN(d.getTime())) return;
    el.textContent = "updated " +
      d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) + ", " +
      d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  };

  FA.fail = function (el, msg) {
    el.innerHTML = '<p class="empty">' + esc(msg) + "</p>";
  };

  window.FA = FA;
})();
