/* touchline — what happened.
   =========================================================================
   The league room. Identical for all five: no squads, no verdicts, no
   personal state. If something here depends on who is reading it, it belongs
   in the gaffers room instead.

   Reads site/data/digests.json (append-only, one entry per date). The player
   file and verdicts are loaded only to power the card seam — a player name
   anywhere here opens their locker-room card.
   ========================================================================= */
(function () {
  "use strict";
  const { esc, $, loadJSON, fdrStrip, linkPlayers } = FA;

  const fmtLong = (iso) => {
    const d = new Date(iso + "T00:00:00");
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString("en-GB", {
      weekday: "long", day: "numeric", month: "long", year: "numeric",
    });
  };
  const fmtShort = (iso) => {
    const d = new Date(iso + "T00:00:00");
    return isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  };

  const crest = (u, name) =>
    u ? '<img class="crest" src="' + esc(u) + '" alt="" loading="lazy">' : "";

  /* ---------- the league table ----------
     Focus is a rule, not a stored flag: three clubs are permanent, two are
     seeded until GW10, and after that the top six is earned. The `focus`
     field the brain writes is deliberately ignored so the rule is the single
     source of truth. */
  function tableHTML(d, gw) {
    const t = d.table;
    if (!t || !t.rows || !t.rows.length) return "";
    const focus = FA.focusClubs(gw, t.rows);
    const rows = t.rows.map((r) =>
      '<tr class="' + (focus.indexOf(r.team) !== -1 ? "focus" : "") + '" data-club="' + esc(r.team) + '">' +
      '<td class="n">' + esc(r.pos) + "</td>" +
      "<td>" + crest(r.crest, r.team) + esc(r.team) + "</td>" +
      '<td class="faint num">' + esc(r.form || "") + "</td>" +
      '<td class="n">' + esc(r.played) + "</td>" +
      '<td class="n"><strong>' + esc(r.points) + "</strong></td></tr>").join("");
    return '<div class="panel"><h3>' + esc(t.competition) + "</h3>" +
      '<p class="note">Bold clubs are the ones this page follows: ' +
      esc(FA.ALLEGIANCE.join(", ")) + " are permanent, and until GW" + FA.FOCUS_FROM_GW +
      " the other two are seeded because an early table is noise. From GW" + FA.FOCUS_FROM_GW +
      " it becomes the real top " + FA.FOCUS_TOP + ", recomputed every week.</p>" +
      (t.note ? '<p class="note">' + esc(t.note) + "</p>" : "") +
      '<div class="scroll"><table><thead><tr><th class="n">#</th><th>Club</th><th>Form</th>' +
      '<th class="n">P</th><th class="n">Pts</th></tr></thead><tbody>' + rows +
      "</tbody></table></div></div>";
  }

  /* ---------- the week: the primary feed ----------
     Around the top and Elsewhere are secondary by design. A story that leads
     here does not reappear below. */
  function weekHTML(d) {
    if (!d.week || !d.week.length) return "";
    const clubs = [];
    d.week.forEach((w) => { if (w.club && clubs.indexOf(w.club) === -1) clubs.push(w.club); });
    const bar = (d.week.some((w) => w.tag) || clubs.length)
      ? '<div class="filters" role="group" aria-label="Filter the week">' +
        '<button class="fc" data-filter="all" aria-pressed="true">All</button>' +
        '<button class="fc" data-filter="PL" aria-pressed="false">League</button>' +
        '<button class="fc" data-filter="FPL" aria-pressed="false">FPL</button>' +
        clubs.map((c) =>
          '<button class="fc" data-filter="club:' + esc(c) + '" aria-pressed="false">' + esc(c) + "</button>").join("") +
        "</div>"
      : "";
    const items = d.week.map((w) =>
      '<li data-tag="' + esc(w.tag || "PL") + '" data-club="' + esc(w.club || "") + '">' +
      '<span class="wtag ' + (w.tag === "FPL" ? "fpl" : "") + '">' + esc(w.tag || "PL") + "</span>" +
      "<strong>" + esc(w.kicker) + "</strong> " + linkPlayers(w.text) +
      (w.club ? '<span class="clubchip">' + esc(w.club) + "</span>" : "") + "</li>").join("");
    return '<div class="panel"><h3>This week</h3>' +
      '<p class="note">The league’s last seven days as one feed. One control narrows it and ' +
      "dims the table with it.</p>" + bar + '<ul class="feed">' + items + "</ul></div>";
  }

  function teamWatchHTML(d) {
    if (!d.team_watch || !d.team_watch.length) return "";
    return '<div class="panel"><h3>Team watch</h3>' +
      '<p class="note">Players worth knowing about. Every name opens their file.</p><div class="rows">' +
      d.team_watch.map((p) =>
        '<div class="row"><div class="row-main"><div class="row-name">' +
        linkPlayers(p.name) + ' <span class="pill">' + esc(p.tag) + "</span></div>" +
        '<div class="row-sub">' + esc(p.note) + "</div></div></div>").join("") +
      "</div></div>";
  }

  function aroundHTML(d, gw) {
    const focus = FA.focusClubs(gw, (d.table && d.table.rows) || []);
    const all = d.top_teams || d.rivals || [];
    const shown = all.filter((r) => focus.indexOf(r.club) !== -1);
    const dropped = all.filter((r) => focus.indexOf(r.club) === -1).map((r) => r.club);
    const one = (r) =>
      '<div class="row"><div class="row-main"><div class="row-name">' +
      crest(r.crest, r.club) + esc(r.club) + "</div>" +
      '<div class="row-sub">' + linkPlayers(r.note) + "</div></div>" +
      (r.line ? '<div class="row-side">' + esc(r.line) + "</div>" : "") + "</div>";

    const left = shown.length
      ? '<div class="panel"><h3>Around the top</h3>' +
        '<p class="note">One line each for the clubs this page follows, written as a league ' +
        "view: no us, no them. Secondary to the week above.</p>" +
        '<div class="rows">' + shown.map(one).join("") + "</div>" +
        (dropped.length
          ? '<p class="note" style="margin:12px 0 0">Not covered this week: ' +
            dropped.map(esc).join(", ") + " &mdash; they return automatically once they are in the top " +
            FA.FOCUS_TOP + " from GW" + FA.FOCUS_FROM_GW + ".</p>"
          : "") + "</div>"
      : "";

    const rest = (d.elsewhere || []).map(one).join("");
    const right = rest
      ? '<div class="panel"><h3>Elsewhere</h3>' +
        '<p class="note">The league is more than six clubs.</p><div class="rows">' + rest + "</div></div>"
      : "";
    if (!left && !right) return "";
    return '<div class="grid2">' + left + right + "</div>";
  }

  const HEAT = { done: "done", "here we go": "done", close: "close", talks: "talks", smoke: "smoke" };
  function rumoursHTML(d) {
    if (!d.rumours || !d.rumours.length) return "";
    return '<div class="panel"><h3>Rumour mill</h3><div class="rows">' +
      d.rumours.map((r) =>
        '<div class="row"><div class="row-main"><div class="row-name">' + linkPlayers(r.player) + "</div>" +
        '<div class="row-sub">' + esc(r.from) + " &rarr; " + esc(r.to) +
        (r.fee ? " &middot; " + esc(r.fee) : "") + " &middot; " + esc(r.note) + "</div></div>" +
        '<div class="row-side"><span class="heat ' + (HEAT[r.heat] || "smoke") + '">' +
        esc(r.heat) + "</span></div></div>").join("") +
      "</div></div>";
  }

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

  function linksHTML(d) {
    const items = [];
    if (d.read) items.push(d.read);
    (d.wider || []).forEach((w) => items.push(w));
    if (!items.length) return "";
    return '<div class="panel"><h3>Worth the click</h3>' +
      '<p class="note">One good read, and the rest of the week’s writing.</p>' +
      '<div class="cards">' + items.map(linkCard).join("") + "</div></div>";
  }

  function entryHTML(d, gw) {
    return '<div class="eyebrow">' + esc(fmtLong(d.date)) + "</div>" +
      "<h2 style=\"font-size:clamp(21px,3.4vw,30px);margin:6px 0 18px\">" + esc(d.headline) + "</h2>" +
      tableHTML(d, gw) + weekHTML(d) + teamWatchHTML(d) + aroundHTML(d, gw) +
      rumoursHTML(d) + linksHTML(d);
  }

  /* One control, two effects: it narrows the feed and dims the table, so the
     page reads as one thing rather than a page with a widget on it. */
  function wireFilter(scope) {
    const bar = scope.querySelector(".filters");
    if (!bar) return;
    bar.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-filter]");
      if (!btn) return;
      bar.querySelectorAll(".fc").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
      const f = btn.dataset.filter;
      scope.querySelectorAll("ul.feed > li").forEach((li) => {
        const show = f === "all" ||
          (f.indexOf("club:") === 0 ? li.dataset.club === f.slice(5) : li.dataset.tag === f);
        li.hidden = !show;
      });
      scope.querySelectorAll("tbody tr[data-club]").forEach((tr) => {
        tr.classList.toggle("dim", f.indexOf("club:") === 0 && tr.dataset.club !== f.slice(5));
      });
    });
  }

  async function main() {
    const main = $("#main");
    let data, players = { players: [] }, fpl = { verdicts: [] };
    try {
      data = await loadJSON("data/digests.json");
    } catch (e) {
      FA.fail(main, "The league page could not load. " + e.message);
      return;
    }
    // The card seam is a bonus, not a dependency: if the player file is
    // missing the page still renders, names simply stay plain text.
    try { players = await loadJSON("data/players.json"); } catch (e) { /* ignore */ }
    try { fpl = await loadJSON("data/fpl.json"); } catch (e) { /* ignore */ }
    FA.initPlayerCards(players.players, fpl.verdicts, FA.ME);

    const entries = (data.digests || []).slice().sort((a, b) => b.date.localeCompare(a.date));
    if (!entries.length) {
      FA.fail(main, "No entries yet — run ./brain/curate.sh.");
      return;
    }
    const gw = (players && players.gameweek) || null;
    const latest = entries[0];
    const past = entries.slice(1);

    main.innerHTML =
      '<section class="section"><div class="section-head"><h2>touchline</h2>' +
      '<span class="mute" style="font-size:13px">what happened &mdash; the same for all five</span></div>' +
      entryHTML(latest, gw) + "</section>" +
      (past.length
        ? '<section class="section"><div class="section-head"><h2>Earlier</h2>' +
          '<span class="tag ghost">' + past.length + " entries</span></div>" +
          past.map((d) =>
            '<details class="fold"><summary>' + esc(fmtShort(d.date)) + " &middot; " +
            esc(d.headline) + '</summary><div class="foldbody">' + entryHTML(d, gw) +
            "</div></details>").join("") + "</section>"
        : "");

    wireFilter(main);
    // Archived entries carry their own filter bar; wire each one on open.
    main.querySelectorAll("details.fold").forEach((el) => {
      el.addEventListener("toggle", function once() {
        if (el.open) { wireFilter(el); el.removeEventListener("toggle", once); }
      });
    });
    FA.stamp(data.generated_at || (latest.date + "T08:00:00"));
  }

  FA.initTheme();
  main();
})();
