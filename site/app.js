// Touchline FPL — renders site/data/fpl.json into #main, plus a live strip
// during a gameweek in play. No framework, no build step, no CDNs.
//
// Two tiers share the page: THE COMMONS (public — useful to any FPL manager)
// and the personal layer, revealed by the sync toggle. Sync is a declutter
// gate, not secrecy: an FPL team's picks are public via the API anyway.
const $ = (sel) => document.querySelector(sel);

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const price = (n) => (Number.isFinite(n) ? `${Number(n).toFixed(1)}` : "");
const pct = (n) => (Number.isFinite(n) ? `${n}` : "");

const initials = (name) =>
  String(name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("") || "?";

const POS_ORDER = { GK: 0, DEF: 1, MID: 2, FWD: 3 };

// ---------------------------------------------------------------- fragments

// A squad row: position chip, name, badges, club chip, price.
function squadRow(p, opts = {}) {
  const badges =
    (p.captain ? '<span class="cap">C</span>' : "") +
    (p.vice ? '<span class="cap v">V</span>' : "") +
    (p.bet ? '<span class="bet">bet</span><span class="dag">&dagger;</span>' : "");
  const order = p.role === "bench" ? `<i class="bo">${esc(p.bench_order ?? "")}</i>` : "";
  const cls = `srow${p.role === "bench" ? " bench" : ""}${opts.first ? " b1" : ""}`;
  const right = opts.right ?? `<span class="sprice">${esc(price(p.price))}</span>`;
  return (
    `<div class="${cls}"><span class="posc">${esc(p.pos)}</span>${order}` +
    `<span class="sname" data-player="${esc(p.name)}" data-team="${esc(p.team ?? "")}" role="button" tabindex="0">${esc(p.name)}</span>${badges}` +
    `<span class="tchip">${esc(p.team ?? "")}</span>${right}</div>`
  );
}

function squadBoard(players, opts = {}) {
  const starters = players
    .filter((p) => p.role !== "bench")
    .sort((a, b) => (POS_ORDER[a.pos] ?? 9) - (POS_ORDER[b.pos] ?? 9) || b.price - a.price);
  const bench = players
    .filter((p) => p.role === "bench")
    .sort((a, b) => (a.bench_order ?? 9) - (b.bench_order ?? 9));
  return (
    `<div class="sqb">` +
    starters.map((p) => squadRow(p, opts)).join("") +
    bench.map((p, i) => squadRow(p, { ...opts, first: i === 0 })).join("") +
    `</div>`
  );
}

// A collapsed squad behind a summary line — used for both shadow teams.
function squadDetails(squad, summarySub, right) {
  if (!squad?.players?.length) return "";
  return (
    `<details class="squad"><summary><span class="chev" aria-hidden="true"></span>` +
    `<span class="sum-main">${esc(squad.formation ?? "")}</span>` +
    `<span class="sum-sub">${esc(summarySub)}</span>` +
    `<span class="sum-right">${esc(right ?? squad.value ?? "")}</span></summary>` +
    squadBoard(squad.players) +
    `</details>` +
    (squad.note ? `<p class="snote">${esc(squad.note)}</p>` : "")
  );
}

const section = (title, right, body) =>
  body
    ? `<section><h2>${esc(title)}${right ? `<span class="h2-right">${esc(right)}</span>` : ""}</h2>${body}</section>`
    : "";

// ------------------------------------------------------------------ commons

function signalsHTML(rows) {
  if (!rows?.length) return "";
  const cards = rows
    .map((s) => {
      const who = s.player || s.team || "";
      const src = s.url
        ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.source)}</a>`
        : esc(s.source);
      return (
        `<div class="signal"><span class="sig ${esc(s.tag)}">${esc(s.tag)}</span>` +
        `<div class="stext"><b>${esc(who)}</b> <span class="tail">&mdash; ${esc(s.text)}</span>` +
        (s.action ? `<div class="saction">&rarr; ${esc(s.action)}</div>` : "") +
        `<div class="ssrc">${src}</div></div></div>`
      );
    })
    .join("");
  return section("The week", "team news", `<div class="signals">${cards}</div>`);
}

function captainHTML(poll) {
  if (!poll?.rows?.length) return "";
  const max = Math.max(1, ...poll.rows.map((r) => r.ownership || 0));
  const rows = poll.rows
    .map(
      (r) =>
        `<div class="trow"><span class="tname">${esc(r.name)}</span>` +
        `<span class="tchip">${esc(r.team)}</span>` +
        `<span class="tbar"><i style="width:${Math.round(((r.ownership || 0) / max) * 100)}%"></i></span>` +
        `<span class="tpct">${esc(pct(r.ownership))}%</span></div>`
    )
    .join("");
  const head = poll.most_captained
    ? `<div class="blabel">Most captained &middot; ${esc(poll.most_captained.name)}</div>`
    : `<div class="blabel">The armband</div>`;
  return section(
    "The captain poll",
    "",
    `<div class="board tboard poll">${head}${rows}</div>` +
      (poll.note ? `<p class="snote">${esc(poll.note)}</p>` : "")
  );
}

function fixtureRunsHTML(ticker, gws = 3) {
  if (!ticker?.rows?.length) return "";
  const scored = ticker.rows
    .map((r) => {
      const fx = r.fixtures.filter((f) => f.gw < ticker.from_gw + gws);
      const avg = fx.length ? fx.reduce((a, f) => a + f.fdr, 0) / fx.length : 0;
      return { team: r.team, fx, avg };
    })
    .filter((r) => r.fx.length)
    .sort((a, b) => a.avg - b.avg);

  // Every cell is filled, including the neutral middle — a partially-coloured
  // strip reads as arbitrary highlighting rather than a scale.
  const strip = (r) =>
    `<div class="frw"><span class="fteam">${esc(r.team)}</span>` +
    r.fx
      .map(
        (f) =>
          `<span class="fc d${esc(f.fdr)}" title="${esc(r.team)} ${f.home ? "at home to" : "away at"} ${esc(f.opp)} — difficulty ${esc(f.fdr)}/5, GW${esc(f.gw)}">` +
          `${esc(f.opp)}<i>${f.home ? "H" : "A"}</i></span>`
      )
      .join("") +
    `<span class="favg">${r.avg.toFixed(1)}</span></div>`;

  const kindest = scored.slice(0, 6).map(strip).join("");
  const hardest = scored.slice(-4).reverse().map(strip).join("");
  const to = ticker.from_gw + gws - 1;
  const key =
    `<div class="fkey"><span>easier</span>` +
    [1, 2, 3, 4, 5].map((d) => `<i class="d${d}"></i>`).join("") +
    `<span>harder</span></div>`;
  return section(
    "Fixture runs",
    `GW${ticker.from_gw}–${to}`,
    `<div class="board"><div class="fdrwrap">` +
      `<div><div class="flabel">Kindest run${key}</div>${kindest}</div>` +
      `<div><div class="flabel">Hardest run</div>${hardest}</div>` +
      `</div></div>` +
      `<p class="snote">Opponent, then <b>H</b>ome or <b>A</b>way; the number is the run's average difficulty. ` +
      `These are the game's own ratings, set before a ball was kicked &mdash; treat them as a starting point, not a verdict.</p>`
  );
}

