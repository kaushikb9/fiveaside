// Touchline reader — renders site/data/digests.json (+ optional site/data/config.json)
// into #main. No framework, no build step, no external CDNs.
const $ = (sel) => document.querySelector(sel);

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// "Sunday 16 August 2026" (mockup's eyebrow format — en-GB's built-in long form
// inserts a comma after the weekday, so the two parts are formatted separately).
const fmtLong = (iso) => {
  const d = new Date(`${iso}T00:00:00`);
  const weekday = d.toLocaleDateString("en-GB", { weekday: "long" });
  const rest = d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  return `${weekday} ${rest}`;
};

// "16 Aug" (mockup's archive row date format).
const fmtShort = (iso) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

// Up to 3-char initials for a crest placeholder: "West Ham" -> "WH", "Arsenal" -> "ARS".
function initials(name) {
  const words = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
  return words.slice(0, 3).map((w) => w[0]).join("").toUpperCase();
}

// Crest image if a URL is present, else the mockup's .crest.ph initials placeholder.
// `extra` adds a modifier class (e.g. "sm" for the mini table / strap).
function crestHTML(src, name, extra = "") {
  const cls = extra ? ` ${extra}` : "";
  if (src) return `<img class="crest${cls}" src="${esc(src)}" alt="${esc(name ?? "")}">`;
  return `<span class="crest ph${cls}">${esc(initials(name))}</span>`;
}

function latestResultHTML(lr) {
  if (!lr) return "";
  return `
    <div class="board">
      <div class="blabel">Latest result</div>
      <div class="brow${lr.result === "W" ? " win-row" : ""}">
        <span class="who">${crestHTML(lr.home_crest, lr.home)}${esc(lr.home)} <span class="score">${esc(lr.score)}</span> ${esc(lr.away)}${crestHTML(lr.away_crest, lr.away)}</span>
        <span class="meta">${lr.date ? `${esc(lr.date)} &middot; ` : ""}${esc(lr.competition)} &middot; FT</span>
      </div>
    </div>`;
}

function fixturesHTML(fixtures) {
  if (!fixtures?.length) return "";
  const rows = fixtures
    .map(
      (f) => `
      <div class="brow">
        <span class="who">${crestHTML(f.opponent_crest, f.opponent)}${esc(f.opponent)}<span class="ha">${f.home ? "H" : "A"}</span></span>
        <span class="meta">${esc(f.kickoff_local)} &middot; ${esc(f.competition)}</span>
      </div>`
    )
    .join("");
  return `<div class="board"><div class="blabel">Up next</div>${rows}</div>`;
}

// Hover title for a form pill, mirroring the mockup's descriptive tooltips.
function formTitle(f, isLast) {
  const verbs = {
    W: `Beat ${f.opponent} ${f.score}`,
    L: `Lost ${f.score} to ${f.opponent}`,
    D: `Drew ${f.score} with ${f.opponent}`,
  };
  const base = `${verbs[f.result] ?? `${f.result} ${f.score} vs ${f.opponent}`}, ${f.competition}`;
  return isLast ? `${base} — latest` : base;
}

function formHTML(form) {
  if (!form?.length) return "";
  const items = form
    .map((f, i) => {
      const isLast = i === form.length - 1;
      return `
      <div class="fi${isLast ? " latest" : ""}" title="${esc(formTitle(f, isLast))}">
        <span class="pill ${esc(f.result.toLowerCase())}">${esc(f.score)}</span>${crestHTML(f.opponent_crest, f.opponent)}<span class="comp">${esc(f.competition)}</span>
      </div>`;
    })
    .join("");
  return `<div><div class="blabel">Form &middot; last five</div><div class="form-row">${items}</div></div>`;
}

function tableHTML(table) {
  if (!table) return "";
  const rows = table.rows
    .map(
      (r) => `
      <div class="mrow${r.pos === table.club_position ? " us" : ""}">
        <span class="pos">${esc(r.pos)}</span>${crestHTML(r.crest, r.team, "sm")}<span class="tname">${esc(r.team)}</span><span class="num">${esc(r.played)}</span><span class="num">${esc(r.points)}</span>
      </div>`
    )
    .join("");
  return `<div><div class="blabel">${esc(table.competition)}</div><div class="mini">
      <div class="mrow mhead"><span class="pos">#</span><span class="tname"></span><span class="num">P</span><span class="num">Pts</span></div>
      ${rows}
    </div></div>`;
}

