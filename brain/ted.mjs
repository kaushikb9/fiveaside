#!/usr/bin/env node
// Ted's week — the clock the ghost manager runs on, and the freeze.
//
//   node brain/ted.mjs phase [--at ISO]   -> {"phase":..., "gw":..., "hours":...}
//   node brain/ted.mjs settle <before.json> [after.json]
//
// Ted picks a fresh fifteen every gameweek and never carries a transfer or a
// chip. The site draws that in four states, and both ends read the same two
// instants that split-facts.mjs writes into gaffers.json (`ted.draft_opens_utc`
// and `ted.freeze_utc`, from the owner config):
//
//   live        a gameweek is being played — his pitch shows the scores
//   rebuilding  the week has settled and the draft window has not opened;
//               last week's team stays up with a note, nothing for next week
//   draft       the window is open — the brain may rewrite his fifteen on
//               every run, and the room shows what changed since the last one
//   frozen      inside the freeze — the team sheet is in, the brain may not
//               touch it, the room says so
//
// `settle` is the guard the prompt cannot be trusted with: it runs after the
// brain has written fpl.json and puts the previous `ted` section back whenever
// the phase does not allow a rewrite, so "be brief" and "do not touch" are
// enforced by a file diff rather than by an instruction.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function tedPhase(g, now = Date.now()) {
  // Mirrors tedPhase() in site/gaffers/app.js — change both.
  if (!g) return { phase: "rebuilding", gw: null, hours: null };
  const live = g.live_gameweek;
  const inPlay = Boolean(live && !live.finished);
  const dl = g.deadline_utc ? Date.parse(g.deadline_utc) : NaN;
  const hours = Number.isNaN(dl) ? null : (dl - now) / 3600000;
  const opens = g.ted?.draft_opens_utc ? Date.parse(g.ted.draft_opens_utc) : NaN;
  const freeze = g.ted?.freeze_utc ? Date.parse(g.ted.freeze_utc) : NaN;
  if (inPlay) return { phase: "live", gw: live.id, hours };
  if (Number.isNaN(dl) || Number.isNaN(opens) || Number.isNaN(freeze)) {
    return { phase: "rebuilding", gw: g.gameweek ?? null, hours };
  }
  if (now < opens) return { phase: "rebuilding", gw: g.gameweek, hours };
  if (now < freeze) return { phase: "draft", gw: g.gameweek, hours };
  return { phase: "frozen", gw: g.gameweek, hours };
}

const names = (t) => (t?.picks ?? []).map((p) => p.name);

// What the brain may change in `ted`, given the phase — and what it may not.
//  draft       everything, for the gameweek being planned; `changes` is
//              recomputed against the previous run so the room can say
//              "since Tuesday: in X, out Y"
//  rebuilding  only `rebuild` (the note on the week just gone); the fifteen
//              stay last week's
//  live/frozen nothing — the previous section is restored whole
export function settleTed(before, after, g, now = Date.now()) {
  const { phase, gw } = tedPhase(g, now);
  const prev = before?.ted ?? null;
  const next = after?.ted ?? null;
  if (phase === "live" || phase === "frozen") {
    return { ted: prev, phase, note: prev ? "restored — no changes allowed in " + phase : "nothing to restore" };
  }
  if (phase === "rebuilding") {
    if (!prev) return { ted: next && next.rebuild ? { gw: next.gw ?? gw, rebuild: next.rebuild } : null, phase, note: "no previous team" };
    return { ted: { ...prev, rebuild: next?.rebuild ?? prev.rebuild }, phase, note: "kept last week's fifteen; took the rebuild note" };
  }
  // draft
  if (!next || !next.picks?.length) return { ted: prev, phase, note: "brain wrote no team — kept the previous one" };
  const out = { ...next, gw: next.gw ?? gw };
  delete out.rebuild;
  // `changes` is measured against the FIRST draft of this gameweek, not the
  // run before: "since Tuesday: in X, out Y" is what the room says, and a man
  // swapped out on Wednesday and back on Thursday is not a change. The first
  // draft's names ride along mechanically so the diff never needs history.
  if (prev && prev.gw === out.gw && prev.picks?.length) {
    out.first_draft = prev.first_draft ?? prev.written ?? null;
    out.first_names = prev.first_names ?? names(prev);
    const first = new Set(out.first_names), is = new Set(names(out));
    out.changes = {
      since: out.first_draft,
      in: [...is].filter((n) => !first.has(n)),
      out: [...first].filter((n) => !is.has(n)),
    };
    if (!out.changes.in.length && !out.changes.out.length) delete out.changes;
  } else {
    delete out.changes;
    out.first_draft = out.written ?? null;
    out.first_names = names(out);
  }
  return { ted: out, phase, note: out.changes ? `draft updated — in ${out.changes.in.join(", ") || "none"}; out ${out.changes.out.join(", ") || "none"}` : "draft written" };
}

// Compared on the full path: the test file is also called ted.mjs, and a
// basename match ran this CLI when the test imported it.
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  const [cmd, ...rest] = process.argv.slice(2);
  const read = (p) => JSON.parse(readFileSync(p, "utf8"));
  const at = rest.includes("--at") ? Date.parse(rest[rest.indexOf("--at") + 1]) : Date.now();
  const g = read("site/data/gaffers.json");
  if (cmd === "phase") {
    process.stdout.write(JSON.stringify(tedPhase(g, at)) + "\n");
  } else if (cmd === "settle") {
    const beforePath = rest[0];
    const afterPath = rest[1] ?? "site/data/fpl.json";
    if (!beforePath) { console.error("usage: node brain/ted.mjs settle <before.json> [after.json]"); process.exit(2); }
    const before = read(beforePath), after = read(afterPath);
    const r = settleTed(before, after, g, at);
    if (r.ted) after.ted = r.ted; else delete after.ted;
    writeFileSync(afterPath, JSON.stringify(after, null, 2) + "\n");
    console.error(`ted: ${r.phase} — ${r.note}`);
  } else {
    console.error("usage: node brain/ted.mjs phase [--at ISO] | settle <before.json> [after.json]");
    process.exit(2);
  }
}
