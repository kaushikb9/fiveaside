/* the locker room — what Ted knows.
   =========================================================================
   Every player there is evidence on, plus the injury room and the fixture
   runs. This is the reference layer: the other two rooms link into it and it
   links out to nothing.

   Reading order is verdict first, then the name, then one line of why —
   which is the order the verdict vocabulary was designed for. Evidence
   (price, ownership, points, fixtures) is mechanical and comes from
   players.json. The verdict is judgment and comes from fpl.json.
   ========================================================================= */
(function () {
  "use strict";
  const { esc, $, loadJSON, fdrStrip } = FA;

  let P = null, F = null, G = null;
  const verdicts = {};
  const owned = () => P.players.filter((p) => p.owned_by && p.owned_by.length);

  /* KB's call: >2% ownership, recalibratable. Anyone the five own is never
     dropped however low their ownership — Aït-Nouri is under 1% and starting. */
  let minOwn = 2;
  let filter = "nailed";
  let query = "";
  let fileLimit = 60;

  // A threshold of 0 means EVERYONE, including the 130-odd players nobody owns
  // at all. Using `> 0` there quietly excluded them and made "anyone" a lie.
  const inFile = (p) => minOwn === 0 || p.ownership > minOwn || (p.owned_by && p.owned_by.length);

  /* "ours" was the first chip and the default view. It went on 2026-08-27:
     who the five own is what the gaffers room is for, and a watchlist is now
     a thing you build by hand rather than a filter over everyone's squads.

     The file opens on *nailed* in its place. Opening on "everyone" made the
     first screen a 600-name list with no opinion in it; nailed is the shortest
     list we are willing to sign, which is the right thing to see first. */
  const FILTERS = {
    // Moved out of the gaffers room on 2026-08-28. It was a panel called
    // "What the crowd missed" that listed eight names and could not be
    // sorted, searched or crossed with a verdict. It is a QUESTION about the
    // player file — who is scoring while nobody owns them — so it belongs in
    // the file, where every other question about players already lives.
    differentials: (p) => p.ownership < 10 && p.points > 0,
    nailed: (p) => verdicts[p.id] && verdicts[p.id].verdict === "nailed",
    solid: (p) => verdicts[p.id] && verdicts[p.id].verdict === "solid",
    watch: (p) => verdicts[p.id] && verdicts[p.id].verdict === "watch",
    sack: (p) => verdicts[p.id] && verdicts[p.id].verdict === "sack",
    flagged: (p) => p.status && p.status !== "a",
    all: () => true,
  };
  const CHIPS = [
    ["nailed", "nailed"], ["solid", "solid"], ["watch", "watch"], ["sack", "sack"],
    ["differentials", "differentials"], ["flagged", "injured / doubtful"],
    ["all", "everyone"],
  ];
  const THRESHOLDS = [0, 1, 2, 3, 5, 10];

  const countAt = (t) =>
    t === 0
      ? P.players.length
      : P.players.filter((p) => p.ownership > t || (p.owned_by && p.owned_by.length)).length;

  /* ---------------- the file ---------------- */
  function fileHTML() {
    let list = P.players.filter(inFile).filter(FILTERS[filter]);
    if (query) {
      const q = query.toLowerCase();
      list = list.filter((p) =>
        p.name.toLowerCase().indexOf(q) !== -1 || p.team.toLowerCase().indexOf(q) !== -1);
    }
    const shown = list
      .sort((a, b) =>
        ((b.owned_by || []).length - (a.owned_by || []).length) || (b.ownership - a.ownership))
      .slice(0, fileLimit);

    const rows = shown.map((p) => {
      const v = verdicts[p.id];
      return '<tr>' +
        "<td>" + (v ? FA.vdChip(v) : '<span class="faint">&mdash;</span>') + "</td>" +
        "<td><strong><a class=\"plink\" data-pid=\"" + p.id + "\" data-player=\"" + esc(p.name) + "\">" +
          esc(p.name) + "</a></strong>" +
        FA.ownerDots(p.owned_by, FA.ME) +
        (p.penalties ? ' <span class="pill" title="on penalties">P</span>' : "") +
        (p.status && p.status !== "a"
          ? ' <span class="pill" style="color:var(--hot);border-color:var(--hot)" title="' +
            esc(p.news || "flagged") + '">!</span>' : "") +
        '<div class="row-sub">' +
          // A flagged player's news outranks his verdict here: "75% chance of
          // playing" is what you came to the row for. This is what lets the
          // injury room fold into the file as a filter rather than a table.
          (p.status && p.status !== "a" && p.news
            ? '<span style="color:var(--hot)">' + esc(p.news) + "</span>"
            : v ? esc(v.why)
            : esc(p.pos) + " &middot; " + esc(p.team) + " &middot; no verdict written yet") +
        "</div></td>" +
        '<td class="n">' + p.price.toFixed(1) + "</td>" +
        '<td class="n">' + p.ownership + "%</td>" +
        '<td class="n">' + p.points + "</td>" +
        // The row stays at three: five strips crowd it and the card is where you
        // go for the fuller picture.
        "<td>" + fdrStrip((p.fixtures || []).slice(0, 3)) + "</td></tr>";
    }).join("");

    const face = FA.faceSVG
      ? '<span class="coachface">' + FA.faceSVG(FA.COACH) + "</span>" : "";
    // His room, his verdicts. A face on the heading costs a line and makes
    // the column of judgments read as somebody's rather than nobody's.
    return '<div class="panel" id="the-file"><h3 class="withcoach">' + face +
      "The file</h3>" +
      '<div class="filters">' +
        CHIPS.map((c) =>
          '<button class="fc" data-f="' + c[0] + '" aria-pressed="' + (c[0] === filter) + '">' +
          esc(c[1]) + "</button>").join("") +
        '<input class="search" id="fq" aria-label="Search player name or club" placeholder="search name or club…" value="' + esc(query) + '">' +
      "</div>" +
      '<div class="filters" style="margin-bottom:15px">' +
        '<span class="flabel">Ownership over</span>' +
        THRESHOLDS.map((t) =>
          '<button class="fc" data-min="' + t + '" aria-pressed="' + (t === minOwn) + '">' +
          (t === 0 ? "anyone" : t + "%") + '<span class="faint"> &middot; ' + countAt(t) + "</span></button>").join("") +
      "</div>" +
      '<div class="scroll"><table class="sortable"><thead><tr><th>Verdict</th><th>Player</th>' +
      '<th class="n">Price</th><th class="n">Owned</th><th class="n">Points</th><th data-nosort>Next 3</th>' +
      "</tr></thead><tbody>" + (rows || '<tr><td colspan="6" class="faint">Nothing matches.</td></tr>') +
      "</tbody></table></div>" +
      (list.length > shown.length
        ? '<div class="tbl-more-wrap"><button class="tbl-more" data-file-more>Show next ' +
          Math.min(60, list.length - shown.length) + "</button></div>"
        : "") + FA.fdrKey +
      '<p class="note" style="margin-top:8px">' +
      (shown.length < list.length ? shown.length + " of " + list.length + " shown" : shown.length + " shown") +
      " &middot; " +
      countAt(minOwn) + " in the file at this threshold, of " + P.players.length +
      // "all 0 the five own are in whatever their ownership" — ungrammatical at
      // any count, and it read as a bug when a deadline lock briefly made the
      // number zero. Says it as the five would say it now.
      " &middot; the " + owned().length + " we own are always in, whatever their ownership." +
      "</p></div>";
  }

  /* ---------------- team radar ----------------
     Was "Team news" until 2026-08-28, when it had become a newsdesk: transfer
     bids, a Champions League draw, a club's pre-season travel. All true, all
     sourced, none of it any use to somebody picking a team. The panel is now
     club-level things that change the upcoming gameweek, and Ted has to
     write the FPL consequence — `action` — for each one or the run fails
     validation. That line is the point of the row, so it renders as the row,
     with what was reported underneath it. */
  function signalsHTML() {
    // Anything filed against a named player lives on that player's card,
    // where it is actually useful.
    const club = ((F && F.signals) || []).filter((s) => !s.player);
    if (!club.length) return "";
    return '<div class="panel"><h3>Team radar</h3>' +
      '<p class="note">Club-level, and only what moves a team sheet this gameweek.</p>' +
      '<div class="rows">' +
      club.map((s) =>
        '<div class="row"><div class="row-main"><div class="row-name">' +
        '<span class="wtag">' + esc(s.tag) + "</span>" + esc(s.team) +
        (s.action ? ' <span class="radar-do">' + FA.linkPlayers(s.action) + "</span>" : "") +
        "</div>" +
        '<div class="row-sub">' + FA.linkPlayers(s.text) +
        (s.source ? '<br><span class="faint">' + esc(s.source) +
          (s.url ? ' &middot; <a href="' + esc(s.url) + '" target="_blank" rel="noopener">source</a>' : "") +
          "</span>" : "") +
        "</div></div></div>").join("") +
      "</div></div>";
  }

  /* ---------------- fixture runs ---------------- */
  function runsHTML() {
    if (!F || !F.ticker || !F.ticker.rows) return "";
    const rows = F.ticker.rows.slice().sort((a, b) => a.avg - b.avg);
    const block = (title, sub, list, id) =>
      '<div class="panel"><h3>' + esc(title) + "</h3>" +
      '<p class="note">' + esc(sub) + "</p>" +
      '<div class="scroll"><table class="sortable"><thead><tr><th>Club</th><th class="n">Difficulty</th>' +
      '<th data-nosort>Next six</th></tr></thead><tbody>' +
      list.map((r) =>
        "<tr><td><strong>" + esc(r.team) + '</strong></td><td class="n">' + r.avg.toFixed(2) + "</td>" +
        "<td>" + fdrStrip(r.fixtures) + "</td></tr>").join("") +
      "</tbody></table></div></div>";
    return '<div class="grid2">' +
      block("Kindest runs", "Next six gameweeks, easiest first.", rows.slice(0, 6)) +
      block("Hardest runs", "Next six gameweeks, hardest first.", rows.slice(-6).reverse()) +
      "</div>";
  }

  /* ---------------- render ---------------- */
  function render() {
    $("#main").innerHTML =
      '<section class="section"><div class="section-head"><h2>the locker room</h2>' +
      '<span class="mute" style="font-size:13px">what ' + esc(FA.COACH) + ' knows &mdash; every player, evidence first</span></div>' +
      // Fixture runs lead: they are the thing you scan before deciding
      // anything, and they change slowest. Then the file, then the radar.
      runsHTML() + fileHTML() + signalsHTML() + "</section>";
    wire();
    FA.wireSortable($("#main"));
  }

  function wire() {
    document.querySelectorAll(".fc").forEach((b) => {
      b.onclick = () => {
        if (b.dataset.min !== undefined) minOwn = Number(b.dataset.min);
        else filter = b.dataset.f;
        fileLimit = 60;
        render();
      };
    });
    const fq = document.getElementById("fq");
    if (fq) {
      fq.oninput = (e) => {
        query = e.target.value;
        fileLimit = 60;
        const pos = e.target.selectionStart;
        render();
        const n = document.getElementById("fq");
        n.focus();
        n.setSelectionRange(pos, pos);
      };
    }
    const more = document.querySelector("[data-file-more]");
    if (more) {
      more.onclick = () => { fileLimit += 60; render(); };
    }
  }

  async function main() {
    const el = $("#main");
    try {
      P = await loadJSON("../data/players.json");
    } catch (e) {
      FA.fail(el, "The player file could not load. " + e.message);
      return;
    }
    try { F = await loadJSON("../data/fpl.json"); } catch (e) { F = null; }
    try { G = await loadJSON("../data/gaffers.json"); } catch (e) { G = null; }
    ((F && F.verdicts) || []).forEach((v) => { verdicts[v.id] = v; });

    FA.initPlayerCards(P.players, F && F.verdicts, FA.ME, F && F.signals);
    render();
    FA.stamp(P.generated_at, "data updated");
  }

  FA.initTheme();
  main();
})();