// Form + table render side by side; the whole split block only exists if either half does.
function splitHTML(club) {
  const form = formHTML(club.form);
  const table = tableHTML(club.table);
  if (!form && !table) return "";
  return `<div class="board split">${form}${table}</div>`;
}

// Deterministic source-colored fallback tile for links with no `image`.
const THUMB_COLORS = ["#ff5722", "#052962", "#1e7d4c", "#7b3fa0", "#b8860b", "#345995"];
function hashStr(s) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}
function thumbHTML(item) {
  if (item.image) return `<img class="thumb" src="${esc(item.image)}" alt="">`;
  const letter = ((item.source ?? item.title).trim()[0] || "•").toUpperCase();
  const color = THUMB_COLORS[hashStr(item.title) % THUMB_COLORS.length];
  return `<div class="thumb ph" style="background:${color}">${esc(letter)}</div>`;
}

function linkCard(item) {
  return `
    <a class="pick" href="${esc(item.url)}" target="_blank" rel="noopener">
      ${thumbHTML(item)}
      <span><span class="t">${esc(item.title)}</span><span class="hook">${esc(item.hook)}</span>${item.source ? `<span class="src">${esc(item.source)}</span>` : ""}</span>
    </a>`;
}

function widerHTML(wider) {
  if (!wider?.length) return "";
  return `<section><h2>The wider game</h2><div class="linklist">${wider.map(linkCard).join("")}</div></section>`;
}

function readHTML(read) {
  if (!read) return "";
  return `<section><h2>One good read</h2><div class="linklist">${linkCard(read)}</div></section>`;
}

const weekHTML = (items) =>
  items?.length
    ? `<section><h2>This week</h2><ul class="brief">${items
        .map(
          (w) =>
            `<li><strong>${esc(w.kicker)}</strong> <span class="tail">${esc(w.text)}</span></li>`
        )
        .join("")}</ul></section>`
    : "";

