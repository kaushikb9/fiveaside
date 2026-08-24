/* the locker room — what we know.
   =========================================================================
   Every player we hold evidence on, plus the injury room and the fixture
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
  let filter = "ours";
  let query = "";

  // A threshold of 0 means EVERYONE, including the 130-odd players nobody owns
  // at all. Using `> 0` there quietly excluded them and made "anyone" a lie.
  const inFile = (p) => minOwn === 0 || p.ownership > minOwn || (p.owned_by && p.owned_by.length);

  const FILTERS = {
    ours: (p) => p.owned_by && p.owned_by.length,
    nailed: (p) => verdicts[p.id] && verdicts[p.id].verdict === "nailed",
    solid: (p) => verdicts[p.id] && verdicts[p.id].verdict === "solid",
    watch: (p) => verdicts[p.id] && verdicts[p.id].verdict === "watch",
    sack: (p) => verdicts[p.id] && verdicts[p.id].verdict === "sack",
    flagged: (p) => p.status && p.status !== "a",
    all: () => true,
  };
  const CHIPS = [
    ["ours", "ours"], ["nailed", "nailed"], ["solid", "solid"], ["watch", "watch"],
    ["sack", "sack"], ["flagged", "flagged"], ["all", "everyone"],
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
      .slice(0, 60);

    const rows = shown.map((p) => {
      const v = verdicts[p.id];
      return '<tr>' +
        "<td>" + (v ? FA.vdChip(v) : '<span class="faint">&mdash;</span>') + "</td>" +
        "<td><strong><a class=\"plink\" data-player=\"" + esc(p.name) + "\">" + esc(p.name) + "</a></strong>" +
        FA.ownerDots(p.owned_by, FA.ME) +
        (p.penalties ? ' <span class="pill" title="on penalties">P</span>' : "") +
        (p.status && p.status !== "a"
          ? ' <span class="pill" style="color:var(--hot);border-color:var(--hot)" title="' +
            esc(p.news || "flagged") + '">!</span>' : "") +
        '<div class="row-sub">' +
          (v ? esc(v.why) : esc(p.pos) + " &middot; " + esc(p.team) + " &middot; no verdict written yet") +
        "</div></td>" +
        '<td class="n">' + p.price.toFixed(1) + "</td>" +
        '<td class="n">' + p.ownership + "%</td>" +
        '<td class="n">' + p.points + "</td>" +
        // The row stays at three: five strips crowd it and the card is where you
        // go for the fuller picture.
        "<td>" + fdrStrip((p.fixtures || []).slice(0, 3)) + "</td></tr>";
    }).join("");

    return '<div class="panel" id="the-file"><h3>The file</h3>' +
      '<p class="note">Every player we hold evidence on. Verdict first, then the name, then one ' +
      "line of why. The verdict is judgment; everything else on the row is measured.</p>" +
      '<div class="filters">' +
        CHIPS.map((c) =>
          '<button class="fc" data-f="' + c[0] + '" aria-pressed="' + (c[0] === filter) + '">' +
          esc(c[1]) + "</button>").join("") +
        '<input class="search" id="fq" placeholder="search name or club…" value="' + esc(query) + '">' +
      "</div>" +
      '<div class="filters" style="margin-bottom:15px">' +
        '<span class="flabel">Owned by more than</span>' +
        THRESHOLDS.map((t) =>
          '<button class="fc" data-min="' + t + '" aria-pressed="' + (t === minOwn) + '">' +
          (t === 0 ? "anyone" : t + "%") + '<span class="faint"> &middot; ' + countAt(t) + "</span></button>").join("") +
      "</div>" +
      '<div class="scroll"><table class="sortable"><thead><tr><th>Verdict</th><th>Player</th>' +
      '<th class="n">£</th><th class="n">Own</th><th class="n">Pts</th><th data-nosort>Next three</th>' +
      "</tr></thead><tbody>" + (rows || '<tr><td colspan="6" class="faint">Nothing matches.</td></tr>') +
      "</tbody></table></div>" + FA.fdrKey +
      '<p class="note" style="margin-top:8px">' + shown.length + " shown &middot; " +
      countAt(minOwn) + " in the file at this threshold, of " + P.players.length +
      " &middot; all " + owned().length + " the five own are in whatever their ownership.</p></div>";
  }

  /* ---------------- injury room ----------------
     Reference, not a decision: it sits below the file because it is for
     keeping an eye on returns, not for picking anyone. */
  function injuryHTML() {
    const flagged = P.players.filter((p) => p.status && p.status !== "a" && p.news)
      .sort((a, b) =>
        ((b.owned_by || []).length - (a.owned_by || []).length) || (b.ownership - a.ownership));
    const ours = flagged.filter((p) => p.owned_by && p.owned_by.length);
    const rest = flagged.filter((p) => !(p.owned_by && p.owned_by.length)).slice(0, 12);
    const STATUS = { i: "out", d: "doubt", u: "gone", s: "suspended", n: "ineligible" };
    const one = (p) =>
      '<div class="row"><div class="row-main"><div class="row-name">' +
      '<a class="plink" data-player="' + esc(p.name) + '">' + esc(p.name) + "</a>" +
      FA.ownerDots(p.owned_by, FA.ME) + "</div>" +
      '<div class="row-sub">' + esc(p.news) + "</div></div>" +
      '<div class="row-side"><span class="pill" style="color:var(--hot);border-color:var(--hot)">' +
      esc(STATUS[p.status] || p.status) + "</span><br>" + esc(p.team) + " &middot; " + p.ownership + "%</div></div>";

    return '<div class="panel"><h3>Injury room</h3>' +
      '<p class="note">' + flagged.length + " players are flagged right now. The ones the five own " +
      "come first; everything else is noise until it is cheap enough to matter.</p>" +
      '<h4 class="eyebrow" style="margin:4px 0 4px">Ours (' + ours.length + ")</h4>" +
      '<div class="rows">' + (ours.length ? ours.map(one).join("")
        : '<div class="row"><div class="row-main faint">Nobody we own is flagged.</div></div>') + "</div>" +
      '<h4 class="eyebrow" style="margin:18px 0 4px">Everyone else, most-owned first</h4>' +
      '<div class="rows">' + rest.map(one).join("") + "</div></div>";
  }

  /* ---------------- team news ----------------
     Judgment, and marked as such: the brain writes these from sources it
     actually fetched, and each carries where it came from so a claim can be
     checked rather than trusted. */
  function signalsHTML() {
    if (!F || !F.signals || !F.signals.length) return "";
    return '<div class="panel"><h3>Team news</h3>' +
      '<p class="note">Written by the editor from fetched sources, not measured &mdash; ' +
      "each one says where it came from.</p><div class=\"rows\">" +
      F.signals.map((s) =>
        '<div class="row"><div class="row-main"><div class="row-name">' +
        '<span class="wtag">' + esc(s.tag) + "</span>" +
        (s.player ? FA.linkPlayers(s.player) + " &middot; " : "") + esc(s.team) + "</div>" +
        '<div class="row-sub">' + FA.linkPlayers(s.text) +
        (s.action ? ' <strong>' + esc(s.action) + "</strong>" : "") +
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
    const from = F.ticker.from_gw, to = from + F.ticker.gws - 1;
    const block = (title, sub, list, id) =>
      '<div class="panel"><h3>' + esc(title) + "</h3>" +
      '<p class="note">' + esc(sub) + "</p>" +
      '<div class="scroll"><table class="sortable"><thead><tr><th>Club</th><th class="n">Avg</th>' +
      '<th data-nosort>GW' + from + "&ndash;" + to + "</th></tr></thead><tbody>" +
      list.map((r) =>
        "<tr><td><strong>" + esc(r.team) + '</strong></td><td class="n">' + r.avg.toFixed(2) + "</td>" +
        "<td>" + fdrStrip(r.fixtures) + "</td></tr>").join("") +
      "</tbody></table></div></div>";
    return '<div class="grid2">' +
      block("Kindest runs", "Six gameweeks out, lowest average difficulty first.", rows.slice(0, 6)) +
      block("Hardest runs", "Where not to buy, however good the last two weeks looked.", rows.slice(-6).reverse()) +
      "</div>";
  }

  /* ---------------- render ---------------- */
  function render() {
    $("#main").innerHTML =
      '<section class="section"><div class="section-head"><h2>the locker room</h2>' +
      '<span class="mute" style="font-size:13px">what we know &mdash; every player, evidence first</span></div>' +
      fileHTML() + injuryHTML() + signalsHTML() + runsHTML() + "</section>";
    wire();
    FA.wireSortable($("#main"));
  }

  function wire() {
    document.querySelectorAll(".fc").forEach((b) => {
      b.onclick = () => {
        if (b.dataset.min !== undefined) minOwn = Number(b.dataset.min);
        else filter = b.dataset.f;
        render();
      };
    });
    const fq = document.getElementById("fq");
    if (fq) {
      fq.oninput = (e) => {
        query = e.target.value;
        const pos = e.target.selectionStart;
        render();
        const n = document.getElementById("fq");
        n.focus();
        n.setSelectionRange(pos, pos);
      };
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

    FA.initPlayerCards(P.players, F && F.verdicts, FA.ME);
    render();
    FA.stamp(P.generated_at);
  }

  FA.initTheme();
  main();
})();
