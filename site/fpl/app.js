// Touchline FPL planner — renders site/data/fpl.json into #main.
// Same conventions as ../app.js (which stays untouched — this page duplicates
// the tiny shared helpers, the established cost of page independence here).
const $ = (sel) => document.querySelector(sel);

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const price = (n) => `£${Number(n).toFixed(1)}m`;

const initials = (name) =>
  String(name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("") || "?";

const POS_ORDER = { GK: 0, DEF: 1, MID: 2, FWD: 3 };

function badgesHTML(p) {
  let badges = "";
  if (p.captain) badges += `<span class="cap">C</span>`;
  if (p.vice) badges += `<span class="cap v">V</span>`;
  if (p.bet) badges += `<span class="bet">bet</span>`;
  return badges;
}

function squadRowHTML(p, lead) {
  const note = p.note
    ? `<div class="bnote">${esc(p.note)}</div>`
    : "";
  return `
      <div class="brow">
        <span class="who">${lead}<span class="ha">${esc(p.pos)}</span>${esc(p.name)}<span class="ha">${esc(p.team)}</span>${badgesHTML(p)}</span>
        <span class="meta">${esc(price(p.price))}</span>
      </div>${note}`;
}

function squadHTML(squad) {
  if (!squad?.players?.length) return "";
  const starters = squad.players
    .filter((p) => p.role === "start")
    .sort((a, b) => (POS_ORDER[a.pos] ?? 9) - (POS_ORDER[b.pos] ?? 9) || b.price - a.price);
  const bench = squad.players
    .filter((p) => p.role === "bench")
    .sort((a, b) => (a.bench_order ?? 9) - (b.bench_order ?? 9));
  const xi = starters.map((p) => squadRowHTML(p, "")).join("");
  const sub = bench
    .map((p) => squadRowHTML(p, `<span class="bord">${esc(p.bench_order)}</span>`))
    .join("");
  return `<section><h2>The squad</h2>
    <div class="board">
      <div class="blabel">Starting XI &middot; ${esc(squad.formation)} &middot; bank ${esc(squad.bank)}</div>${xi}
    </div>
    <div class="board bench">
      <div class="blabel">Bench &middot; in order</div>${sub}
    </div></section>`;
}

function movesHTML(moves) {
  if (!moves?.length) return "";
  const rows = moves
    .map(
      (m) => `
      <div class="brow">
        <span class="who">${esc(m.out)} &rarr; <strong>${esc(m.in)}</strong><span class="ha">${esc(m.cost)}</span></span>
      </div>
      <div class="bnote">${esc(m.note)}</div>`
    )
    .join("");
  return `<div class="board"><div class="blabel">This week's moves</div>${rows}</div>`;
}

function callExtrasHTML(call) {
  const items = [];
  if (call.chip)
    items.push(`<li><strong>Chip.</strong> <span class="tail">${esc(call.chip)}</span></li>`);
  for (const a of call.alternatives ?? [])
    items.push(
      `<li><strong>Considered.</strong> <span class="tail">${esc(a.call)} &mdash; ${esc(a.why_not)}</span></li>`
    );
  return items.length ? `<ul class="brief">${items.join("")}</ul>` : "";
}

const watchlistHTML = (watchlist) =>
  watchlist?.length
    ? `<section><h2>Watchlist</h2><div class="players">${watchlist
        .map(
          (w) =>
            `<div class="player"><span class="avatar">${esc(initials(w.name))}</span>` +
            `<div><div class="ptop"><span class="pname">${esc(w.name)}</span>` +
            `<span class="ptag">${esc(w.team)} &middot; ${esc(w.pos)} &middot; ${esc(price(w.price))}${w.ownership ? ` &middot; ${esc(w.ownership)}` : ""}</span>` +
            `<span class="ptag ${esc(w.status)}">${esc(w.status)}</span></div>` +
            `<div class="pnote">${esc(w.note)}</div></div></div>`
        )
        .join("")}</div></section>`
    : "";

function signalsHTML(signals) {
  if (!signals?.length) return "";
  const items = signals
    .map((s) => {
      const who = s.player || s.team || "";
      const src = s.url
        ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.source)}</a>`
        : esc(s.source);
      return `
      <div class="rumour">
        <div class="mtop">
          <span class="mplayer">${esc(who)}</span>
          <span class="route">${src}</span>
          <span class="sig ${esc(s.tag)}">${esc(s.tag)}</span>
        </div>
        <div class="mnote">${esc(s.text)}</div>
        <div class="maction">&rarr; ${esc(s.action)}</div>
      </div>`;
    })
    .join("");
  return `<section><h2>Signals</h2><div class="rumours">${items}</div></section>`;
}

function tickerHTML(ticker) {
  if (!ticker?.rows?.length) return "";
  const gws = Array.from({ length: ticker.gws }, (_, i) => ticker.from_gw + i);
  const head =
    `<div class="frow fhead"><span class="ft"></span>` +
    gws.map((g) => `<span class="fslot"><span class="fc">GW${esc(g)}</span></span>`).join("") +
    `<span class="favg">avg</span></div>`;
  const rows = ticker.rows
    .map((r) => {
      // One .fslot per GW keeps columns aligned; a double GW stacks two .fc
      // cells inside its slot, a blank GW renders a dash.
      const cells = gws
        .map((g) => {
          const fx = r.fixtures.filter((f) => f.gw === g);
          const inner = fx.length
            ? fx
                .map((f) => {
                  const label = f.home ? esc(f.opp) : esc(f.opp).toLowerCase();
                  return `<span class="fc fdr${esc(f.fdr)}" title="${esc(r.team)} ${f.home ? "vs" : "at"} ${esc(f.opp)}, GW${esc(f.gw)}">${label}</span>`;
                })
                .join("")
            : `<span class="fc blank">&mdash;</span>`;
          return `<span class="fslot">${inner}</span>`;
        })
        .join("");
      return `<div class="frow"><span class="ft">${esc(r.team)}</span>${cells}<span class="favg">${esc(r.avg)}</span></div>`;
    })
    .join("");
  return `<section><h2>Fixture ticker &middot; GW${esc(ticker.from_gw)}&ndash;${esc(ticker.from_gw + ticker.gws - 1)}</h2>
    <div class="fdr">${head}${rows}</div>
    <p class="fdr-note">Sorted easiest run first. CAPS home, lowercase away; colour is official FPL difficulty.</p></section>`;
}

const planHTML = (plan) =>
  plan?.outlook
    ? `<section><h2>The plan</h2><p>${esc(plan.outlook)}</p>${
        plan.items?.length
          ? `<ul class="brief" style="margin-top:12px">${plan.items
              .map(
                (i) =>
                  `<li><strong>${esc(i.label)}.</strong> <span class="tail">${esc(i.when)} &mdash; ${esc(i.note)}</span></li>`
              )
              .join("")}</ul>`
          : ""
      }</section>`
    : "";

function logHTML(log) {
  if (!log?.length) return "";
  const items = [...log]
    .sort((a, b) => b.gw - a.gw)
    .map(
      (l) => `
      <div class="rumour">
        <div class="mtop">
          <span class="mplayer">GW${esc(l.gw)}</span>
          <span class="route">${esc(l.date)}</span>
          <span class="vpill ${esc(l.verdict)}">${esc(l.verdict)}</span>
        </div>
        <div class="mnote">${esc(l.call)}</div>
        ${l.outcome ? `<div class="mnote">${esc(l.outcome)}</div>` : ""}
        ${l.lesson ? `<div class="maction">lesson: ${esc(l.lesson)}</div>` : ""}
      </div>`
    )
    .join("");
  return `<section><h2>The ledger</h2><div class="rumours">${items}</div></section>`;
}

async function loadJSON(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

// Footer stamp for `generated_at` (written by curate-fpl.sh), reader-local time.
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

async function load() {
  const data = await loadJSON("../data/fpl.json");
  showRefreshed(data.generated_at);
  const main = $("#main");

  const eyebrow = data.gameweek
    ? `GW${esc(data.gameweek.id)} &middot; deadline ${esc(data.gameweek.deadline_local)}`
    : `FPL planner${data.season ? ` &middot; ${esc(data.season)}` : ""}`;

  if (!data.call && !data.squad) {
    main.innerHTML = `<article class="digest">
      <div class="eyebrow">${eyebrow}</div>
      <h1>No plan yet</h1>
      <p class="empty">The first call lands here before the deadline.</p>
      ${tickerHTML(data.ticker)}
    </article>`;
    return;
  }

  main.innerHTML = `<article class="digest">
    <div class="eyebrow">${eyebrow}</div>
    <h1>${esc(data.call?.headline ?? "The squad")}</h1>
    ${data.call?.reasoning ? `<p class="standfirst">${esc(data.call.reasoning)}</p>` : ""}
    ${movesHTML(data.call?.moves)}
    ${data.call ? callExtrasHTML(data.call) : ""}
    ${squadHTML(data.squad)}
    ${watchlistHTML(data.watchlist)}
    ${signalsHTML(data.signals)}
    ${tickerHTML(data.ticker)}
    ${planHTML(data.plan)}
    ${logHTML(data.log)}
  </article>`;
}

// Theme toggle: identical to ../app.js.
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

setupThemeToggle();

load().catch((err) => {
  $("#main").innerHTML = `<p class="empty">Could not load the FPL plan: ${esc(err.message)}</p>`;
});