const chipsHTML = (chips) =>
  chips?.rows?.length
    ? section(
        "The chip clock",
        "",
        chips.rows
          .map(
            (r) =>
              `<div class="chip"><span class="ctok">${esc(r.code)}</span>` +
              `<span class="cnote">${esc(r.window)}</span>` +
              `<span class="cexp">${esc(r.expires)}</span></div>`
          )
          .join("") + (chips.note ? `<p class="snote">${esc(chips.note)}</p>` : "")
      )
    : "";

// ----------------------------------------------------------------- personal

function deskHTML(desk, gw) {
  if (!desk) return "";
  const bits = [];
  if (desk.entered === false) bits.push("<span class='stat'>team <b>not entered yet</b></span>");
  if (Number.isFinite(desk.gw_points))
    bits.push(`<span class="stat">GW${esc(gw ?? "")} <b>${esc(desk.gw_points)} pts</b></span>`);
  if (Number.isFinite(desk.total_points))
    bits.push(`<span class="stat">season <b>${esc(desk.total_points)}</b></span>`);
  if (Number.isFinite(desk.overall_rank))
    bits.push(`<span class="stat">OR <b>${esc(desk.overall_rank.toLocaleString("en-GB"))}</b></span>`);
  if (desk.league?.name)
    bits.push(
      `<span class="stat">${esc(desk.league.name)} <b>${esc(desk.league.rank ?? "?")}${desk.league.of ? ` of ${esc(desk.league.of)}` : ""}</b></span>`
    );
  if (Number.isFinite(desk.bank)) bits.push(`<span class="stat">bank <b>&pound;${esc(price(desk.bank))}m</b></span>`);
  return (
    `<div class="board"><div class="blabel">Your desk</div><div class="deskrow">` +
    `<span class="team">${esc(desk.team_name)}</span>` +
    bits.join('<span class="sep">&middot;</span>') +
    `</div></div>`
  );
}

