/* the gaffers — what we did about it.
   =========================================================================
   Five squads, five weeks, one mini-league. Everything here is about the
   five; the league itself lives in touchline.

   Mechanical facts (squads, picks, points, chips) come from gaffers.json and
   are never written by the brain. Judgment (the weekly read, the watchlist
   notes, the roast) comes from fpl.json and is always marked as judgment.
   ========================================================================= */
(function () {
  "use strict";
  const { esc, $, loadJSON, gname, fdrStrip } = FA;

  let G = null, P = null, F = null;
  let who = FA.ME;
  let gwView = null;
  // Live gameweek state, fetched on demand from /api/live. Keyed by element
  // so the pitch can prefer it over the snapshot in gaffers.json.
  let live = null, liveFor = null, liveBusy = false;
  let session = null;

  const byId = {};
  const pool = () => P.players;
  const rec = (id) => byId[id];

  const CHIP_NAME = {
    bboost: "Bench Boost", "3xc": "Triple Captain",
    freehit: "Free Hit", wildcard: "Wildcard",
  };

  /* ---------------- the headline ----------------
     One fact about these five, ranked. Every candidate carries a number, so
     this cannot decay into "an exciting week of football". If nothing clears
     the bar, nothing renders. */
  function headlineHTML() {
    const people = G.people;
    const cand = [];
    const sorted = people.slice().sort((a, b) => b.total_points - a.total_points);

    people.filter((p) => p.active_chip).forEach((p) => {
      const lead = sorted[0];
      cand.push({
        score: 100, kicker: "Chip played", nick: p.nick,
        text: p.nick + " played the " + (CHIP_NAME[p.active_chip] || p.active_chip) +
          " in the opening week — " + p.total_points + " points, " +
          (lead.nick === p.nick ? "top of the five" : (lead.total_points - p.total_points) + " behind " + lead.nick) +
          ", and " + (p.bench_points === 0 ? "nothing left on the bench" : p.bench_points + " off the bench") + ".",
        sub: (people.length - 1) + " of the five still have theirs. First-half chips expire at GW19.",
      });
    });

    const caps = {};
    people.forEach((p) => {
      const c = (p.picks || []).find((x) => x.captain);
      if (c) (caps[c.name] = caps[c.name] || []).push(p.nick);
    });
    const split = Object.keys(caps).map((n) => [n, caps[n]]).sort((a, b) => b[1].length - a[1].length);
    if (split.length > 1) {
      const top = split[0];
      const others = split.slice(1).map((s) => ({
        n: s[0], who: s[1], pts: (pool().find((q) => q.name === s[0]) || {}).points || 0,
      })).sort((a, b) => b.pts - a.pts)[0];
      const topPts = (pool().find((q) => q.name === top[0]) || {}).points || 0;
      cand.push({
        score: 70 + Math.abs(topPts - others.pts) * 3, kicker: "Captaincy split",
        text: top[1].length + " of the five captained " + top[0] + " for " + topPts * 2 + "; " +
          others.who.join(" and ") + " went " + others.n + " for " + others.pts * 2 + ".",
        sub: "A " + Math.abs(topPts - others.pts) * 2 + "-point swing on one decision.",
      });
    }

    const worst = people.filter((p) => !p.active_chip)
      .sort((a, b) => (b.bench_points || 0) - (a.bench_points || 0))[0];
    if (worst && worst.bench_points >= 5) {
      const passed = people.filter((p) =>
        p.total_points > worst.total_points && p.total_points <= worst.total_points + worst.bench_points)
        .map((p) => p.nick);
      cand.push({
        score: 40 + worst.bench_points, kicker: "Left on the bench", nick: worst.nick,
        text: worst.nick + " left " + worst.bench_points + " points on the bench.",
        sub: "Enough to have moved them past " + (passed.join(" and ") || "nobody, as it turns out") + ".",
      });
    }

    if (sorted.length > 1) {
      cand.push({
        score: 10, kicker: "The five", nick: sorted[0].nick,
        text: sorted[0].nick + " leads the five on " + sorted[0].total_points + ", " +
          (sorted[0].total_points - sorted[1].total_points) + " clear of " + sorted[1].nick + ".",
        sub: "",
      });
    }

    const best = cand.sort((a, b) => b.score - a.score)[0];
    if (!best) return "";
    // The portrait belongs to whoever the headline is ABOUT, not to whoever
    // is selected — a face next to a sentence about someone else is a lie.
    // The captaincy split has no single subject, so it gets no face.
    return '<div class="ghead' + (best.nick ? " haface" : "") + '">' +
      (best.nick ? '<span class="hface">' + FA.faceSVG(best.nick) + "</span>" : "") +
      '<div><div class="gk">' + esc(best.kicker) + "</div><p>" +
      gname(best.text) + "</p>" +
      (best.sub ? '<div class="gsub">' + gname(best.sub) + "</div>" : "") + "</div></div>";
  }

  /* ---------------- the long game ----------------
     A standing guard against reading one weekend as a season. It renders on
     real evidence — how much of the table is still matchday-one noise — and
     retires itself once there is enough football to argue from. */
  const SETTLED_FROM_GW = 6;
  function longGameHTML() {
    const gw = G.live_gameweek ? G.live_gameweek.id : G.gameweek;
    if (!gw || gw >= SETTLED_FROM_GW) return "";
    const played = pool().filter((p) => p.points > 0).length;
    const spread = G.people.map((p) => p.total_points).sort((a, b) => a - b);
    const gap = spread[spread.length - 1] - spread[0];
    return '<div class="panel" style="border-left:4px solid var(--warn)">' +
      "<h3>It is gameweek " + gw + "</h3>" +
      '<p class="note" style="margin-bottom:0">The whole five are separated by ' + gap +
      " points, which is one captain and a late goal. Upsets and stoppage-time returns are " +
      "doing most of the work in these numbers, and " + played + " players have scored anything at all. " +
      "Nothing here is evidence yet: a verdict written this week is a hypothesis with a trigger " +
      "attached, not a conclusion. This box retires itself at GW" + SETTLED_FROM_GW + ".</p></div>";
  }

  /* ---------------- gaffer chips ---------------- */
  function barHTML() {
    // Ordered by where they actually are, not by the order in config. The
    // league rank is the honest sort; fall back to points when a rank is
    // missing (someone who has not entered yet).
    const ordered = G.people.slice().sort((a, b) =>
      (a.league_rank == null ? 99 : a.league_rank) - (b.league_rank == null ? 99 : b.league_rank) ||
      b.total_points - a.total_points);
    // The face is what you aim at; the numbers are what you read once you
    // have. The club dot went with the portrait — the caricature already
    // says who this is, and two identity marks on one chip is one too many.
    return '<div class="gbar" id="gbar">' + ordered.map((p) =>
      '<button class="gchip" data-nick="' + esc(p.nick) + '" aria-pressed="' + (p.nick === who) + '">' +
      '<span class="gface">' + FA.faceSVG(p.nick) + "</span>" +
      '<span class="gmeta"><b>' + esc(p.nick) + "</b>" +
      '<span class="gteam">' + esc(p.team_name) + "</span>" +
      '<span class="gpts">' + p.total_points + " pts &middot; " +
        (p.league_rank == null ? "&mdash;" : "#" + p.league_rank) + "</span></span></button>").join("") +
      "</div>";
  }

  /* ---------------- live gameweek ----------------
     gaffers.json is a snapshot taken when the facts last ran; during a
     gameweek it goes stale within minutes. /api/live proxies the official
     API (which sends no CORS headers) and returns per-player points with
     provisional bonus. Fetched only when asked for — no polling. */
  async function refreshLive() {
    const p = G.people.find((x) => x.nick === who);
    if (!p || !p.entry) return;
    liveBusy = true; render();
    try {
      const r = await fetch("/api/live?gw=" + LIVE_GW() + "&entry=" + p.entry, { cache: "no-store" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const d = await r.json();
      const byEl = {};
      (d.squad || []).forEach((x) => { if (x.element) byEl[x.element] = x; });
      // Match on name when the proxy does not echo the element id back.
      const byName = {};
      (d.squad || []).forEach((x) => { byName[x.name] = x; });
      live = { gw: d.gw, status: d.status, updated: d.updated, fixtures: d.fixtures || [],
               totals: d.totals || null, byEl: byEl, byName: byName };
      liveFor = who;
    } catch (e) {
      live = { error: e.message };
      liveFor = who;
    }
    liveBusy = false;
    render();
  }

  const livePlayer = (pk) =>
    (live && !live.error && liveFor === who)
      ? (live.byEl[pk.element] || live.byName[pk.name] || null)
      : null;

  function liveHTML() {
    if (!live) {
      return '<div class="panel"><h3>Live gameweek</h3>' +
        '<p class="note">Squad points below are a snapshot from the last data run. ' +
        "Pull the live scores when a gameweek is in play.</p>" +
        '<button class="btn-live fc" data-live>' +
        (liveBusy ? "fetching…" : "Fetch live scores") + "</button></div>";
    }
    if (live.error) {
      return '<div class="panel"><h3>Live gameweek</h3>' +
        '<p class="note">Live scores unavailable (' + esc(live.error) + '). The snapshot below still stands.</p>' +
        '<button class="btn-live fc" data-live>try again</button></div>';
    }
    const inPlay = live.fixtures.filter((f) => f.started && !f.finished);
    const done = live.fixtures.filter((f) => f.finished).length;
    const fx = (f) =>
      '<div class="row"><div class="row-main"><div class="row-name">' +
      esc(f.home) + " " + f.home_score + "&ndash;" + f.away_score + " " + esc(f.away) + "</div>" +
      '<div class="row-sub">' + (f.finished ? "full time" : f.started ? f.minutes + "&prime;" : "not started") +
      "</div></div></div>";
    return '<div class="panel"><h3>Live gameweek ' + live.gw + "</h3>" +
      '<p class="note">' + done + " of " + live.fixtures.length + " matches finished" +
      (inPlay.length ? ", " + inPlay.length + " in play" : "") +
      ". Points on the pitch below are live, including provisional bonus.</p>" +
      '<p class="note" style="margin-top:-6px">The total in the pitch header is the one to read: ' +
      "the proxy&rsquo;s own net counts starters only and does not know a bench was boosted.</p>" +
      (inPlay.length ? '<div class="rows">' + inPlay.map(fx).join("") + "</div>" : "") +
      '<button class="btn-live fc" data-live style="margin-top:10px">' +
      (liveBusy ? "refreshing…" : "Refresh") + "</button></div>";
  }

  /* ---------------- the pitch ---------------- */
  const LIVE_GW = () => (G.live_gameweek ? G.live_gameweek.id : G.gameweek);
  const curGW = () => (gwView == null ? LIVE_GW() : gwView);
  const fixtureFor = (r, gw) => (r && r.fixtures ? r.fixtures.find((f) => f.gw === gw) : null) || null;

  function pitchPlayer(pk, gw) {
    const r = rec(pk.element);
    const fx = fixtureFor(r, gw);
    const settled = gw < LIVE_GW(), live = gw === LIVE_GW();
    // multiplier: 0 benched, 2 captain, 3 triple captain, 1 a bench slot that
    // Bench Boost switched on. A benched player still shows what he scored —
    // the regret is the point.
    const lv = livePlayer(pk);
    const mult = pk.multiplier == null ? 1 : pk.multiplier;
    // Live points already include provisional bonus; fall back to the snapshot.
    const raw = lv ? lv.points : (r ? r.points : 0);
    let bar = "&mdash;", cls = "";
    if (settled || live) {
      bar = raw * (mult > 1 ? mult : 1) + (mult > 1 ? " &times;" + mult : "");
    } else if (fx) {
      bar = (fx.home ? "" : "@") + esc(fx.opp);
      cls = " f" + fx.fdr;
    }
    return '<div class="pp">' +
      (pk.captain ? '<span class="arm" title="Captain">C</span>' : "") +
      (pk.vice && !pk.captain ? '<span class="arm v" title="Vice-captain">V</span>' : "") +
      (r && r.status && r.status !== "a" ? '<span class="dot" title="Flagged"></span>' : "") +
      FA.kitSVG(pk.team, pk.pos === "GK") +
      '<a class="nb" data-player="' + esc(pk.name) + '">' + esc(pk.name) + "</a>" +
      '<div class="vb' + cls + '">' + bar + "</div></div>";
  }

  function pitchHTML() {
    const p = G.people.find((x) => x.nick === who);
    const gw = curGW(), live = gw === LIVE_GW(), settled = gw < LIVE_GW();
    const xi = p.picks.filter((x) => x.role !== "bench");
    const bench = p.picks.filter((x) => x.role === "bench");
    const rows = ["GK", "DEF", "MID", "FWD"].map((pos) => xi.filter((x) => x.pos === pos));
    const shape = rows.slice(1).map((r) => r.length).join("-");

    const scored = (list) => list.reduce((n, x) => {
      const lv = livePlayer(x);
      const r = rec(x.element);
      const pts = lv ? lv.points : (r ? r.points : 0);
      const m = x.multiplier == null ? 1 : x.multiplier;
      return n + pts * (m > 1 ? m : 1);
    }, 0);
    const total = (settled || live) ? scored(xi) : null;
    // Two different questions. Normally the bench is REGRET and the API's
    // points_on_bench is the answer. Under Bench Boost the bench SCORED and
    // that field reads 0, so the contribution has to be summed instead.
    const boosted = p.active_chip === "bboost";
    const benchPts = (settled || live) ? (boosted ? scored(bench) : (p.bench_points || 0)) : null;

    const fixtures = xi.map((x) => fixtureFor(rec(x.element), gw)).filter(Boolean);
    const avgFdr = fixtures.length
      ? (fixtures.reduce((n, f) => n + f.fdr, 0) / fixtures.length).toFixed(2) : null;

    const chip = p.active_chip ? (CHIP_NAME[p.active_chip] || p.active_chip) : null;
    // Walk forward as far as the fixture data actually reaches, rather than
    // guessing an offset — the fixture list starts from the gameweek being
    // so a fixed LIVE_GW+2 stopped one week short of what was on disk.
    const GW_MAX = pool().reduce((m, pl) =>
      (pl.fixtures || []).reduce((n, f) => Math.max(n, f.gw), m), LIVE_GW());

    return '<div class="panel"><h3>' + gname(who) + "’s " + esc(shape) + "</h3>" +
      '<p class="note">The shape, not a list. Step back to a settled week to see what it scored, ' +
      "or forward to see who everyone plays and how hard it looks.</p>" +
      '<div class="gwnav">' +
      '<button data-gw="' + (gw - 1) + '"' + (gw <= 1 ? " disabled" : "") + ' aria-label="Previous gameweek">&larr;</button>' +
      '<span class="gwlabel">Gameweek ' + gw + "</span>" +
      '<button data-gw="' + (gw + 1) + '"' + (gw >= GW_MAX ? " disabled" : "") + ' aria-label="Next gameweek">&rarr;</button>' +
      '<span class="gwstate ' + (live ? "live" : "") + '">' +
        (settled ? "settled" : live ? "in play" : "fixtures") + "</span>" +
      (chip && (settled || live) ? '<span class="chipflag">' + esc(chip) + " played</span>" : "") +
      '<span class="gwtotal">' +
        (total !== null
          ? "<strong>" + total + "</strong> pts on the pitch" +
            (boosted ? " + <strong>" + benchPts + "</strong> from the bench = <strong>" + (total + benchPts) + "</strong>"
                     : benchPts ? " &middot; <strong>" + benchPts + "</strong> left on the bench" : "") +
            (p.total_points ? " &middot; FPL says " + p.total_points : "")
          : avgFdr !== null ? "average difficulty <strong>" + avgFdr + "</strong>" : "") +
      "</span></div>" +
      '<div class="pitchwrap"><div class="pitch">' +
      '<div class="chalk"><i class="box"></i><i class="box6"></i><i class="half"></i><i class="circle"></i></div>' +
      rows.map((r) => '<div class="prow">' + r.map((x) => pitchPlayer(x, gw)).join("") + "</div>").join("") +
      "</div>" +
      '<div class="benchlabel">Bench' +
        (boosted && (settled || live) ? " — boosted, all four counted" : "") + "</div>" +
      '<div class="benchrow">' + bench.map((x) => pitchPlayer(x, gw)).join("") + "</div></div>" +
      '<p class="note" style="margin:12px 0 0">The squad shown is the <em>current</em> one: only ' +
      "this week’s picks are stored, so stepping back pairs this team with that week’s points.</p></div>";
  }

  /* ---------------- the weekly read ----------------
     Per person, and explicitly judgment. Falls back to a flat message rather
     than inventing anything when the brain has not written one. */
  function person() {
    return ((F && F.people) || []).find((x) => x.nick === who) || null;
  }

  function weekHTML() {
    const me = person();
    const p = G.people.find((x) => x.nick === who);
    const head = '<div class="panel"><h3>' + gname(who) + "’s week</h3>" +
      '<p class="note">Written after the gameweek settles &mdash; this is judgment, not data. ' +
      esc(p.team_name) + " &middot; " + p.total_points + " pts &middot; " +
      p.free_transfers + " free transfer" + (p.free_transfers === 1 ? "" : "s") +
      " &middot; £" + p.bank.toFixed(1) + "m banked.</p>";
    if (!me || !me.week) {
      return head + '<p class="empty" style="padding:12px 0">Nothing written for this gameweek yet.</p></div>';
    }
    return head + '<div class="week3">' +
      '<div class="wk good"><h4>What worked</h4><p>' + gname(me.week.worked) + "</p></div>" +
      '<div class="wk bad"><h4>What didn’t</h4><p>' + gname(me.week.didnt) + "</p></div>" +
      '<div class="wk next"><h4>What’s next</h4><p>' + gname(me.week.next) + "</p></div></div></div>";
  }

  /* ---------------- watchlist ---------------- */
  function watchRow(w) {
    const r = pool().find((q) => q.name === w.name);
    const starred = r ? FA.isStarred(who, r.id) : false;
    return '<div class="row"><div class="row-main"><div class="row-name">' +
      (r ? '<a class="plink" data-player="' + esc(w.name) + '">' + esc(w.name) + "</a>" : esc(w.name)) +
      ' <span class="pill">' + esc(w.status) + "</span>" +
      (r ? ' <button class="star" data-star="' + r.id + '" aria-pressed="' + starred +
        '" title="Star this player">' + (starred ? "&#9733;" : "&#9734;") + "</button>" : "") +
      "</div>" +
      '<div class="row-sub">' + esc(w.note) + "</div></div>" +
      '<div class="row-side">' + esc(w.team) + " " + esc(w.pos) + "<br>£" + w.price.toFixed(1) +
      "m<br>" + esc(w.ownership) + "</div></div>";
  }

  function watchHTML() {
    const me = person();
    const mine = (me && me.watchlist) || [];
    const house = (F && F.watchlist) || [];
    const rest = house.filter((w) => !mine.some((m) => m.name === w.name));
    return '<div class="panel"><h3>' + gname(who) + "’s watchlist</h3>" +
      '<p class="note">Yours, kept per person' +
      (FA.stars.remote ? " and stored server-side, so a star set on a phone is there on the laptop"
                       : " (stored in this browser — the shared store is unavailable here)") + ".</p>" +
      '<div class="rows">' + (mine.length
        ? mine.map(watchRow).join("")
        : '<div class="row"><div class="row-main faint">Nothing starred yet.</div></div>') + "</div>" +
      (rest.length
        ? '<h3 style="margin-top:20px">On the house list</h3>' +
          '<p class="note">Watched by the room, not by you.</p>' +
          '<div class="rows">' + rest.map(watchRow).join("") + "</div>"
        : "") + "</div>";
  }

  /* ---------------- roast + chips ---------------- */
  function roastHTML() {
    if (!F || !F.roast || !F.roast.text) return "";
    return '<div class="panel"><h3>The roast</h3>' +
      '<p class="note">Post-gameweek only. Always about a decision, with the fact attached, ' +
      "and it roasts the machine too.</p>" +
      '<div class="roast"><p>' + gname(F.roast.text) + "</p>" +
      (F.roast.by ? '<div class="by">' + esc(F.roast.by) + "</div>" : "") + "</div></div>";
  }

  function diffsHTML() {
    // What the crowd MISSED — computed, never asserted. A captain poll tells
    // you nothing you can act on; this is a list of things everyone got wrong.
    const d = pool().filter((p) => p.ownership < 10 && p.points > 0)
      .sort((a, b) => b.points - a.points || a.ownership - b.ownership).slice(0, 8);
    if (!d.length) return "";
    return '<div class="panel"><h3>What the crowd missed</h3>' +
      '<p class="note">Under 10% owned, sorted by points returned.</p><div class="rows">' +
      d.map((r) =>
        '<div class="row"><div class="row-main"><div class="row-name">' +
        '<a class="plink" data-player="' + esc(r.name) + '">' + esc(r.name) + "</a>" +
        FA.ownerDots(r.owned_by, who) + "</div>" +
        '<div class="row-sub">' + esc(r.pos) + " &middot; " + esc(r.team) +
        " &middot; £" + r.price.toFixed(1) + "m</div></div>" +
        '<div class="row-side"><strong style="color:var(--ok);font-size:14px">' + r.points +
        "</strong> pts<br>" + r.ownership + "% owned</div></div>").join("") + "</div></div>";
  }

  function chipsHTML() {
    if (!F || !F.chips || !F.chips.rows) return "";
    const played = {};
    G.people.forEach((p) => { if (p.active_chip) (played[p.active_chip] = played[p.active_chip] || []).push(p.nick); });
    return '<div class="panel"><h3>Chip clock</h3>' +
      (F.chips.note ? '<p class="note">' + esc(F.chips.note) + "</p>" : "") +
      '<div class="rows">' + F.chips.rows.map((c) => {
        const users = played[c.code ? c.code.toLowerCase() : ""] || [];
        return '<div class="row"><div class="row-main"><div class="row-name">' + esc(c.name) + "</div>" +
          '<div class="row-sub">' + esc(c.window) + "</div></div>" +
          '<div class="row-side">' + (users.length ? gname(users.join(", ")) + "<br>" : "") +
          '<span class="pill">' + esc(c.expires) + "</span></div></div>";
      }).join("") + "</div></div>";
  }

  function fiveHTML() {
    const rows = G.league.rows;
    const top = rows[0];
    const me = rows.find((r) => r.nick === who);
    return '<details class="fold"><summary>The league &mdash; ' + esc(top.name) + " lead on " +
      top.total + (me ? ", " + esc(who) + " " + (me.rank === 1 ? "top" : me.rank + "th") + " on " + me.total : "") +
      '</summary><div class="foldbody">' +
      '<p class="note">Live positions in <strong>' + esc(G.league.name) + "</strong>, " +
      rows.length + " managers.</p>" +
      '<div class="scroll"><table class="sortable"><thead><tr><th class="n">#</th><th>Team</th>' +
      '<th>Gaffer</th><th class="n">GW</th><th class="n">Total</th><th class="n">Behind</th>' +
      "</tr></thead><tbody>" +
      rows.map((r) =>
        '<tr class="' + (r.nick === who ? "me" : "") + '">' +
        '<td class="n">' + r.rank + "</td><td>" + esc(r.name) +
        (r.is_gaffer ? "" : ' <span class="pill">guest</span>') + "</td>" +
        "<td>" + (r.nick ? gname(r.nick) : '<span class="faint">&mdash;</span>') + "</td>" +
        '<td class="n">' + r.event_total + '</td><td class="n"><strong>' + r.total + "</strong></td>" +
        '<td class="n faint">' + (r.rank === 1 ? "&mdash;" : "&minus;" + (top.total - r.total)) + "</td></tr>").join("") +
      "</tbody></table></div></div></details>";
  }

  /* ---------------- render ---------------- */
  function render() {
    $("#main").innerHTML =
      '<section class="section"><div class="section-head"><h2>the gaffers</h2>' +
      '<span class="mute" style="font-size:13px">what we did about it</span>' +
      (session
        ? '<span style="margin-left:auto;font-size:12px;color:var(--faint)">' +
          esc(session.email) + ' &middot; <a href="#" id="signout">sign out</a></span>'
        : "") + "</div>" +
      headlineHTML() +
      // Two short status panels that answer the same question — how much of
      // this gameweek is real yet — so they sit on one row.
      '<div class="grid2">' + longGameHTML() + liveHTML() + "</div>" +
      barHTML() + fiveHTML() +
      // Squad first, then the read about it. You look at the team, then at
      // what someone made of it.
      pitchHTML() + weekHTML() + watchHTML() + roastHTML() +
      '<div class="grid2">' + diffsHTML() + chipsHTML() + "</div></section>";
    wire();
    FA.wireSortable($("#main"));
    // The five table lives inside a <details>; wire it when it first opens.
    document.querySelectorAll("details.fold").forEach((el) => {
      el.addEventListener("toggle", function once() {
        if (el.open) { FA.wireSortable(el); el.removeEventListener("toggle", once); }
      });
    });
  }

  function wire() {
    document.querySelectorAll("#gbar .gchip").forEach((b) => {
      b.onclick = () => { who = b.dataset.nick; gwView = null; live = null; liveFor = null; render(); };
    });
    document.querySelectorAll("[data-live]").forEach((b) => { b.onclick = refreshLive; });
    document.querySelectorAll(".gwnav button[data-gw]").forEach((b) => {
      b.onclick = () => { if (!b.disabled) { gwView = Number(b.dataset.gw); render(); } };
    });
    const so = document.getElementById("signout");
    if (so) so.onclick = async (e) => {
      e.preventDefault();
      await fetch("/api/auth", { method: "DELETE" });
      location.reload();
    };
    document.querySelectorAll("[data-star]").forEach((b) => {
      b.onclick = async (e) => {
        e.stopPropagation();
        const on = await FA.toggleStar(who, Number(b.dataset.star));
        b.setAttribute("aria-pressed", String(on));
        b.innerHTML = on ? "&#9733;" : "&#9734;";
      };
    });
  }

  /* ---------------- the door ----------------
     The squads and weekly reads are not published as static files; they come
     from /api/private and only with a valid session. So this room genuinely
     cannot render without signing in, rather than merely declining to. */
  function signInHTML(state) {
    const note = {
      out: "",
      denied: '<p class="door-note" style="color:var(--hot)">That account is not on the ' +
        "list. Five people have keys to this room; ask KB to add yours.</p>",
      unconfigured: '<p class="door-note" style="color:var(--warn)">Sign-in is not switched ' +
        "on yet &mdash; the Google client ID has not been set. Nothing is broken; the door " +
        "simply has no lock fitted.</p>",
      error: '<p class="door-note" style="color:var(--hot)">Sign-in failed. Try again.</p>',
    }[state] || "";

    // The lineup is drawn from FA.NICKS, not from the data: this page runs
    // before there is a session, so there is no squad list to read. It is
    // also the honest content for a locked door — who it is locked FOR.
    const lineup = FA.NICKS.map((n) =>
      '<div class="lu"><span class="facewrap lu-face">' + FA.faceSVG(n) + "</span>" +
      "<b>" + esc(n) + "</b>" +
      '<span class="lu-club">' + esc(FA.faceClub(n)) + "</span></div>").join("");

    return '<section class="section"><div class="section-head"><h2>the gaffers</h2>' +
      '<span class="mute" style="font-size:13px">what we did about it</span></div>' +
      '<div class="door">' +
      '<div class="door-k">Five keys &middot; members only</div>' +
      "<h3>This room belongs to the five.</h3>" +
      '<p class="door-p">Squads, weekly reads, the roast and the mini-league. It is not ' +
      "published &mdash; it is fetched, and only for one of these five.</p>" +
      '<div class="lineup">' + lineup + "</div>" +
      note +
      // No lock fitted means no button will ever land here; an empty slot
      // under the lineup reads as a broken page.
      (state === "unconfigured" ? "" : '<div class="door-cta"><div id="gsi"></div></div>') +
      '<p class="door-foot"><a href="../">touchline</a> and <a href="../locker/">the locker ' +
      'room</a> are open to everyone.</p>' +
      "</div></section>";
  }

  function renderSignIn(state) {
    $("#main").innerHTML = signInHTML(state);
    const cid = document.body.dataset.googleClientId;
    // No client id means no button will ever appear. Say so rather than
    // leaving an empty slot under the lineup where a door handle should be.
    if (!cid) {
      if (state !== "unconfigured") $("#main").innerHTML = signInHTML("unconfigured");
      return;
    }
    if (state === "unconfigured") return;
    // Google Identity Services renders its own button; it is loaded from the
    // shell so that a blocked script leaves an honest message rather than a
    // dead page.
    if (!window.google || !google.accounts) return;
    google.accounts.id.initialize({ client_id: cid, callback: onCredential });
    google.accounts.id.renderButton(document.getElementById("gsi"),
      { theme: "outline", size: "large", text: "signin_with", shape: "pill" });
  }

  async function onCredential(res) {
    try {
      const r = await fetch("/api/auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ credential: res.credential }),
      });
      if (r.status === 403) return renderSignIn("denied");
      if (!r.ok) return renderSignIn("error");
      main();
    } catch (e) {
      renderSignIn("error");
    }
  }

  async function main() {
    const el = $("#main");

    let priv;
    try {
      const r = await fetch("/api/private", { cache: "no-store" });
      if (r.status === 401) return renderSignIn("out");
      if (r.status === 503) return renderSignIn("unconfigured");
      if (!r.ok) throw new Error("HTTP " + r.status);
      priv = await r.json();
    } catch (e) {
      FA.fail(el, "The gaffers room could not load. " + e.message);
      return;
    }

    G = priv.gaffers;
    session = priv.session || null;
    // The signed-in gaffer is whose room it is. Falls back to the owner until
    // the other four addresses are mapped.
    who = (session && session.nick) || FA.ME;

    try {
      P = await loadJSON("../data/players.json");
    } catch (e) {
      FA.fail(el, "The player file could not load. " + e.message);
      return;
    }
    try { F = await loadJSON("../data/fpl.json"); } catch (e) { F = null; }
    // `people` travels with the private payload, not with public fpl.json.
    if (F) F.people = priv.people || [];
    else F = { people: priv.people || [] };

    P.players.forEach((p) => { byId[p.id] = p; });

    await FA.loadStars();
    FA.initPlayerCards(P.players, F && F.verdicts, who, F && F.signals);
    render();
    FA.stamp(G.generated_at);
  }

  FA.initTheme();
  main();
})();
