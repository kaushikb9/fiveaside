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

  /* ---------------- where in the week we are ----------------
     Three states, and the room reads differently in each:

       in play   a gameweek has started and has not finished
       between   it has finished and the next deadline has not passed
       locked    the deadline has passed, nothing has kicked off yet

     Two numbers, and confusing them is what made the room say "it is gameweek
     1" on the day gameweek 2 was being picked. PICKS_GW is the gameweek the
     squad snapshot belongs to — FPL will not hand over anyone's picks for a
     gameweek whose deadline has not passed, so it is always the last one
     played. NEXT_GW is the one being planned for. They are the same number
     only while a gameweek is actually being played. */
  const PICKS_GW = () => (G.live_gameweek ? G.live_gameweek.id : G.gameweek);
  const NEXT_GW = () => G.gameweek || PICKS_GW();
  const inPlay = () => Boolean(G.live_gameweek && !G.live_gameweek.finished);
  const between = () =>
    Boolean(G.live_gameweek && G.live_gameweek.finished && NEXT_GW() > PICKS_GW());
  // What the room is ABOUT, as opposed to what the squad data is of.
  const focusGW = () => (between() ? NEXT_GW() : PICKS_GW());

  /* "Fri 29 Aug, 23:00 — in 2 days". The date string is pre-formatted in the
     owner's zone by the facts layer; only the distance is computed here, and
     only in whole units, because "in 1 day and 4 hours" is not how anyone
     thinks about a deadline. */
  function untilDeadline() {
    if (!G.deadline_utc) return null;
    const ms = Date.parse(G.deadline_utc) - Date.now();
    if (isNaN(ms)) return null;
    if (ms <= 0) return "closed";
    const mins = Math.round(ms / 60000);
    if (mins < 60) return "in " + mins + " minute" + (mins === 1 ? "" : "s");
    const hours = Math.round(mins / 60);
    if (hours < 36) return "in " + hours + " hour" + (hours === 1 ? "" : "s");
    const days = Math.round(hours / 24);
    return "in " + days + " day" + (days === 1 ? "" : "s");
  }

  const deadlineLine = () => {
    const when = G.deadline_local;
    const away = untilDeadline();
    if (!when) return "Gameweek " + NEXT_GW() + " is next.";
    return "Gameweek " + NEXT_GW() + " locks " + esc(when) +
      (away && away !== "closed" ? " &mdash; " + away : "") + ".";
  };

  /* ---------------- the long game ----------------
     A standing guard against reading one weekend as a season. It renders on
     real evidence — how much of the table is still matchday-one noise — and
     retires itself once there is enough football to argue from. */
  const SETTLED_FROM_GW = 6;
  function longGameHTML() {
    const gw = focusGW();
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
      const r = await fetch("/api/live?gw=" + PICKS_GW() + "&entry=" + p.entry, { cache: "no-store" });
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

  /* Between weeks there is nothing live to fetch, and a "Live gameweek" panel
     with a dead button is the room telling you about a state it is not in. It
     becomes the deadline panel instead, which is the only thing anyone wants
     between a full-time whistle and the next lock. */
  function deadlineHTML() {
    const p = G.people.find((x) => x.nick === who);
    const moves = p && p.transfers_made != null
      ? p.transfers_made + " transfer" + (p.transfers_made === 1 ? "" : "s") +
        (p.transfers_cost ? " at &minus;" + p.transfers_cost : "") + " in gameweek " + PICKS_GW()
      : null;
    return '<div class="panel" style="border-left:4px solid var(--accent)">' +
      "<h3>Next deadline</h3>" +
      '<p class="note">' + deadlineLine() +
      " Gameweek " + PICKS_GW() + " is settled, so the pitch below is a result, not a plan " +
      "&mdash; nobody&rsquo;s gameweek " + NEXT_GW() + " picks exist until the deadline passes.</p>" +
      '<p class="note" style="margin-bottom:0">' + gname(who) + ": &pound;" +
      (p && p.bank != null ? p.bank.toFixed(1) : "?") + "m in the bank, squad worth &pound;" +
      (p && p.value != null ? p.value.toFixed(1) : "?") + "m" +
      (moves ? " &middot; " + moves : "") + ".</p></div>";
  }

  function liveHTML() {
    if (between() && !live) return deadlineHTML();
    if (!live) {
      return '<div class="panel"><h3>Gameweek ' + PICKS_GW() + "</h3>" +
        '<p class="note">Squad points below are a snapshot from the last data run. ' +
        "Pull the live scores when a gameweek is in play.</p>" +
        '<button class="btn-live fc" data-live>' +
        (liveBusy ? "fetching…" : "Fetch live scores") + "</button></div>";
    }
    if (live.error) {
      return '<div class="panel"><h3>Gameweek ' + PICKS_GW() + "</h3>" +
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
    const heading = live.status === "live" ? "Live gameweek " + live.gw
      : live.status === "done" ? "Gameweek " + live.gw + " &mdash; final"
      : "Gameweek " + live.gw + " &mdash; not started";
    return '<div class="panel"><h3>' + heading + "</h3>" +
      '<p class="note">' + done + " of " + live.fixtures.length + " matches finished" +
      (inPlay.length ? ", " + inPlay.length + " in play" : "") +
      ". Points on the pitch below are live, including provisional bonus.</p>" +
      '<p class="note" style="margin-top:-6px">Read the total in the pitch header &mdash; the ' +
      "other one counts starters only.</p>" +
      (inPlay.length ? '<div class="rows">' + inPlay.map(fx).join("") + "</div>" : "") +
      '<button class="btn-live fc" data-live style="margin-top:10px">' +
      (liveBusy ? "refreshing…" : "Refresh") + "</button></div>";
  }

  /* ---------------- the pitch ---------------- */
  // The pitch opens on the week the squad data is actually of, so it shows a
  // result rather than last week's XI drawn against next week's fixtures. The
  // deadline for the week ahead is called out separately, above it.
  const curGW = () => (gwView == null ? PICKS_GW() : gwView);
  // "Settled" is about the football, not about which number is current: a
  // gameweek that has finished is settled even while it is still the latest.
  const isSettled = (gw) => gw < PICKS_GW() || (gw === PICKS_GW() && !inPlay());
  const isLive = (gw) => gw === PICKS_GW() && inPlay();
  const fixtureFor = (r, gw) => (r && r.fixtures ? r.fixtures.find((f) => f.gw === gw) : null) || null;

  function pitchPlayer(pk, gw) {
    const r = rec(pk.element);
    const fx = fixtureFor(r, gw);
    const settled = isSettled(gw), live = isLive(gw);
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
      '<a class="nb" data-pid="' + pk.element + '" data-player="' + esc(pk.name) + '">' +
      esc(pk.name) + "</a>" +
      '<div class="vb' + cls + '">' + bar + "</div></div>";
  }

  function pitchHTML() {
    const p = G.people.find((x) => x.nick === who);
    const gw = curGW(), live = isLive(gw), settled = isSettled(gw);
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
    // so a fixed PICKS_GW+2 stopped one week short of what was on disk.
    const GW_MAX = pool().reduce((m, pl) =>
      (pl.fixtures || []).reduce((n, f) => Math.max(n, f.gw), m), PICKS_GW());

    return '<div class="panel"><h3>' + gname(who) + "’s " + esc(shape) + "</h3>" +

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
      '<p class="note">Judgment, not data. ' +
      esc(p.team_name) + " &middot; " + p.total_points + " pts &middot; " +
      p.transfers_made + " transfer" + (p.transfers_made === 1 ? "" : "s") +
      " made &middot; £" + p.bank.toFixed(1) + "m banked.</p>";
    if (!me || !me.week) {
      return head + '<p class="empty" style="padding:12px 0">Nothing written for this gameweek yet.</p></div>';
    }
    // Two blocks, not three. "What's next" was a seven-hundred-character essay
    // about a transfer nobody had decided to make, sitting inside a panel that
    // is otherwise a look backwards. What comes next is a DECISION and it now
    // lives in The Big Decision, where it is short and it is timed.
    return head + '<div class="week2">' +
      '<div class="wk good"><h4>What worked</h4><p>' + gname(me.week.worked) + "</p></div>" +
      '<div class="wk bad"><h4>What didn’t</h4><p>' + gname(me.week.didnt) + "</p></div>" +
      "</div></div>";
  }

  /* ---------------- watchlist ----------------
     Two lists, and the difference between them is who wrote them. The top one
     is curated by hand: a star, pressed on a card opened from anywhere on the
     site, including from somebody else's squad. It always lands in the
     starrer's list — /api/stars takes the gaffer from the session and ignores
     anything the page claims. Below it is what the brain recommends, the
     house list and its picks for this gaffer together, because both are the
     machine's opinion rather than a person's.

     A starred player leaves the recommendations: once you have taken the
     advice, repeating it is just the page talking to itself. */
  function starRow(p) {
    const v = (F && F.verdicts || []).find((x) => x.id === p.id);
    const canEdit = who === FA.myNick();
    return '<div class="row"><div class="row-main"><div class="row-name">' +
      '<a class="plink" data-pid="' + p.id + '" data-player="' + esc(p.name) + '">' +
      esc(p.name) + "</a>" +
      (v ? " " + FA.vdChip(v) : "") +
      FA.ownerDots(p.owned_by, who) +
      (canEdit
        ? ' <button class="star" data-star="' + p.id + '" aria-pressed="true" ' +
          'title="Remove from your watchlist">&#9733;</button>'
        : "") +
      "</div>" +
      '<div class="row-sub">' +
        (v ? esc(v.why) : esc(p.pos) + " &middot; " + esc(p.team) + " &middot; no verdict written yet") +
      "</div></div>" +
      '<div class="row-side">' + esc(p.team) + " " + esc(p.pos) + "<br>£" + p.price.toFixed(1) +
      "m<br>" + p.ownership + "%</div></div>";
  }

  function watchRow(w) {
    const r = pool().find((q) => q.name === w.name);
    const canEdit = r && who === FA.myNick();
    return '<div class="row"><div class="row-main"><div class="row-name">' +
      (r ? '<a class="plink" data-pid="' + r.id + '" data-player="' + esc(w.name) + '">' +
        esc(w.name) + "</a>" : esc(w.name)) +
      ' <span class="pill">' + esc(w.status) + "</span>" +
      (canEdit
        ? ' <button class="star" data-star="' + r.id + '" aria-pressed="false" ' +
          'title="Add to your watchlist">&#9734;</button>'
        : "") +
      "</div>" +
      '<div class="row-sub">' + esc(w.note) + "</div></div>" +
      '<div class="row-side">' + esc(w.team) + " " + esc(w.pos) + "<br>£" + w.price.toFixed(1) +
      "m<br>" + esc(w.ownership) + "</div></div>";
  }

  const EMPTY_WATCH =
    '<div class="emptywatch">' +
    "<p><strong>Nothing starred yet.</strong> This list is yours to build by hand.</p>" +
    "<p>Open any player &mdash; a name is clickable everywhere on the site, on the pitch, " +
    "in the file, in a digest, even in somebody else&rsquo;s squad &mdash; and press " +
    "<span class=\"star\" aria-hidden=\"true\">&#9734;</span> <em>Add to your watchlist</em>. " +
    "It lands here and nowhere else; starring from another gaffer&rsquo;s room does not touch " +
    "theirs.</p>" +
    "<p class=\"faint\">The list below is what the brain suggests. Star one and it moves up " +
    "here.</p></div>";

  function watchHTML() {
    const me = person();
    const stars = (FA.stars.data[who] || []);
    const starred = stars.map((id) => byId[id]).filter(Boolean);
    const starredNames = new Set(starred.map((p) => p.name));

    // The brain's picks for this gaffer and the house list are the same kind
    // of thing — a recommendation — so they are one list, deduped by name.
    const suggested = [];
    const seen = new Set();
    ((me && me.watchlist) || []).concat((F && F.watchlist) || []).forEach((w) => {
      if (seen.has(w.name) || starredNames.has(w.name)) return;
      seen.add(w.name);
      suggested.push(w);
    });

    const yours = who === FA.myNick();
    return '<div class="panel"><h3>' + gname(who) + "’s watchlist</h3>" +
      '<p class="note">' + (yours ? "Yours" : "Theirs") + ", starred by hand" +
      (FA.stars.remote ? " and kept server-side, so a star set on a phone is there on the laptop"
                       : " (kept in this browser — the shared store is unavailable here)") + ".</p>" +
      (starred.length
        ? '<div class="rows">' + starred.map(starRow).join("") + "</div>"
        : yours ? EMPTY_WATCH
        : '<div class="row"><div class="row-main faint">' + gname(who) +
          " has not starred anyone.</div></div>") +
      (suggested.length
        ? '<h3 style="margin-top:20px">What the brain suggests</h3>' +
          '<p class="note">The house list and its picks for ' + gname(who) +
          ". Star one and it moves up.</p>" +
          '<div class="rows">' + suggested.map(watchRow).join("") + "</div>"
        : "") + "</div>";
  }

  /* ---------------- the big decision ----------------
     One or two calls, and only in the last day before the deadline. The gate
     is the point: a decision panel that is always there is a column, and a
     column gets skimmed. This appears when it can still change something and
     is gone by kick-off.

     Per gaffer, because a captaincy or a chip is not a house opinion — five
     people, five different squads, five different questions. */
  const DEADLINE_WINDOW_H = 24;

  function hoursToDeadline() {
    const iso = G && G.deadline_utc;
    if (!iso) return null;
    const t = Date.parse(iso);
    return isNaN(t) ? null : (t - Date.now()) / 3600000;
  }

  function bigHTML() {
    const me = person();
    const calls = (me && me.big) || [];
    if (!calls.length) return "";
    const h = hoursToDeadline();
    if (h === null || h <= 0 || h > DEADLINE_WINDOW_H) return "";

    const left = h < 1
      ? Math.max(1, Math.round(h * 60)) + " min"
      : Math.round(h) + " hour" + (Math.round(h) === 1 ? "" : "s");
    return '<div class="panel big"><h3>The Big Decision' +
      '<span class="big-clock">' + esc(left) + " left</span></h3>" +
      '<div class="rows">' + calls.slice(0, 2).map((c) =>
        '<div class="row"><div class="row-main">' +
        '<div class="row-name">' + gname(c.call) + "</div>" +
        '<div class="row-sub">' + gname(c.why) + "</div></div></div>").join("") +
      "</div></div>";
  }

  /* ---------------- roast + chips ---------------- */
  function roastHTML() {
    if (!F || !F.roast || !F.roast.text) return "";
    // The note used to print the rules back at the reader. A roast that needs
    // its terms and conditions above it is not landing.
    return '<div class="panel"><h3>The roast</h3>' +

      '<div class="roast"><p>' + gname(F.roast.text) + "</p>" +
      (F.roast.by ? '<div class="by">' + esc(F.roast.by) + "</div>" : "") + "</div></div>";
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
          'signed in as ' + esc(session.nick) +
          ' &middot; <a href="#" id="signout">sign out</a></span>'
        : "") + "</div>" +
      headlineHTML() +
      // Two short status panels that answer the same question — how much of
      // this gameweek is real yet — so they sit on one row.
      '<div class="grid2">' + longGameHTML() + liveHTML() + "</div>" +
      barHTML() + fiveHTML() +
      // Squad first, then the read about it. You look at the team, then at
      // what someone made of it.
      pitchHTML() + weekHTML() + watchHTML() + bigHTML() + roastHTML() + "</section>";
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
    // A star moves a player between the two lists, so the panel is redrawn
    // rather than the button retoggled in place.
    document.querySelectorAll("[data-star]").forEach((b) => {
      b.onclick = async (e) => {
        e.stopPropagation();
        b.disabled = true;
        await FA.toggleStar(Number(b.dataset.star));
        render();
      };
    });
  }

  /* ---------------- the door ----------------
     The squads and weekly reads are not published as static files; they come
     from /api/private and only with a valid session. So this room genuinely
     cannot render without signing in, rather than merely declining to.

     A code, not a password: KB mints one per gaffer, it works on any device
     until he revokes it, and there is nothing to reset. Typing it and tapping
     a /gaffers/?i=CODE link are the same act — the link just fills the box. */
  function signInHTML(state) {
    // Main's copy, in the door's own layout: the wording is theirs, only the
    // class changes so a note sits inside the lineup panel rather than in a
    // bare card.
    const say = {
      out: '<p class="door-p">Enter the code KB sent you &mdash; once per device, then it ' +
        "remembers.</p>",
      denied: '<p class="door-note" style="color:var(--hot)">That code is not one of ours. ' +
        "Check for a typo, or ask KB for a new one.</p>",
      throttled: '<p class="door-note" style="color:var(--hot)">Too many tries from here. ' +
        "Wait ten minutes, then have another go.</p>",
      unconfigured: '<p class="door-note" style="color:var(--warn)">Sign-in is not switched ' +
        "on yet &mdash; the session secret or the store is not bound. Nothing is broken; the " +
        "door simply has no lock fitted.</p>",
      error: '<p class="door-note" style="color:var(--hot)">That did not go through. ' +
        "Try again.</p>",
    }[state] || "";
    // No lock fitted means the box can never open the door; an input nobody
    // can use is worse than no input at all.
    const form = state === "unconfigured" ? "" :
      '<form id="codeform" class="codeform" autocomplete="off">' +
      '<label class="vh" for="code">Your invite code</label>' +
      '<input id="code" name="code" type="text" inputmode="latin" autocapitalize="characters" ' +
      'spellcheck="false" maxlength="19" placeholder="XXXX-XXXX-XXXX">' +
      '<button type="submit">Enter</button></form>';

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
      say +
      (form ? '<div class="door-cta">' + form + "</div>" : "") +
      '<p class="door-foot"><a href="../">touchline</a> and <a href="../locker/">the locker ' +
      "room</a> are open to everyone.</p>" +
      "</div></section>";
  }

  /* The code is only ever grouped for reading. Everything the server compares
     is stripped and upper-cased, here and there, so a dash or a lower-case
     letter is never the reason someone cannot get in. */
  const groupCode = (v) =>
    (String(v).toUpperCase().replace(/[^0-9A-Z]/g, "").slice(0, 16).match(/.{1,4}/g) || []).join("-");

  function renderSignIn(state) {
    $("#main").innerHTML = signInHTML(state);
    const form = document.getElementById("codeform");
    if (!form) return;
    const input = document.getElementById("code");
    input.addEventListener("input", () => {
      const at = input.selectionStart === input.value.length;
      input.value = groupCode(input.value);
      if (at) input.setSelectionRange(input.value.length, input.value.length);
    });
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      submitCode(input.value, form);
    });
    input.focus();
  }

  async function submitCode(code, form) {
    const clean = String(code).replace(/[^0-9A-Za-z]/g, "");
    if (!clean) return;
    const btn = form && form.querySelector("button");
    if (btn) { btn.disabled = true; btn.textContent = "Checking\u2026"; }
    try {
      const r = await fetch("/api/auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: clean }),
      });
      if (r.status === 403) return renderSignIn("denied");
      if (r.status === 429) return renderSignIn("throttled");
      if (r.status === 503) return renderSignIn("unconfigured");
      if (!r.ok) return renderSignIn("error");
      main();
    } catch (e) {
      renderSignIn("error");
    }
  }

  /* A link is a code someone else can read over your shoulder, so it is spent
     the moment it is used: taken out of the URL before anything renders, and
     out of the history entry with it. */
  function codeFromURL() {
    const params = new URLSearchParams(location.search);
    const code = params.get("i") || params.get("invite");
    if (!code) return null;
    params.delete("i");
    params.delete("invite");
    const rest = params.toString();
    history.replaceState(null, "", location.pathname + (rest ? "?" + rest : ""));
    return code;
  }

  async function main(urlCode) {
    const el = $("#main");

    // A code in the URL is redeemed before anything else asks a question:
    // /gaffers/?i=CODE has to behave exactly like typing it into the box.
    if (urlCode) {
      try {
        const r = await fetch("/api/auth", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ code: String(urlCode).replace(/[^0-9A-Za-z]/g, "") }),
        });
        if (r.status === 403) return renderSignIn("denied");
        if (r.status === 429) return renderSignIn("throttled");
      } catch (e) { /* fall through to the session check below */ }
    }

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
    // the other four have codes of their own.
    who = (session && session.nick) || FA.ME;
    // Seeded, not re-fetched: /api/private already answered "who is holding
    // the phone", and the watchlist renders below on that answer. Leaving
    // common.js to ask /api/auth on its own would race the first render and
    // quietly hide your own star buttons.
    FA.setSession(session);

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

    await FA.starsReady();
    FA.initPlayerCards(P.players, F && F.verdicts, who, F && F.signals);
    render();
    FA.stamp(G.generated_at);
  }

  // A card can be opened from anywhere in this room — the pitch, the file,
  // another gaffer's squad — so the watchlist has to follow a star pressed
  // there as well as one pressed on its own rows.
  FA.onStarChange = () => { if (G) render(); };

  FA.initTheme();
  main(codeFromURL());
})();