function callHTML(data) {
  const c = data.call;
  if (!c) return "";
  const moves = c.moves?.length
    ? c.moves
        .map(
          (m) =>
            `<div class="brow"><span class="who">${esc(m.out)} &rarr; <strong>${esc(m.in)}</strong>` +
            `<span class="ha">${esc(m.cost)}</span></span></div><div class="bnote">${esc(m.note)}</div>`
        )
        .join("")
    : "";
  const fyi = c.alternatives?.length
    ? `<ul class="fyi">${c.alternatives
        .map(
          (a, i) =>
            `<li><span class="kick${i ? " daring" : ""}">${esc(a.kind)}</span>` +
            `<span class="move">${esc(a.move)}</span>` +
            `<span class="tail">${esc(a.note)}</span>` +
            `<button class="star" type="button" aria-pressed="false" aria-label="Star this for the brain">&#9734;</button></li>`
        )
        .join("")}</ul>`
    : "";
  const squad = data.squad?.players?.length
    ? `<details class="squad" open><summary><span class="chev" aria-hidden="true"></span>` +
      `<span class="sum-main">${esc(data.squad.formation)}</span>` +
      `<span class="sum-sub">the recommended squad</span>` +
      `<span class="sum-right">bank ${esc(data.squad.bank ?? "")}</span></summary>` +
      squadBoard(data.squad.players) +
      (data.squad.players.some((p) => p.note)
        ? `<div class="foot"><span class="dag">&dagger;</span> the bets &mdash; ${data.squad.players
            .filter((p) => p.note)
            .map((p) => `${esc(p.name)}: ${esc(p.note)}`)
            .join(" &middot; ")}</div>`
        : "") +
      `</details>`
    : "";
  return (
    `<article class="digest">` +
    deskHTML(data.desk, data.live_gameweek?.id ?? data.gameweek?.id) +
    `<p class="eyebrow"><span class="star-glyph">&#9733;</span> The call${data.gameweek ? ` &middot; Gameweek ${esc(data.gameweek.id)}` : ""}</p>` +
    `<h2 class="headline">${esc(c.headline)}</h2>` +
    (moves ? `<div class="board">${moves}</div>` : "") +
    squad +
    `<p class="reasoning">${esc(c.reasoning)}</p>` +
    (c.chip ? `<p class="wager"><span class="wlab">Chip</span>${esc(c.chip)}</p>` : "") +
    (c.template_drift
      ? `<p class="wager"><span class="wlab">Template drift</span>${esc(c.template_drift)}</p>`
      : "") +
    fyi +
    `</article>`
  );
}

const watchlistHTML = (rows) =>
  rows?.length
    ? section(
        "The watchlist",
        "",
        `<div class="players">${rows
          .map(
            (w) =>
              `<div class="player"><span class="avatar${w.status === "rising" ? " rising" : ""}">${esc(initials(w.name))}</span>` +
              `<div><div class="ptop"><span class="pname" data-player="${esc(w.name)}" data-team="${esc(w.team ?? "")}" role="button" tabindex="0">${esc(w.name)}</span>` +
              `<span class="tchip">${esc(w.team)}</span>` +
              `<span class="ptag ${esc(w.status)}">${esc(w.status)}</span>` +
              (w.ownership ? `<span class="ptag">${esc(w.ownership)}</span>` : "") +
              `</div><p class="pnote">${esc(w.note)}</p></div></div>`
          )
          .join("")}</div>`
      )
    : "";

