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
     honest answer, not an empty state to apologise for.

     Every competition since 2026-08-27, not just the league. It was FPL-only
     because FPL was the only source wired in, so a club that played a cup tie
     or a European night showed a gap its real form did not have. A non-league
     result is marked, because a win over League Two opposition and a win at
     Anfield are not the same evidence and the strip must not pretend they
     are. */
  const COMP_LABEL = {
    PL: "Premier League", UCL: "Champions League", CL: "Champions League",
    EL: "Europa League", UECL: "Conference League", FA: "FA Cup", EFL: "EFL Cup",
  };
  FA.compName = (code) => COMP_LABEL[code] || code || "";
  const whenLabel = (r) => {
    if (r.comp && r.comp !== "PL") {
      const d = r.date ? new Date(r.date + "T12:00:00Z") : null;
      const day = d && !isNaN(d.getTime())
        ? d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "";
      return (COMP_LABEL[r.comp] || r.comp) + (day ? ", " + day : "");
    }
    return r.gw ? "GW" + r.gw : (COMP_LABEL[r.comp] || "");
  };

  /* ---------------- midweek ----------------
     What a player did BETWEEN the league games, which is the half of his week
     the fixture strip cannot show. Two different claims, kept visibly apart:

       what he played   player-level, from ESPN team sheets
       what is coming   CLUB-level, because a cup team sheet does not exist yet

     There is no minutes figure anywhere in this, and there is not meant to be.
     ESPN's summary carries starter/subIns/appearances and nothing else, so the
     card can say he started on Wednesday and must not imply it knows for how
     long. */
  const MW_DAY = { weekday: "short", day: "numeric", month: "short" };
  const mwDay = (d) => {
    const t = new Date(d + "T12:00:00Z");
    return isNaN(t.getTime()) ? d : t.toLocaleDateString("en-GB", MW_DAY);
  };

  /* Escalates, because one cup tie and three are not the same warning. Starts
     only: coming off the bench for twenty minutes is not why anyone gets
     rested. */
  FA.midweekLoad = function (p) {
    const starts = (p.other_apps || []).filter((a) => a.started);
    if (!starts.length) return "";
    return starts.length === 1
      ? "midweek starter"
      : starts.length + " midweek starts";
  };

  FA.midweekHTML = function (p) {
    const played = p.other_apps || [];
    const next = p.other_next || [];
    if (!played.length && !next.length) return "";

    let out = '<div class="sect">Midweek</div><div class="mw">';
    played.forEach((a) => {
      out += '<div class="mw-row' + (a.started ? " on" : "") + '">' +
        '<span class="mw-mark">' + (a.started ? "&#9679;" : "&#9675;") + "</span>" +
        '<span class="mw-what"><b>' + (a.started ? "Started" : "Came on") + "</b> " +
        esc(FA.compName(a.comp)) + " v " + esc(FA.club(a.opp)) + "</span>" +
        '<span class="mw-when">' + esc(mwDay(a.date)) + "</span></div>";
    });
    next.forEach((f) => {
      out += '<div class="mw-row next">' +
        '<span class="mw-mark">&#9675;</span>' +
        '<span class="mw-what"><b>' + esc(p.team) + "</b> " + esc(FA.compName(f.comp)) + " " +
        (f.opp ? (f.home ? "v " : "at ") + esc(FA.club(f.opp)) : "&mdash; opponent not drawn") +
        "</span>" +
        '<span class="mw-when">' + esc(mwDay(f.date)) + "</span></div>";
    });
    out += "</div>";
    return out;
  };

  FA.formRun = function (recent) {
    if (!recent || !recent.length) {
      return '<span class="faint" style="font-size:13px">No matches played yet.</span>';
    }
    return '<span class="frun">' + recent.map((r) => {
      const cup = r.comp && r.comp !== "PL";
      // The opponent may be a club with no three-letter code of its own —
      // a cup tie brings sides FPL has never heard of — so fall back to the
      // name itself rather than inventing an abbreviation for it.
      const opp = FA.clubAbbr ? FA.clubAbbr(r.opp, r.opp) : r.opp;
      return '<i data-r="' + esc(r.result) + '"' + (cup ? ' data-cup="' + esc(r.comp) + '"' : "") +
        ' title="' + esc(whenLabel(r)) + " " + (r.home ? "vs " : "away to ") +
        esc(FA.club(r.opp)) + " &middot; " + r.gf + "-" + r.ga + '">' +
        "<b>" + esc(r.result) + "</b>" + r.gf + "&ndash;" + r.ga +
        '<em>' + (r.home ? "" : "@") + esc(opp) + "</em>" +
        (cup ? '<u>' + esc(r.comp) + "</u>" : "") + "</i>";
    }).join("") + "</span>";
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

  FA.initPlayerCards = function (players, verdicts, me, signals) {
    const byVerdict = {};
    (verdicts || []).forEach((v) => { byVerdict[v.id] = v; });
    // Anything the editor wrote ABOUT A NAMED PLAYER belongs on that player's
    // card, not in a team-news list. Rotation risk, a missed penalty, a
    // confirmed XI that left him out — that is what you want when you click
    // his name, and it is noise in a panel about clubs.
    const byPlayer = {};
    (signals || []).forEach((sig) => {
      if (!sig.player) return;
      (byPlayer[sig.player] = byPlayer[sig.player] || []).push(sig);
    });
    /* Names are NOT unique — two Palmers, two Wilsons, three Phillipses, 14
       shared surnames in a 614-man file. Building byName with last-write-wins
       handed each shared name to whoever happened to sit later in the file,
       which is how clicking Cole Palmer opened the Ipswich goalkeeper: same
       surname, lower id, later in the array.

       Two fixes, and both are needed. Here, when a name is shared, it
       resolves to the player the reader means — one of the five's own first,
       then the most owned. And at every call site that has a player object in
       hand, the card is addressed by ELEMENT ID instead (data-pid), so the
       name index is only ever consulted for prose. */
    CARD_INDEX = { byName: {}, byId: {}, verdicts: byVerdict, signals: byPlayer, me: me || FA.ME };
    const claim = (x) => ((x.owned_by && x.owned_by.length) ? 1e6 : 0) + (x.ownership || 0);
    (players || []).forEach((p) => {
      CARD_INDEX.byId[p.id] = p;
      const held = CARD_INDEX.byName[p.name];
      if (!held || claim(p) > claim(held)) CARD_INDEX.byName[p.name] = p;
    });

    if (!document.getElementById("fa-backdrop")) {
      const el = document.createElement("div");
      el.className = "backdrop";
      el.id = "fa-backdrop";
      el.hidden = true;
      el.innerHTML = '<div class="pcard" id="fa-pcard" role="dialog" aria-modal="true" aria-label="Player file"></div>';
      document.body.appendChild(el);
    }

    // Stars and the signed-in gaffer are needed wherever a card can open,
    // which is everywhere. Started here and awaited by the card rather than
    // by the page: a room that already knows who you are has seeded
    // FA.setSession before this runs, and the card repaints its star when
    // both answers are in.
    FA.starsReady();
    FA.sessionReady();

    document.addEventListener("click", (e) => {
      const star = e.target.closest("[data-cardstar]");
      if (star) {
        e.preventDefault();
        const id = Number(star.dataset.cardstar);
        star.disabled = true;
        FA.toggleStar(id).then((on) => {
          star.disabled = false;
          if (on === null) return; // signed out between render and click
          const p = CARD_INDEX.byId ? CARD_INDEX.byId[id] : null;
          if (p) repaintStar(p);
        });
        return;
      }
      const link = e.target.closest("[data-player],[data-pid]");
      if (link) {
        e.preventDefault();
        // An id if the emitter had one, the name only as a last resort.
        FA.openCard(link.dataset.pid || link.dataset.player);
        return;
      }
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
      const pid = CARD_INDEX.byName[n].id;
      // The guard has to keep the name out of THREE places, not one: mid-word,
      // inside a tag, and inside an attribute value already written by an
      // earlier pass. The third is what broke "Lewis-Potter" — a later pass for
      // "Potter" matched inside data-player="Lewis-Potter" (a quote is not a
      // word character, nor is a hyphen) and spliced a tag into the attribute.
      if (HAS_LOOKBEHIND) {
        const re = new RegExp("(?<![\\w>\"=-])(" + safe + ")(?![\\w<\"-])");
        if (re.test(out)) {
          out = out.replace(re, '<a class="plink" data-pid="' + pid + '" data-player="$1">$1</a>');
        }
      } else {
        // Capture the preceding character instead of asserting it, then put
        // it back. Same guard, same three places.
        const re = new RegExp("(^|[^\\w>\"=-])(" + safe + ")(?![\\w<\"-])");
        if (re.test(out)) {
          out = out.replace(re,
            '$1<a class="plink" data-pid="' + pid + '" data-player="' + esc(n) + '">$2</a>');
        }
      }
    }
    return out;
  };

  /* Everything currently known about this player beyond the numbers: the
     game's own flag, plus whatever the editor filed against his name. */
  const SIG_LABEL = {
    injury: "Injury", doubt: "Doubt", ban: "Suspension",
    rotation: "Rotation risk", price: "Price", news: "News", managers: "Manager",
  };
  function newsHTML(p) {
    const sigs = (CARD_INDEX.signals && CARD_INDEX.signals[p.name]) || [];
    const flagged = p.status && p.status !== "a" && p.news;
    if (!sigs.length && !flagged) return "";
    const rows = [];
    if (flagged) {
      rows.push('<div class="pnews f"><span class="pnews-tag">Flagged</span>' +
        esc(p.news) + "</div>");
    }
    sigs.forEach((sig) => {
      rows.push('<div class="pnews"><span class="pnews-tag">' +
        esc(SIG_LABEL[sig.tag] || sig.tag) + "</span>" + esc(sig.text) +
        (sig.action ? " <strong>" + esc(sig.action) + "</strong>" : "") +
        (sig.source ? '<span class="pnews-src">' + esc(sig.source) + "</span>" : "") +
        "</div>");
    });
    return '<div class="sect">What we know</div>' + rows.join("");
  }

  /* The star's label says what pressing it will DO, in both directions —
     "On your watchlist" was a status sitting on a button, which reads as
     already-pressed rather than as the way back out.

     Drawn from whatever is known at the moment the card opens and corrected
     by repaintStar when the rest arrives. Getting that wrong is worse than
     it looks: on / and /locker/ the star list is fetched but not awaited, so
     a card opened straight after load used to offer "Add to your watchlist"
     for a player already on it. */
  function starButtonHTML(p) {
    const mine = FA.myNick();
    if (!mine) return "";   // a watchlist belongs to somebody
    const on = FA.isStarred(mine, p.id);
    return '<button class="cardstar" data-cardstar="' + p.id + '" aria-pressed="' + on + '">' +
      (on ? "&#9733; Remove from watchlist" : "&#9734; Add to your watchlist") + "</button>";
  }

  /* Only if that card is still the one on screen — the answer can arrive
     after the reader has closed it and opened somebody else. */
  function repaintStar(p) {
    const slot = document.getElementById("fa-star");
    if (!slot || slot.dataset.for !== String(p.id)) return;
    slot.innerHTML = starButtonHTML(p);
  }

  /* Takes an element id or a name. Ids win: they are exact, and a name is a
     guess whenever two players share one. */
  FA.openCard = function (ref) {
    if (!CARD_INDEX) return;
    const p = CARD_INDEX.byId[ref] || CARD_INDEX.byName[ref];
    if (!p) return;
    const v = CARD_INDEX.verdicts[p.id];
    const me = CARD_INDEX.me;
    // A cup start between two league games is the thing that gets a player
    // rested, so it earns a mark next to his name rather than only a line
    // further down the card.
    const load = FA.midweekLoad(p);
    const mwPill = load
      ? ' <span class="pill rot" title="Cup or European starts since the last league game">' +
        esc(load) + "</span>"
      : "";
    // The five are drawn, not initialled: faces.js is loaded on every page and
    // a caricature says who at a glance where "SF" needs decoding.
    const owners = (p.owned_by && p.owned_by.length)
      ? p.owned_by.map((n) =>
          '<span class="ownface' + (n === me ? " mine" : "") + '" title="' + esc(n) + '">' +
          (FA.faceSVG ? FA.faceSVG(n) : esc(FA.initial(n))) +
          "<b>" + esc(n) + "</b></span>").join("")
      : '<span class="faint" style="font-size:13px">nobody in the five</span>';

    document.getElementById("fa-pcard").innerHTML =
      '<button class="close" data-fa-close>close</button>' +
      "<h3>" + esc(p.name) + " " + (v ? FA.vdChip(v) : "") + mwPill + "</h3>" +
      '<div class="meta">' + esc(p.pos) + " &middot; " + esc(p.team) + " &middot; &pound;" +
        p.price.toFixed(1) + "m" + (p.penalties ? ' &middot; <span class="pill">penalties</span>' : "") + "</div>" +

      '<div class="stats">' +
        '<div class="stat"><b>' + p.points + "</b><span>points</span></div>" +
        '<div class="stat"><b>' + p.ownership + "%</b><span>owned</span></div>" +
        '<div class="stat"><b>' + esc(p.form) + "</b><span>form</span></div>" +
        '<div class="stat"><b>' + (p.fdr_avg == null ? "&mdash;" : p.fdr_avg) + "</b><span>avg fdr</span></div>" +
      "</div>" +
      newsHTML(p) +
      '<div class="sect">Last five</div>' + FA.formRun(p.recent) +
      '<div class="sect">Next five</div>' + FA.fdrStrip(p.fixtures) +
      FA.midweekHTML(p) +
      '<div class="sect">Owned in the five</div><div class="ownfaces">' + owners + "</div>" +
      '<div id="fa-star" data-for="' + p.id + '">' + starButtonHTML(p) + "</div>" +
      (v
        ? '<div class="sect">Our verdict</div><p class="why">' + esc(v.why) + "</p>" +
          '<p class="trig"><strong>What changes it:</strong> ' + esc(v.trigger) + "</p>"
        : '<div class="sect">Our verdict</div><p class="why faint">No verdict written yet &mdash; evidence only.</p>');

    document.getElementById("fa-backdrop").hidden = false;
    // Both facts the star needs travel over the network, and a card can open
    // before either lands. Paint again when they do rather than hold the
    // whole card back on a fetch.
    Promise.all([FA.sessionReady(), FA.starsReady()]).then(() => repaintStar(p));
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

  /* ---------------- club names, as people say them ----------------
     DISPLAY ONLY, and that is load-bearing. The full name is the identity:
     FA.ALLEGIANCE matches on it, focusClubs compares against it, and every
     data-club attribute carries it. Shortening a value that is later compared
     is how a rule quietly stops matching, so this is applied at the moment of
     printing and never to anything stored, keyed or compared.

     Only clubs whose full name is longer than the name anyone actually says.
     Crystal Palace and Aston Villa are deliberately absent — those ARE what
     people say, and inventing "Palace" or "Villa" would be forcing it. The
     FPL feed's own short forms are folded in too, so the league room and the
     digest spell the same club the same way. */
  const CLUB_SHORT = {
    "AFC Bournemouth": "Bournemouth",
    "Brighton & Hove Albion": "Brighton",
    "Brighton and Hove Albion": "Brighton",
    "Manchester City": "Man City",
    "Manchester United": "Man United",
    "Man Utd": "Man United",
    "Newcastle United": "Newcastle",
    "Tottenham Hotspur": "Spurs",
    "Nottingham Forest": "Forest",
    "Nott'm Forest": "Forest",
    "Wolverhampton Wanderers": "Wolves",
    "West Ham United": "West Ham",
    "West Bromwich Albion": "West Brom",
    "Sheffield United": "Sheff United",
    "Sheffield Wednesday": "Sheff Wednesday",
    "Queens Park Rangers": "QPR",
    "Leeds United": "Leeds",
    "Ipswich Town": "Ipswich",
    "Leicester City": "Leicester",
    "Norwich City": "Norwich",
    "Luton Town": "Luton",
    "Hull City": "Hull",
    "Coventry City": "Coventry",
    "Bradford City": "Bradford",
    "Stoke City": "Stoke",
    "Swansea City": "Swansea",
    "Cardiff City": "Cardiff",
    "Birmingham City": "Birmingham",
    "Derby County": "Derby",
    "Preston North End": "Preston",
    "Blackburn Rovers": "Blackburn",
    "Bolton Wanderers": "Bolton",
    "Huddersfield Town": "Huddersfield",
    "Plymouth Argyle": "Plymouth",
    "Rotherham United": "Rotherham",
    "Oxford United": "Oxford",
  };

  FA.club = (name) => CLUB_SHORT[name] || name || "";

  /* Three-letter codes, because ESPN's own abbreviations are per-competition
     and disagree with themselves: Manchester United came back as "MAN" in the
     league feed and "MNU" in the EFL Cup feed, so the same club wore two codes
     on one page. Keyed on the canonical full name, which is stable.

     Anyone not in here — Benfica, Napoli, a National League cup opponent —
     keeps whatever the feed said, which is right far more often than a
     truncation we invented would be. */
  const CLUB_ABBR = {
    "Arsenal": "ARS", "Aston Villa": "AVL", "AFC Bournemouth": "BOU",
    "Brentford": "BRE", "Brighton & Hove Albion": "BHA", "Chelsea": "CHE",
    "Crystal Palace": "CRY", "Everton": "EVE", "Fulham": "FUL",
    "Ipswich Town": "IPS", "Leeds United": "LEE", "Leicester City": "LEI",
    "Liverpool": "LIV", "Manchester City": "MCI", "Manchester United": "MUN",
    "Newcastle United": "NEW", "Nottingham Forest": "NFO", "Southampton": "SOU",
    "Tottenham Hotspur": "TOT", "West Ham United": "WHU",
    "Wolverhampton Wanderers": "WOL", "Sunderland": "SUN", "Hull City": "HUL",
    "Coventry City": "COV", "Bradford City": "BRD", "Sheffield United": "SHU",
    "Sheffield Wednesday": "SHW", "Norwich City": "NOR", "Watford": "WAT",
    "Stoke City": "STK", "Swansea City": "SWA", "Cardiff City": "CAR",
    "Middlesbrough": "MID", "Preston North End": "PNE", "Millwall": "MIL",
    "Blackburn Rovers": "BLB", "Bristol City": "BRC", "Derby County": "DER",
    "Plymouth Argyle": "PLY", "Portsmouth": "POR", "Oxford United": "OXF",
    "Queens Park Rangers": "QPR", "Luton Town": "LUT", "West Bromwich Albion": "WBA",
  };

  FA.clubAbbr = (name, fallback) =>
    CLUB_ABBR[name] || fallback || (name || "").slice(0, 3).toUpperCase();

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

  let starsAsked = null;

  /* Memoised so the rooms and the card cannot each start their own fetch,
     and so anything that needs the list can await the SAME answer instead of
     reading a half-filled FA.stars.data. */
  FA.starsReady = function () {
    if (!starsAsked) starsAsked = FA.loadStars();
    return starsAsked;
  };

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

  /* Who is holding the phone, as opposed to whose room is on screen. The
     answer is what decides whether a star can be offered at all, and it is
     never the argument to a star. The server does not believe the client
     about this either — see functions/api/stars.js.

     Asked for lazily and at most once per page. A room that already has the
     session in hand seeds it with FA.setSession rather than asking again:
     the gaffers room gets it inside the /api/private payload, and a second
     /api/auth round trip there would be a race as well as a waste — the
     watchlist renders on that payload, so an unresolved FA.session would
     hide your own star buttons and label your own list "theirs". */
  FA.session = null;
  let sessionAsked = null;

  FA.setSession = function (s) {
    FA.session = s || null;
    sessionAsked = Promise.resolve(FA.session);
    return FA.session;
  };

  FA.sessionReady = function () {
    if (!sessionAsked) {
      sessionAsked = (async function () {
        try {
          const res = await fetch("/api/auth", { cache: "no-store" });
          if (res.ok) FA.session = await res.json();
        } catch (e) { /* signed out, or no functions in a local preview */ }
        return FA.session;
      })();
    }
    return sessionAsked;
  };

  FA.myNick = () => (FA.session && FA.session.nick) || null;

  /* A star always lands in YOUR list, whoever's room you are looking at.
     Passing the gaffer in was how starring from another gaffer's squad wrote
     to theirs. */
  FA.toggleStar = async function (playerId) {
    const me = FA.myNick();
    if (!me) return null;
    const list = FA.stars.data[me] || (FA.stars.data[me] = []);
    const i = list.indexOf(playerId);
    if (i === -1) list.push(playerId); else list.splice(i, 1);

    if (FA.stars.remote) {
      try {
        await fetch("/api/stars", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ player: playerId, on: i === -1 }),
        });
      } catch (e) { /* the optimistic update stands; next load reconciles */ }
    } else {
      try { localStorage.setItem(LKEY, JSON.stringify(FA.stars.data)); } catch (e) { /* ignore */ }
    }
    if (typeof FA.onStarChange === "function") FA.onStarChange(playerId, i === -1);
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
