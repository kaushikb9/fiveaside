/* archive — every entry that is no longer the latest.
   =========================================================================
   The home page shows one entry because nobody reads backwards through a
   week-in-review. The entries are still written, still appended, still worth
   keeping — they live here, folded shut, newest first.

   Rendering is FA.Digest, the same code the home page uses, so an entry from
   July draws exactly as this week's does.
   ========================================================================= */
(function () {
  "use strict";
  const { esc, $, loadJSON } = FA;
  const D = FA.Digest;

  async function main() {
    const el = $("#main");
    let data, players = { players: [] }, fpl = { verdicts: [] };
    try {
      data = await loadJSON("../data/digests.json");
    } catch (e) {
      FA.fail(el, "The archive could not load. " + e.message);
      return;
    }
    try { players = await loadJSON("../data/players.json"); } catch (e) { /* ignore */ }
    try { fpl = await loadJSON("../data/fpl.json"); } catch (e) { /* ignore */ }
    FA.initPlayerCards(players.players, fpl.verdicts, FA.ME, fpl.signals);

    const entries = (data.digests || []).slice().sort((a, b) => b.date.localeCompare(a.date));
    const past = entries.slice(1);
    const gw = (players && players.gameweek) || null;

    if (!past.length) {
      el.innerHTML =
        '<section class="section"><div class="section-head"><h2>archive</h2></div>' +
        '<div class="panel"><p class="note">Nothing here yet — the only entry written is the ' +
        'current one, and it is on <a href="../">touchline</a>.</p></div></section>';
      FA.stamp(data.generated_at, "editorial updated");
      return;
    }

    el.innerHTML =
      '<section class="section"><div class="section-head"><h2>archive</h2>' +
      '<span class="tag ghost">' + past.length + " entries</span></div>" +
      past.map((d) =>
        '<details class="fold"><summary>' + esc(D.fmtShort(d.date)) + " &middot; " +
        esc(d.headline) + '</summary><div class="foldbody">' + D.entryHTML(d, gw) +
        "</div></details>").join("") +
      "</section>";

    // An entry's filter bar and sortable table only matter once it is open.
    el.querySelectorAll("details.fold").forEach((entry) => {
      entry.addEventListener("toggle", function once() {
        if (!entry.open) return;
        D.wireFilter(entry);
        FA.wireSortable(entry);
        entry.removeEventListener("toggle", once);
      });
    });

    FA.stamp(data.generated_at || (entries[0].date + "T08:00:00"), "editorial updated");
  }

  FA.initTheme();
  main();
})();