const wagersHTML = (rows) =>
  rows?.length
    ? section(
        "Open wagers",
        "written at decision time",
        `<div class="wagers">${rows
          .map(
            (w) =>
              `<div class="wcard"><span class="wtext">${esc(w.claim)}` +
              (w.standing ? ` <span class="tail">&mdash; ${esc(w.standing)}</span>` : "") +
              `</span><span class="settle">settles GW${esc(w.settles_gw)}</span></div>`
          )
          .join("")}</div>`
      )
    : "";

// The ledger: four verdicts, because two teach outcome-worship.
const VERDICT = { hit: "st-hit", miss: "st-miss", unlucky: "st-unl", lucky: "st-luck", open: "" };

const debriefHTML = (log) =>
  log?.length
    ? section(
        "The ledger",
        `${log.length} entries`,
        `<div class="wagers">${[...log]
          .sort((a, b) => b.gw - a.gw)
          .map(
            (l) =>
              `<div class="wcard"><span class="wtext"><b>GW${esc(l.gw)}</b> ${esc(l.call)}` +
              (l.outcome ? ` <span class="tail">&mdash; ${esc(l.outcome)}</span>` : "") +
              (l.lesson ? `<div class="maction">lesson: ${esc(l.lesson)}</div>` : "") +
              `</span><span class="stamp-v ${esc(VERDICT[l.verdict] ?? "")}">${esc(l.verdict)}</span></div>`
          )
          .join("")}</div>`
      )
    : "";

const doctrineHTML = (rows) =>
  rows?.length
    ? section(
        "What we believe",
        "",
        rows
          .map(
            (d) =>
              `<div class="doc"><span class="dnum">${esc(d.id)}</span>` +
              `<span class="dtext">${esc(d.text)}` +
              (d.status === "new" ? `<span class="newtag">new</span>` : "") +
              `<span class="newtag est">est. ${esc(d.established)}</span></span></div>`
          )
          .join("")
      )
    : "";

function raceHTML(race) {
  if (!race) return "";
  const rows = (race.rows ?? [])
    .map(
      (r) =>
        `<div class="grow${r.is_owner ? " us" : ""}"><span class="rrank">${esc(r.rank ?? "")}</span>` +
        `<span class="gname">${esc(r.name)}</span>` +
        `<span class="gpts">${esc(r.total ?? "—")}</span></div>`
    )
    .join("");
  const bench = (race.benchmarks ?? [])
    .map(
      (b) =>
        `<div class="grow ghost"><span class="rrank"></span><span class="gname">${esc(b.name)}</span>` +
        `<span class="gpts">${esc(b.total ?? "—")}</span></div>`
    )
    .join("");
  return section(
    "The race",
    race.league_name,
    `<div class="board">${rows}` +
      (bench ? `<div class="ghosts"><div class="ghead">Benchmarks &mdash; ride along</div>${bench}</div>` : "") +
      `</div>` +
      (race.note ? `<p class="snote">${esc(race.note)}</p>` : "")
  );
}

const planHTML = (plan) =>
  plan?.outlook
    ? section(
        "The plan",
        "",
        `<p class="reasoning">${esc(plan.outlook)}</p>` +
          (plan.items?.length
            ? `<ul class="brief" style="margin-top:12px">${plan.items
                .map(
                  (i) =>
                    `<li><strong>${esc(i.label)}.</strong> <span class="tail">${esc(i.when)} &mdash; ${esc(i.note)}</span></li>`
                )
                .join("")}</ul>`
            : "")
      )
    : "";

// --------------------------------------------------------------- live strip

