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
     played. The calendar does not have that problem. */

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

  function riverHTML(m) {
    if (!m) return '<p class="note">Loading the fixtures&hellip;</p>';
    if (!m.days || !m.days.length) {
      // Six dead feeds still return 200, so say which rather than showing a
      // blank list and letting the reader assume there is no football on.
      return '<p class="note">No matches in this fortnight' +
        (m.errors && m.errors.length ? " (" + esc(m.errors.join(", ")) + ")" : "") + ".</p>";
    }
    const today = new Date().toISOString().slice(0, 10);
    let out = '<p class="note">Every competition, a week either side of today. Kick-offs in ' +
      "your time zone.</p>" + '<div class="fx-list">';
    let ruled = false;
    m.days.forEach((d) => {
      if (!ruled && d.date >= today) { out += '<div class="fx-today"><span>today</span></div>'; ruled = true; }
      out += '<div class="fx-day">' + esc(dayLabel(d.date)) + "</div>";
      (d.matches || []).forEach((x) => { out += matchHTML(x); });
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
      pane("table", D.tableBody(leagueTable(d)) || '<p class="note">No table this week.</p>') +
      pane("matches", riverHTML(m)) +
      "</div>";
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
      wireTabs(el);
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
