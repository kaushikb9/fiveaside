/* touchline — what happened.
   =========================================================================
   The league room. Identical for all five: no squads, no verdicts, no
   personal state. If something here depends on who is reading it, it belongs
   in the gaffers room instead.

   Shows the LATEST digest entry only. Older entries keep accumulating in
   digests.json and are listed at /archive/ — nobody reads last fortnight's
   week-in-review on the way to this week's, so the fold that used to hold
   them was cost with no reader.

   The league sits in one panel with three tabs: the table, this match week,
   the next one. The table comes from digests.json (already local); the two
   match weeks come from /api/matches, and their absence costs the tab, never
   the page.
   ========================================================================= */
(function () {
  "use strict";
  const { esc, $, loadJSON } = FA;
  const D = FA.Digest;

  /* ---------- fixtures ---------- */

  const dayKey = (iso) => {
    const d = new Date(iso);
    return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
  };
  const clock = (iso) => {
    const d = new Date(iso);
    return isNaN(d.getTime()) ? "" : d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  };

  const side = (t, cls) =>
    '<span class="fx-team ' + cls + '">' +
    (cls === "away" ? D.crest(t.crest) : "") +
    '<b class="fx-full">' + esc(FA.club(t.name || "")) + "</b>" +
    '<b class="fx-abbr">' + esc(t.short || "") + "</b>" +
    (cls === "home" ? D.crest(t.crest) : "") + "</span>";

  /* FPL reports who scored but never when, so the line is names and counts —
     no invented clock. An own goal is credited to the side it helped, marked
     as one, because that is how a scoreline reads. */
  const goals = (list) =>
    (list || []).map((g) =>
      FA.linkPlayers(g.name) + (g.goals > 1 ? " (" + g.goals + ")" : "") +
      (g.og ? ' <span class="og">og</span>' : "")).join(", ");

  function statusHTML(f) {
    if (f.finished) return '<span class="fx-status">FT</span>';
    if (f.started) {
      const m = f.minutes >= 90 ? "90+" : f.minutes;
      return '<span class="fx-status live"><i></i>' + esc(m) + "'</span>";
    }
    return '<span class="fx-status">' + esc(clock(f.kickoff)) + "</span>";
  }

  function fixtureHTML(f) {
    const played = f.started;
    const score = played
      ? '<span class="fx-score">' + esc(f.home.score) + "<em>&ndash;</em>" + esc(f.away.score) + "</span>"
      : '<span class="fx-score pre">v</span>';
    const gh = goals(f.home.scorers);
    const ga = goals(f.away.scorers);
    const scorers = (gh || ga)
      ? '<div class="fx-goals"><span class="g h">' + gh + '</span><span></span><span class="g a">' + ga +
        "</span><span></span></div>"
      : "";
    return '<div class="fx' + (f.started && !f.finished ? " is-live" : "") + '">' +
      side(f.home, "home") + score + side(f.away, "away") + statusHTML(f) + scorers + "</div>";
  }

  function weekPaneHTML(week, kind) {
    if (!week) {
      return '<p class="note">' + (kind === "next"
        ? "The next match week has not been published yet."
        : "No match week is running.") + "</p>";
    }
    if (!week.fixtures.length) return '<p class="note">No fixtures in ' + esc(week.name) + ".</p>";
    const note = kind === "next"
      ? "Kick-offs in your own time zone. Nothing here has happened yet."
      : week.status === "live"
        ? "Scores update themselves while matches are on. Goalscorers arrive as the game does; the FPL feed carries no minutes."
        : "Final scores and goalscorers. The FPL feed carries no minutes, so the line is who, not when.";
    let out = '<p class="note">' + note + '</p><div class="fx-list">';
    let day = null;
    week.fixtures.forEach((f) => {
      const k = dayKey(f.kickoff);
      if (k !== day) { day = k; out += '<div class="fx-day">' + esc(k) + "</div>"; }
      out += fixtureHTML(f);
    });
    return out + "</div>";
  }

  /* ---------- the league panel: table, this week, next ---------- */

  const TABS = ["table", "now", "next"];

  /* Smart default: the scores lead only when there is something live or
     freshly finished to lead with. Otherwise the table — the thing that is
     true all week — holds the tab. */
  function defaultTab(m) {
    if (!m || !m.now) return "table";
    if (m.now.status === "live") return "now";
    const recent = m.now.fixtures.some((f) => {
      const t = Date.parse(f.kickoff);
      return f.finished && !isNaN(t) && Date.now() - t < 26 * 3600 * 1000;
    });
    return recent ? "now" : "table";
  }

  /* Rows from the mechanical file, note from the digest. The note is a reading
     of the table and readings are the brain's job; the rows are not. */
  let LEAGUE_TABLE = null;
  function leagueTable(d) {
    const own = d && d.table;
    if (!LEAGUE_TABLE || !LEAGUE_TABLE.rows || !LEAGUE_TABLE.rows.length) return own;
    return {
      competition: LEAGUE_TABLE.competition || (own && own.competition) || "",
      rows: LEAGUE_TABLE.rows,
      note: own && own.note,
    };
  }

  function leagueHTML(d, gw, m, active) {
    const gwc = (w) => (w ? ' <span class="gwchip">GW' + esc(w.gw) + "</span>" : "");
    const live = m && m.now && m.now.status === "live";
    const tab = (k, label) =>
      '<button class="fc" data-tab="' + k + '" aria-pressed="' + String(k === active) + '">' + label + "</button>";
    const pane = (k, body) =>
      '<div class="tabpane" data-pane="' + k + '"' + (k === active ? "" : " hidden") + ">" + body + "</div>";
    const pending = '<p class="note">Loading the fixtures&hellip;</p>';

    return '<div class="panel" id="league">' +
      '<h3>The league' + (live ? ' <span class="tag hot">live</span>' : "") + "</h3>" +
      '<div class="filters tabs" role="tablist" aria-label="The league">' +
      tab("table", "Table") +
      tab("now", "This match week" + gwc(m && m.now)) +
      tab("next", "Next match week" + gwc(m && m.next)) +
      "</div>" +
      pane("table", D.tableBody(leagueTable(d)) || '<p class="note">No table this week.</p>') +
      pane("now", m ? weekPaneHTML(m.now, "now") : pending) +
      pane("next", m ? weekPaneHTML(m.next, "next") : pending) +
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
      D.weekHTML(latest) + D.teamWatchHTML(latest) + D.aroundHTML(latest, gw) +
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
          panel.querySelectorAll(".tabpane[data-pane='now'], .tabpane[data-pane='next']").forEach((p) => {
            p.innerHTML = '<p class="note">The fixture feed is not answering right now. The table above is unaffected.</p>';
          });
        }
        return;
      }
      const keep = el.querySelector("button[data-tab][aria-pressed='true']");
      paint(m, firstRun ? defaultTab(m) : (keep ? keep.dataset.tab : defaultTab(m)));
      // Only a live match earns a poll; a finished week is finished.
      if (m.now && m.now.status === "live") setTimeout(() => load(false), 60000);
    };
    load(true);
  }

  FA.initTheme();
  main();
})();