function liveHTML(live) {
  if (!live || live.status === "pre") return "";
  const fx = (live.fixtures ?? [])
    .filter((f) => f.started)
    .map(
      (f) =>
        `<div class="lfx"><span class="lteam">${esc(f.home)}</span>` +
        `<span class="lscore">${esc(f.home_score ?? 0)}&ndash;${esc(f.away_score ?? 0)}</span>` +
        `<span class="lteam a">${esc(f.away)}</span>` +
        `<span class="lclock">${f.finished ? "FT" : `${esc(f.minutes ?? 0)}'`}</span></div>`
    )
    .join("");
  const upcoming = (live.fixtures ?? []).filter((f) => !f.started).length;

  let squad = "";
  if (live.squad?.length) {
    // Teams whose match is actually in progress — a player subbed off at 80' in
    // a finished game is done, not still out there.
    const inPlay = new Set(
      (live.fixtures ?? [])
        .filter((f) => f.started && !f.finished)
        .flatMap((f) => [f.home, f.away])
    );

    // A player token on the pitch: name, live points, and a state that reads at
    // a glance — yet to play, on the pitch, or done.
    const token = (p) => {
      const pts = p.points * (p.role === "bench" ? 1 : p.multiplier || 1);
      const state = !p.played ? " yet" : inPlay.has(p.team) ? " on" : " done";
      const badge = p.captain ? "C" : p.vice ? "V" : "";
      const bonus = p.provisional_bonus
        ? `<i class="tb" title="provisional bonus">+${esc(p.provisional_bonus)}</i>`
        : "";
      return (
        `<div class="ptok${state}" data-player="${esc(p.name)}" data-team="${esc(p.team)}" role="button" tabindex="0" title="${esc(p.name)} · ${esc(p.team)} · ${p.played ? `${esc(p.minutes)} min` : "yet to play"}">` +
        `<span class="tpts">${esc(pts)}</span>${bonus}` +
        `<span class="tname">${esc(p.name)}</span>` +
        `<span class="tsub">${esc(p.team)}${badge ? ` <b>${badge}</b>` : ""}${p.played ? ` · ${esc(p.minutes)}'` : ""}</span>` +
        `</div>`
      );
    };

    const starters = live.squad.filter((p) => p.role !== "bench");
    const bench = live.squad
      .filter((p) => p.role === "bench")
      .sort((a, b) => a.position - b.position);
    const line = (pos) => {
      const row = starters.filter((p) => p.pos === pos);
      return row.length ? `<div class="prow">${row.map(token).join("")}</div>` : "";
    };
    const t = live.totals ?? {};
    const formation = ["DEF", "MID", "FWD"].map((p) => starters.filter((x) => x.pos === p).length);

    squad =
      `<div class="pitchwrap"><div class="pitchhead">` +
      `<span class="ph-l">Your live gameweek</span>` +
      `<span class="ph-r">${esc(formation.join("-"))} &middot; ` +
      `<b>${esc(t.net ?? t.starters ?? 0)}</b> pts${t.hits ? ` after &minus;${esc(t.hits)}` : ""}</span></div>` +
      `<div class="pitch">${line("GK")}${line("DEF")}${line("MID")}${line("FWD")}</div>` +
      (bench.length
        ? `<div class="benchrow"><span class="bl">Bench</span>${bench.map(token).join("")}` +
          `<span class="bpts">${esc(t.bench ?? 0)} pts</span></div>`
        : "") +
      `</div>`;
  }

  let league = "";
  if (live.league?.rows?.length) {
    league =
      `<div class="board"><div class="blabel">${esc(live.league.name)} &middot; live</div>` +
      live.league.rows
        .map(
          (r) =>
            `<div class="grow${r.is_owner ? " us" : ""}"><span class="rrank">${esc(r.rank)}</span>` +
            `<span class="gname">${esc(r.name)}</span>` +
            `<span class="gwpts">${esc(r.event_total ?? 0)}</span>` +
            `<span class="gpts">${esc(r.total)}</span></div>`
        )
        .join("") +
      `<p class="race-note">Gameweek points, then season total. Updates when you refresh.</p></div>`;
  }

  const label = live.status === "done" ? "Gameweek complete" : "Live now";
  return section(
    label,
    `GW${esc(live.gw)}${upcoming ? ` · ${upcoming} to come` : ""}`,
    `<div class="livefx">${fx}</div>${squad}${league}` +
      `<p class="snote"><button id="live-refresh" class="refresh" type="button">refresh</button>` +
      `<span class="ltime" id="live-time"></span></p>`
  );
}

