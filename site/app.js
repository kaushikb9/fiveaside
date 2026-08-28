/* touchline — what happened.
   =========================================================================
   The league room. Identical for all five: no squads, no verdicts, no
   personal state. If something here depends on who is reading it, it belongs
   in the gaffers room instead.

   Shows the LATEST digest entry only. Older entries keep accumulating in
   digests.json and are listed at /archive/ — nobody reads last fortnight's
   week-in-review on the way to this week's, so the fold that used to hold
   them was cost with no reader.

   The league sits in one panel with two tabs: the table and the matches. The
   table comes from site/data/table.json (already local, Premier League only).
   The matches come from /api/matches, which since 2026-08-27 is a CALENDAR
   window rather than an FPL gameweek: a week either side of today, every
   competition a Premier League club is in. Their absence costs the tab, never
   the page.
   ========================================================================= */
(function () {
  "use strict";
  const { esc, $, loadJSON } = FA;
  const D = FA.Digest;

  /* ---------- the match river ----------
     Seven days back, seven forward, grouped by day, with a rule where today
     falls. This replaced two FPL-gameweek tabs, and the reason is worth
     keeping: an FPL gameweek is a Premier League construct, so a Tuesday in
     Europe or a January cup round could not appear in one at all, and a
     "current" gameweek stays current from the last whistle until the next
     kickoff — which is precisely the midweek when the missing matches are
     played. The calendar does not have that problem.

     FOLDED BY DAY since 2026-08-28. A fortnight of every competition a
     Premier League club is in runs to thirty-odd rows, and the reader who
     wanted this week's result was scrolling past next Tuesday to reach the
     table under it. Each day is now a header over a hidden body; what opens
     by itself is today and the last day that was played, which between them
     are the two days anyone came here for. A folded day still says how many
     matches it holds and which competitions they are in, so a European night
     announces itself without being opened. */

  const DAY_FMT = { weekday: "short", day: "numeric", month: "short" };
  const dayLabel = (ymd) => {
    // Noon UTC, so a timezone shift can never move the label to the day before.
    const d = new Date(ymd + "T12:00:00Z");
    return isNaN(d.getTime()) ? ymd : d.toLocaleDateString("en-GB", DAY_FMT).toUpperCase();
  };
  const clock = (iso) => {
    const d = new Date(iso);
    return isNaN(d.getTime()) ? "" : d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  };

  /* ESPN's abbreviations are per-competition and disagree with themselves —
     Manchester United came back "MAN" in the league feed and "MNU" in the cup
     one — so the code comes from the canonical name via FA.clubAbbr, with the
     feed's own as the fallback for clubs we do not carry. */
  const side = (t, cls) =>
    '<span class="fx-team ' + cls + '">' +
    (cls === "away" ? D.crest(t.crest) : "") +
    '<b class="fx-full">' + esc(FA.club(t.name)) + "</b>" +
    '<b class="fx-abbr">' + esc(FA.clubAbbr(t.name, t.short)) + "</b>" +
    (cls === "home" ? D.crest(t.crest) : "") + "</span>";

  /* Names stay clickable — every scorer opens their file. The minute is new:
     FPL never carried one, ESPN does. */
  const goals = (list, which) =>
    (list || []).filter((g) => g.side === which).map((g) =>
      FA.linkPlayers(g.name) +
      (g.minute ? ' <span class="gm">' + esc(g.minute) + "</span>" : "") +
      (g.pen ? ' <span class="og">pen</span>' : "") +
      (g.og ? ' <span class="og">og</span>' : "")).join(", ");

  function statusHTML(m) {
    if (m.status === "FINISHED") return '<span class="fx-status">FT</span>';
    if (m.status === "LIVE") {
      return '<span class="fx-status live"><i></i>' + esc(m.minute || "LIVE") + "</span>";
    }
    return '<span class="fx-status">' + esc(clock(m.kickoff)) + "</span>";
  }

  function matchHTML(m) {
    const played = m.status !== "SCHEDULED";
    const score = played
      ? '<span class="fx-score">' + esc(m.home.score) + "<em>&ndash;</em>" + esc(m.away.score) + "</span>"
      : '<span class="fx-score pre">v</span>';
    const gh = goals(m.scorers, "home");
    const ga = goals(m.scorers, "away");
    const scorers = (gh || ga)
      ? '<div class="fx-goals"><span class="g h">' + gh + '</span><span></span><span class="g a">' + ga +
        "</span><span></span></div>"
      : "";
    // Only a non-league tie is tagged. A normal Saturday reads exactly as it
    // always did; a European night is what stands out, which is the point.
    const tag = m.comp === "PL" ? "" : '<span class="fx-comp">' + esc(m.comp) + "</span>";
    return '<div class="fx' + (m.status === "LIVE" ? " is-live" : "") + '">' +
      side(m.home, "home") + score + side(m.away, "away") +
      '<span class="fx-meta">' + statusHTML(m) + tag + "</span>" + scorers + "</div>";
  }

  /* Which days open on their own: today, the last day that was played, and
     anything live — a match in progress is never folded away on the first
     paint. It is a first-paint rule only. Once the reader has opened or shut
     anything, OPEN_DAYS holds what THEY chose and the sixty-second live
     repaint honours it rather than springing the list back to the default. */
  function defaultOpenDays(m) {
    const today = new Date().toISOString().slice(0, 10);
    const open = new Set();
    let lastPlayed = null;
    (m.days || []).forEach((d) => {
      const ms = d.matches || [];
      if (!ms.length) return;
      // "Played" means a ball was kicked, not merely that the date has passed:
      // today's fixtures are usually still SCHEDULED when the page is opened in
      // the morning, and treating today as the last played day would then open
      // a list of kick-off times and no results at all.
      if (d.date <= today && ms.some((x) => x.status !== "SCHEDULED")) lastPlayed = d.date;
      if (d.date === today) open.add(d.date);
      if (ms.some((x) => x.status === "LIVE")) open.add(d.date);
    });
    if (lastPlayed) open.add(lastPlayed);
    return open;
  }

  // Null until the first river paints; a Set of dates after that. It outlives
  // paint() on purpose — see defaultOpenDays.
  let OPEN_DAYS = null;

  function dayHeadHTML(d, open) {
    const ms = d.matches || [];
    const comps = ms.reduce((a, x) => (a.indexOf(x.comp) === -1 ? a.concat(x.comp) : a), []);
    const live = ms.some((x) => x.status === "LIVE");
    return '<button class="fx-dayhead" data-day="' + esc(d.date) + '" aria-expanded="' + String(open) + '">' +
      '<span class="fx-caret" aria-hidden="true">&#9654;</span>' +
      '<span class="fx-dayname">' + esc(dayLabel(d.date)) + "</span>" +
      '<span class="fx-daycount">' + ms.length + (ms.length === 1 ? " match" : " matches") + "</span>" +
      '<span class="fx-daycomps">' +
      comps.map((c) => '<span class="fx-comp' + (live ? " live" : "") + '">' + esc(c) + "</span>").join("") +
      "</span></button>";
  }

  function riverHTML(m) {
    if (!m) return '<p class="note">Loading the fixtures&hellip;</p>';
    if (!m.days || !m.days.length) {
      // Six dead feeds still return 200, so say which rather than showing a
      // blank list and letting the reader assume there is no football on.
      return '<p class="note">No matches in this fortnight' +
        (m.errors && m.errors.length ? " (" + esc(m.errors.join(", ")) + ")" : "") + ".</p>";
    }
    if (!OPEN_DAYS) OPEN_DAYS = defaultOpenDays(m);
    const today = new Date().toISOString().slice(0, 10);
    const allOpen = m.days.every((d) => OPEN_DAYS.has(d.date));
    let out = '<div class="fx-tools"><button class="fx-more" data-days="all">' +
      (allOpen ? "Collapse all" : "Expand all") + "</button></div>" +
      '<div class="fx-list">';
    let ruled = false;
    m.days.forEach((d) => {
      if (!ruled && d.date >= today) { out += '<div class="fx-today"><span>today</span></div>'; ruled = true; }
      const open = OPEN_DAYS.has(d.date);
      out += dayHeadHTML(d, open) +
        '<div class="fx-daybody" data-body="' + esc(d.date) + '"' + (open ? "" : " hidden") + ">" +
        (d.matches || []).map(matchHTML).join("") + "</div>";
    });
    return out + "</div>";
  }

  /* ---------- the league panel: table, matches ---------- */

  const TABS = ["table", "matches"];

  /* Smart default, unchanged in spirit and only in shape: the scores lead when
     there is something live or freshly finished to lead with, otherwise the
     table, which is the thing that is true all week. It reads the flat match
     list now instead of a gameweek's `status`. */
  function defaultTab(m) {
    if (!m || !m.days || !m.days.length) return "table";
    const all = m.days.reduce((acc, d) => acc.concat(d.matches || []), []);
    if (all.some((x) => x.status === "LIVE")) return "matches";
    const recent = all.some((x) => {
      const t = Date.parse(x.kickoff);
      return x.status === "FINISHED" && !isNaN(t) && Date.now() - t < 26 * 3600 * 1000;
    });
    return recent ? "matches" : "table";
  }

  /* Rows from the mechanical file. The digest's `table` is only the archive's
     copy of the day now, and its note is retired. */
  let LEAGUE_TABLE = null;
  /* Ten rows is the whole European conversation plus a row of daylight; the
     other half of the table is a click away. Like OPEN_DAYS, the reader's
     choice outlives the repaint. */
  const TABLE_CUT = 10;
  let TABLE_OPEN = false;
  function leagueTable(d) {
    const own = d && d.table;
    if (!LEAGUE_TABLE || !LEAGUE_TABLE.rows || !LEAGUE_TABLE.rows.length) return own;
    return {
      competition: LEAGUE_TABLE.competition || (own && own.competition) || "",
      rows: LEAGUE_TABLE.rows,
    };
  }

  function leagueHTML(d, gw, m, active) {
    const all = m && m.days ? m.days.reduce((acc, x) => acc.concat(x.matches || []), []) : [];
    const live = all.some((x) => x.status === "LIVE");
    const tab = (k, label) =>
      '<button class="fc" data-tab="' + k + '" aria-pressed="' + String(k === active) + '">' + label + "</button>";
    const pane = (k, body) =>
      '<div class="tabpane" data-pane="' + k + '"' + (k === active ? "" : " hidden") + ">" + body + "</div>";

    return '<div class="panel" id="league">' +
      '<h3>The league' + (live ? ' <span class="tag hot">live</span>' : "") + "</h3>" +
      '<div class="filters tabs" role="tablist" aria-label="The league">' +
      tab("table", "Table") +
      tab("matches", "Matches") +
      "</div>" +
      pane("table", D.tableBody(leagueTable(d), { cut: TABLE_CUT, expanded: TABLE_OPEN }) ||
        '<p class="note">No table this week.</p>') +
      pane("matches", riverHTML(m)) +
      "</div>";
  }

  /* Day headers and the expand-all link. One delegated listener on the panel,
     because the pane is rebuilt wholesale on every live poll and per-header
     listeners would have to be re-attached each time anyway. */
  function wireRiver(root) {
    const panel = root.querySelector("#league");
    if (!panel) return;
    const setDay = (date, open) => {
      const head = panel.querySelector('.fx-dayhead[data-day="' + date + '"]');
      const body = panel.querySelector('.fx-daybody[data-body="' + date + '"]');
      if (!head || !body) return;
      head.setAttribute("aria-expanded", String(open));
      body.hidden = !open;
      if (open) OPEN_DAYS.add(date); else OPEN_DAYS.delete(date);
    };
    panel.addEventListener("click", (e) => {
      const head = e.target.closest(".fx-dayhead");
      if (head) {
        setDay(head.dataset.day, head.getAttribute("aria-expanded") !== "true");
        return;
      }
      const all = e.target.closest(".fx-more[data-days]");
      if (!all) return;
      const heads = [...panel.querySelectorAll(".fx-dayhead")];
      const open = heads.some((h) => h.getAttribute("aria-expanded") !== "true");
      heads.forEach((h) => setDay(h.dataset.day, open));
      all.textContent = open ? "Collapse all" : "Expand all";
    });
  }

  function wireTabs(root) {
    const panel = root.querySelector("#league");
    if (!panel) return;
    panel.querySelector(".filters").addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-tab]");
      if (!btn) return;
      const k = btn.dataset.tab;
      panel.querySelectorAll("button[data-tab]").forEach((b) =>
        b.setAttribute("aria-pressed", String(b.dataset.tab === k)));
      TABS.forEach((t) => {
        const p = panel.querySelector('[data-pane="' + t + '"]');
        if (p) p.hidden = t !== k;
      });
    });
  }

  async function main() {
    const el = $("#main");
    let data, players = { players: [] }, fpl = { verdicts: [] };
    try {
      data = await loadJSON("data/digests.json");
    } catch (e) {
      FA.fail(el, "The league page could not load. " + e.message);
      return;
    }
    // The card seam is a bonus, not a dependency: if the player file is
    // missing the page still renders, names simply stay plain text.
    try { players = await loadJSON("data/players.json"); } catch (e) { /* ignore */ }
    try { fpl = await loadJSON("data/fpl.json"); } catch (e) { /* ignore */ }
    // The standings, written straight from the source by split-league.mjs.
    // Optional on purpose: until the next brain run writes it, and on any day
    // the source is out, the page falls back to the digest's own table rather
    // than showing nothing.
    let table = null;
    try { table = await loadJSON("data/table.json"); } catch (e) { /* fall back below */ }
    FA.initPlayerCards(players.players, fpl.verdicts, FA.ME, fpl.signals);

    const entries = (data.digests || []).slice().sort((a, b) => b.date.localeCompare(a.date));
    if (!entries.length) {
      FA.fail(el, "No entries yet — run ./brain/curate.sh.");
      return;
    }
    LEAGUE_TABLE = table;
    const gw = (players && players.gameweek) || null;
    const latest = entries[0];

    const shell = (m, active) =>
      '<section class="section"><div class="section-head"><h2>touchline</h2>' +
      '<span class="mute" style="font-size:13px">what happened &mdash; the same for all five</span></div>' +
      '<div class="eyebrow">' + esc(D.fmtLong(latest.date)) + "</div>" +
      '<h2 class="digest-headline" style="font-size:clamp(21px,3.4vw,30px);margin:6px 0 18px">' +
      esc(latest.headline) + "</h2>" +
      leagueHTML(latest, gw, m, active) +
      D.weekHTML(latest) + D.aroundHTML(latest, gw) +
      D.rumoursHTML(latest) + D.linksHTML(latest) +
      (entries.length > 1
        ? '<p class="note" style="margin-top:16px">' + (entries.length - 1) +
          ' earlier ' + (entries.length === 2 ? "entry is" : "entries are") +
          ' kept in <a href="archive/">the archive</a>.</p>'
        : "") +
      "</section>";

    const paint = (m, active) => {
      el.innerHTML = shell(m, active);
      D.wireFilter(el);
      FA.wireSortable(el);
      D.wireTableCut(el, (open) => { TABLE_OPEN = open; });
      wireTabs(el);
      wireRiver(el);
    };

    paint(null, "table");
    FA.stamp(data.generated_at || (latest.date + "T08:00:00"));

    // Fixtures are the one thing on this page that can be wrong by the
    // minute, so they arrive after the page rather than holding it up.
    const load = async (firstRun) => {
      let m;
      try {
        const r = await fetch("/api/matches", { cache: "no-store" });
        if (!r.ok) throw new Error("HTTP " + r.status);
        m = await r.json();
      } catch (e) {
        const panel = el.querySelector("#league");
        if (panel && firstRun) {
          const pane = panel.querySelector(".tabpane[data-pane='matches']");
          if (pane) {
            pane.innerHTML = '<p class="note">The fixture feed is not answering right now. ' +
              "The table is unaffected.</p>";
          }
        }
        return;
      }
      const keep = el.querySelector("button[data-tab][aria-pressed='true']");
      paint(m, firstRun ? defaultTab(m) : (keep ? keep.dataset.tab : defaultTab(m)));
      // Only a live match earns a poll; a finished round is finished.
      const anyLive = (m.days || []).some((d) => (d.matches || []).some((x) => x.status === "LIVE"));
      if (anyLive) setTimeout(() => load(false), 60000);
    };
    load(true);
  }

  FA.initTheme();
  main();
})();