const teamWatchInitials = (name) =>
  String(name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");

const teamWatchHTML = (players) =>
  players?.length
    ? `<section><h2>Team watch</h2><div class="players">${players
        .map(
          (p) =>
            `<div class="player"><span class="avatar${p.talent ? " talent" : ""}">${esc(teamWatchInitials(p.name))}</span>` +
            `<div><div class="ptop"><span class="pname">${esc(p.name)}</span>` +
            `<span class="ptag${p.talent ? " talent" : ""}">${esc(p.tag)}</span></div>` +
            `<div class="pnote">${esc(p.note)}</div></div></div>`
        )
        .join("")}</div></section>`
    : "";

function rivalsHTML(rivals, heading = "Rival watch") {
  if (!rivals?.length) return "";
  const items = rivals
    .map(
      (r) => `
      <div class="rival">
        ${crestHTML(r.crest, r.club)}
        <div>
          <div class="rtop"><span class="rname">${esc(r.club)}</span><span class="rmeta">${esc(r.line)}</span></div>
          <div class="rnote">${esc(r.note)}</div>
        </div>
      </div>`
    )
    .join("");
  return `<section><h2>${esc(heading)}</h2><div class="rivals">${items}</div></section>`;
}

function elsewhereHTML(rows) {
  if (!rows?.length) return "";
  const items = rows
    .map(
      (r) => `
      <div class="rival">
        ${crestHTML(r.crest, r.club)}
        <div>
          <div class="rtop"><span class="rname">${esc(r.club)}</span></div>
          <div class="rnote">${esc(r.note)}</div>
        </div>
      </div>`
    )
    .join("");
  return `<section><h2>Around the grounds</h2><div class="rivals">${items}</div></section>`;
}

// Heat labels are the data values; "here we go" is the legacy spelling of "done".
const HEAT_CLASS = { done: "done", "here we go": "done", close: "close", talks: "talks", smoke: "smoke" };

function rumoursHTML(rumours) {
  if (!rumours?.length) return "";
  const items = rumours
    .map(
      (r) => `
      <div class="rumour">
        <div class="mtop">
          <span class="mplayer">${esc(r.player)}</span>
          <span class="route">${esc(r.from)} &rarr; <span class="dest">${esc(r.to)}</span>${r.fee ? ` &middot; ${esc(r.fee)}` : ""}</span>
          <span class="heat ${HEAT_CLASS[r.heat] ?? "smoke"}">${esc(r.heat)}</span>
        </div>
        <div class="mnote">${esc(r.note)}</div>
      </div>`
    )
    .join("");
  return `<section><h2>Rumour mill</h2><div class="rumours">${items}</div></section>`;
}

// Everything inside a digest, without an outer wrapper — reused for both the
// latest entry (wrapped in <article class="digest">) and archived entries
// (wrapped in <div class="abody"> inside a collapsed <details>).
function digestContent(d) {
  const club = d.club ?? {};
  return `
    <div class="eyebrow">${esc(fmtLong(d.date))}</div>
    <h1>${esc(d.headline)}</h1>
    ${latestResultHTML(club.latest_result)}
    ${fixturesHTML(club.fixtures)}
    ${splitHTML(club)}
    ${weekHTML(d.week)}
    <section><h2>Today</h2><p>${esc(d.today)}</p></section>
    ${teamWatchHTML(d.team_watch)}
    ${readHTML(d.read)}
    ${rivalsHTML(d.top_teams, "Around the top") || rivalsHTML(d.rivals)}
    ${elsewhereHTML(d.elsewhere)}
    ${rumoursHTML(d.rumours)}
    ${widerHTML(d.wider)}`;
}

async function loadJSON(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

async function applyConfig() {
  let config = null;
  try {
    config = await loadJSON("../data/config.json");
  } catch {
    /* config.json is optional — generated at deploy time */
  }
  if (!config?.club?.name) return;
  $("#club-label").textContent = config.club.name;
  const crestEl = $("#club-crest");
  crestEl.innerHTML = crestHTML(config.club.crest, config.club.code || config.club.name, "sm");
  crestEl.hidden = false;
  $("#strap-dot").hidden = false;
}

// Footer stamp for `generated_at` (written by curate.sh), shown in the
// reader's local time. Falls back to the newest digest's date when absent.
function showRefreshed(iso, latestDate) {
  const el = $("#last-refresh");
  if (!el) return;
  let text;
  if (iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return;
    const day = d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    text = `refreshed ${day}, ${time}`;
  } else if (latestDate) {
    text = `refreshed ${fmtShort(latestDate)}`;
  } else {
    return;
  }
  el.textContent = ` · ${text}`;
  el.hidden = false;
}

async function load() {
  await applyConfig();

  const data = await loadJSON("../data/digests.json");
  const entries = [...(data.digests ?? [])].sort((a, b) => b.date.localeCompare(a.date));
  const main = $("#main");
  if (!entries.length) {
    main.innerHTML = `<p class="empty">No digests yet &mdash; run <code>./brain/curate.sh</code>.</p>`;
    return;
  }

  showRefreshed(data.generated_at, entries[0].date);

  const [latest, ...past] = entries;
  let html = `<article class="digest">${digestContent(latest)}</article>`;
  if (past.length) {
    html +=
      `<div class="archive-rule">Archive</div>` +
      past
        .map(
          (d) => `
        <details class="arch">
          <summary><span class="adate">${esc(fmtShort(d.date))}</span><span class="ahead">${esc(d.headline)}</span></summary>
          <div class="abody">${digestContent(d)}</div>
        </details>`
        )
        .join("");
  }
  main.innerHTML = html;
}

// Theme toggle: auto (follow OS) -> light -> dark -> auto. Persisted in localStorage;
// the inline <head> script re-applies it before first paint on later visits.
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
  $("#main").innerHTML = `<p class="empty">Could not load digests: ${esc(err.message)}</p>`;
});