// ------------------------------------------------------------------- render

// ---------------------------------------------------------- the player card
//
// The player file is the spine: every name on the page opens the same record,
// so the pitch, the watchlist and the squad boards are all views of one thing.
// Evidence comes from players.json (mechanical); the verdict, direction and
// trigger come from fpl.json (the brain's judgment).

const FILE = { byId: new Map(), byName: new Map(), verdicts: new Map() };

const VERDICT_LABEL = { nailed: "Nailed", solid: "Solid", watch: "Watch", sack: "Sack" };
const MOVED_MARK = { up: "▲", down: "▼", new: "", held: "" };

function indexPlayerFile(players, verdicts) {
  FILE.byId.clear();
  FILE.byName.clear();
  FILE.verdicts.clear();
  for (const p of players ?? []) {
    FILE.byId.set(p.id, p);
    // Names are how the rest of the page refers to players, and web_name is
    // unique in practice apart from the odd shared surname — team disambiguates.
    FILE.byName.set(`${p.name}|${p.team}`, p);
    if (!FILE.byName.has(p.name)) FILE.byName.set(p.name, p);
  }
  for (const v of verdicts ?? []) FILE.verdicts.set(v.id, v);
}

const lookupPlayer = (name, team) =>
  FILE.byName.get(`${name}|${team}`) ?? FILE.byName.get(name) ?? null;

function playerCardHTML(p) {
  const v = FILE.verdicts.get(p.id);
  const fixtures = (p.next3 ?? [])
    .map(
      (f) =>
        `<span class="fc d${esc(f.fdr)}" title="${f.home ? "at home to" : "away at"} ${esc(f.opp)}, GW${esc(f.gw)}">` +
        `${esc(f.opp)}<i>${f.home ? "H" : "A"}</i></span>`
    )
    .join("");

  const verdictBlock = v
    ? `<div class="pc-verdict"><span class="vword v-${esc(v.verdict)}">${esc(VERDICT_LABEL[v.verdict] ?? v.verdict)}` +
      `${MOVED_MARK[v.moved] ? ` <i class="vmove ${esc(v.moved)}">${MOVED_MARK[v.moved]}</i>` : ""}</span>` +
      (v.was ? `<span class="vwas">was ${esc(VERDICT_LABEL[v.was] ?? v.was)}</span>` : "") +
      `<p class="pc-why">${esc(v.why)}</p>` +
      (v.trigger
        ? `<p class="pc-trigger"><span class="tl">What changes it</span>${esc(v.trigger)}</p>`
        : "") +
      `</div>`
    : `<p class="pc-noverdict">No verdict written — the evidence below is all we have on him.</p>`;

  const flag = p.status
    ? `<div class="pc-flag">${esc(p.news || "Flagged — not fully available")}` +
      (p.chance !== undefined ? ` <b>${esc(p.chance)}%</b>` : "") +
      `</div>`
    : "";

  const owned = (p.owned_by ?? []).length
    ? `<div class="pc-owned"><span class="tl">Owned by</span>${p.owned_by.map((n) => `<span class="tchip">${esc(n)}</span>`).join("")}</div>`
    : `<div class="pc-owned"><span class="tl">Owned by</span><span class="ghosttext">nobody in the group</span></div>`;

  return (
    `<div class="pc-head"><span class="pc-name">${esc(p.name)}</span>` +
    `<span class="tchip">${esc(p.team)}</span><span class="posc">${esc(p.pos)}</span>` +
    `<span class="pc-meta">&pound;${esc(price(p.price))}m &middot; ${esc(p.ownership)}% owned` +
    `${p.penalties ? " &middot; on penalties" : ""}</span></div>` +
    flag +
    verdictBlock +
    `<div class="pc-stats">` +
    `<div><span class="tl">Season</span>${esc(p.points ?? 0)} pts</div>` +
    `<div><span class="tl">Form</span>${esc(p.form ?? "—")}</div>` +
    (fixtures
      ? `<div class="pc-fix"><span class="tl">Next three</span><span class="pc-strip">${fixtures}</span>` +
        (p.next3_avg ? `<span class="pc-avg">${esc(p.next3_avg)}</span>` : "") +
        `</div>`
      : "") +
    `</div>` +
    owned
  );
}

function openPlayerCard(name, team) {
  const p = lookupPlayer(name, team);
  const dlg = $("#player-card");
  if (!dlg) return;
  $("#pc-body").innerHTML = p
    ? playerCardHTML(p)
    : `<p class="pc-noverdict">No record for ${esc(name)} yet.</p>`;
  if (typeof dlg.showModal === "function") dlg.showModal();
  else dlg.setAttribute("open", "");
}

// One listener for the whole page: any element carrying data-player opens the
// card. Cheaper than binding hundreds of names, and it survives re-renders.
function wirePlayerCards() {
  if (wirePlayerCards.done) return;
  wirePlayerCards.done = true;
  document.addEventListener("click", (e) => {
    const el = e.target.closest?.("[data-player]");
    if (!el) return;
    e.preventDefault();
    openPlayerCard(el.getAttribute("data-player"), el.getAttribute("data-team") || "");
  });
  const dlg = $("#player-card");
  dlg?.addEventListener("click", (e) => {
    if (e.target === dlg) dlg.close();
  });
  $("#pc-close")?.addEventListener("click", () => dlg?.close());
}

async function loadJSON(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

function showDeadline(data) {
  const el = $("#deadline");
  if (!el || !data.gameweek) return;
  const g = data.gameweek;
  el.innerHTML =
    `<span class="dl">GW${esc(g.id)} deadline</span>${esc(g.deadline_local)}` +
    (g.deadline_utc ? ` <span class="dlrel" id="dlrel"></span>` : "");
  el.hidden = false;
  const rel = $("#dlrel");
  if (!rel || !g.deadline_utc) return;
  const tick = () => {
    const ms = new Date(g.deadline_utc).getTime() - Date.now();
    if (!Number.isFinite(ms)) return;
    if (ms <= 0) {
      rel.textContent = "· deadline passed";
      return;
    }
    const h = Math.floor(ms / 3600000);
    const d = Math.floor(h / 24);
    rel.textContent = d >= 1 ? `· in ${d}d ${h % 24}h` : `· in ${h}h ${Math.floor((ms % 3600000) / 60000)}m`;
    el.classList.toggle("urgent", h < 6);
  };
  tick();
  setInterval(tick, 60000);
}

function showRefreshed(iso) {
  const el = $("#last-refresh");
  if (!el || !iso) return;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return;
  const day = d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  el.textContent = ` · refreshed ${day}, ${time}`;
  el.hidden = false;
}

function render(data, live) {
  // The commons, deliberately short. Dropped 2026-08-23: new_this_season,
  // the template board, penalty takers and the wildcard XI — none earned
  // their space in this format.
  const commons =
    signalsHTML(data.signals) +
    captainHTML(data.captain_poll) +
    fixtureRunsHTML(data.ticker) +
    section("The bus team", "the set-and-forget benchmark", squadDetails(data.bus, "serviced monthly", "rides in the race")) +
    chipsHTML(data.chips);

  const personal =
    callHTML(data) +
    watchlistHTML(data.watchlist) +
    wagersHTML(data.wagers) +
    debriefHTML(data.log) +
    doctrineHTML(data.doctrine) +
    raceHTML(data.race) +
    planHTML(data.plan);

  const hasPersonal = personal.trim() !== "";
  $("#main").innerHTML =
    liveHTML(live) +
    (hasPersonal
      ? `<div class="you-tier">${personal}` +
        `<h2 class="commons-rule">The commons <span class="cr-sub">&middot; same for everyone</span></h2></div>`
      : "") +
    commons;

  wireStars();
  wireLiveRefresh(data);
  if (live?.updated) {
    const t = $("#live-time");
    if (t)
      t.textContent = ` · as of ${new Date(live.updated).toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
      })}`;
  }
}

// Stars are a note-to-self for now: the brain reads what KB actually did from
// the API, not from this browser's localStorage.
function wireStars() {
  const KEY = "touchline-fpl-stars";
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(KEY) || "{}");
  } catch {
    /* ignore */
  }
  document.querySelectorAll("button.star").forEach((b, i) => {
    const id = b.closest("li")?.querySelector(".move")?.textContent?.trim() || `star-${i}`;
    const on = Boolean(saved[id]);
    b.setAttribute("aria-pressed", on ? "true" : "false");
    b.innerHTML = on ? "&#9733;" : "&#9734;";
    b.addEventListener("click", () => {
      const next = b.getAttribute("aria-pressed") !== "true";
      b.setAttribute("aria-pressed", next ? "true" : "false");
      b.innerHTML = next ? "&#9733;" : "&#9734;";
      saved[id] = next;
      try {
        localStorage.setItem(KEY, JSON.stringify(saved));
      } catch {
        /* ignore */
      }
    });
  });
}

let liveBusy = false;
function wireLiveRefresh(data) {
  const btn = $("#live-refresh");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    if (liveBusy) return;
    liveBusy = true;
    btn.textContent = "refreshing…";
    const live = await fetchLive(data);
    liveBusy = false;
    if (live) render(data, live);
    else btn.textContent = "refresh failed";
  });
}

// The live view needs a Pages Function because the FPL API sends no CORS
// headers. Absent or failing, the page is simply the static one.
async function fetchLive(data) {
  const gw = data.live_gameweek?.id;
  if (!gw) return null;
  const params = new URLSearchParams({ gw: String(gw) });
  if (data.desk?.entry_id) params.set("entry", String(data.desk.entry_id));
  if (data.race?.league_id) params.set("league", String(data.race.league_id));
  try {
    const res = await fetch(`/api/live?${params}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function setupSync() {
  const btn = $("#sync");
  if (!btn) return;
  const label = btn.querySelector(".sync-label");
  const apply = (on) => {
    document.documentElement.classList.toggle("synced", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    if (label) label.textContent = on ? "synced" : "sync";
    try {
      localStorage.setItem("touchline-fpl-sync", on ? "1" : "0");
    } catch {
      /* ignore */
    }
  };
  let on = false;
  try {
    on = localStorage.getItem("touchline-fpl-sync") === "1";
  } catch {
    /* ignore */
  }
  apply(on);
  btn.addEventListener("click", () => apply(!document.documentElement.classList.contains("synced")));
}

// Theme toggle: auto (follow OS) -> light -> dark -> auto.
function setupThemeToggle() {
  const button = $("#theme-toggle");
  if (!button) return;
  const MODES = ["auto", "light", "dark"];
  const label = { auto: "◐ auto", light: "○ light", dark: "● dark" };
  const apply = (mode) => {
    if (mode === "auto") {
      document.documentElement.removeAttribute("data-theme");
      localStorage.removeItem("touchline-theme");
    } else {
      document.documentElement.setAttribute("data-theme", mode);
      localStorage.setItem("touchline-theme", mode);
    }
    button.textContent = label[mode];
  };
  let mode = localStorage.getItem("touchline-theme");
  if (!MODES.includes(mode)) mode = "auto";
  apply(mode);
  button.addEventListener("click", () => {
    mode = MODES[(MODES.indexOf(mode) + 1) % MODES.length];
    apply(mode);
  });
}

async function load() {
  const data = await loadJSON("data/fpl.json");
  // The player file is optional: if it is missing or stale the page still
  // renders, names simply stop opening cards.
  const file = await loadJSON("data/players.json").catch(() => null);
  indexPlayerFile(file?.players, data.verdicts);
  wirePlayerCards();
  showDeadline(data);
  showRefreshed(data.generated_at);
  render(data, null);
  const live = await fetchLive(data);
  if (live) render(data, live);
}

setupThemeToggle();
setupSync();

load().catch((err) => {
  $("#main").innerHTML = `<p class="empty">Could not load the planner: ${esc(err.message)}</p>`;
});
