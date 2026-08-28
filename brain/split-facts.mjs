#!/usr/bin/env node
// Split the FPL facts bundle into the mechanical files the site reads directly,
// and print what's left for the brain's prompt.
//
//   uv run touchline fpl | node brain/split-facts.mjs > brain/scratch/facts-fpl.json
//
// Why this exists: prices, squads and fixtures are facts. Routing ~600 player
// records and five squads through an LLM costs six figures of tokens per run
// to copy numbers verbatim, and invites transcription errors on the way. So
// they go straight to disk; the brain gets the compact remainder and spends
// its budget on judgment (verdicts, the weekly reads, the roast).
import { readFileSync, writeFileSync } from "node:fs";

const bundle = JSON.parse(readFileSync(0, "utf8"));
const stamp = new Date().toISOString();
const gw = bundle.gameweek?.id ?? null;

/* --- the player file: one evidence record per player, every player ---
   `owned_by` is built from the squads, so a deadline lock empties it for all
   620 players just as it empties the room: every card reads "nobody in the
   five", every owner dot vanishes, and a player under the ownership floor who
   is only in the file BECAUSE one of the five owns him drops out of it
   altogether. Same outage, same answer — carry the last known owners
   forward. */
function carryForwardOwners(players) {
  if (players.some((p) => p.owned_by?.length)) return players;
  let previous;
  try {
    previous = JSON.parse(readFileSync("site/data/players.json", "utf8"));
  } catch {
    return players;
  }
  const was = new Map(
    (previous.players ?? []).filter((p) => p.owned_by?.length).map((p) => [p.id, p.owned_by])
  );
  if (!was.size) return players;
  console.error(`split: no squads, so no owners — carrying forward ${was.size} owned players`);
  return players.map((p) => (was.has(p.id) ? { ...p, owned_by: was.get(p.id) } : p));
}

writeFileSync(
  "site/data/players.json",
  JSON.stringify(
    {
      generated_at: stamp,
      gameweek: gw,
      players: carryForwardOwners(bundle.player_file ?? []),
    },
    null,
    2
  ) + "\n"
);

// --- the gaffers: five squads and their standings, by nickname ---
// The league carries every entry, but the five are the product; the page shows
// them compressed and expands to the rest on request.
const league = (bundle.leagues ?? [])[0] ?? null;
const nicks = new Set((bundle.squads ?? []).map((s) => s.nick));
const gaffers = {
  generated_at: stamp,
  gameweek: gw,
  // The deadline travels with the gameweek it belongs to. Without it the room
  // could tell you which gameweek was next but not when it locked, which is
  // the only thing anyone actually wants to know between weeks.
  deadline_utc: bundle.gameweek?.deadline_utc ?? null,
  deadline_local: bundle.gameweek?.deadline_local ?? null,
  live_gameweek: bundle.live_gameweek ?? null,
  people: (bundle.squads ?? []).map((s) => {
    const row = (league?.rows ?? []).find((r) => r.nick === s.nick) ?? null;
    return {
      nick: s.nick,
      club: s.club ?? null,
      team_name: s.team_name,
      entry: row?.entry ?? null,
      entered: s.entered ?? false,
      total_points: s.total_points ?? null,
      gw_points: s.gw_points ?? null,
      overall_rank: s.overall_rank ?? null,
      bank: s.bank ?? null,
      value: s.value ?? null,
      transfers_made: s.transfers_made ?? null,
      chips_used: s.chips_used ?? [],
      league_rank: row?.rank ?? null,
      active_chip: s.active_chip ?? null,
      bench_points: s.bench_points ?? null,
      transfers_cost: s.transfers_cost ?? 0,
      // Captaincy and the multiplier were being dropped here, which quietly
      // made every squad unscoreable: a pitch cannot show a (C) and a total
      // cannot double the right player. They are facts; they pass through.
      picks: (s.picks ?? []).map((p) => ({
        element: p.element,
        position: p.position,
        role: p.role,
        bench_order: p.bench_order ?? null,
        name: p.name,
        team: p.team,
        pos: p.pos,
        price: p.price,
        status: p.status ?? null,
        captain: !!p.captain,
        vice: !!p.vice,
        multiplier: p.multiplier ?? 1,
      })),
    };
  }),
  league: league
    ? {
        id: league.id,
        name: league.name,
        rows: league.rows.map((r) => ({ ...r, is_gaffer: nicks.has(r.nick) })),
      }
    : null,
};
/* Never publish an empty room over a full one.
   =========================================================================
   FPL takes its entry endpoints down around every deadline: `entry/{id}/
   event/{gw}/picks/` answers 503 for EVERY gameweek, not just the new one,
   for as long as the lock lasts. The bundle reports that honestly as no
   squads, and this file used to write it straight through — so five squads
   became zero, and the gaffers room rendered nothing at all.

   The squads have not changed; the API is simply refusing to say what they
   are. So the last known ones are carried forward and marked stale, and the
   room says which day they are from. That is a true statement, where an
   empty room was a false one. This happens every Friday evening, so it is
   the normal case and not an edge one. */
function carryForwardSquads(next) {
  if (next.people.length) return next;
  let previous;
  try {
    previous = JSON.parse(readFileSync("site/data/gaffers.json", "utf8"));
  } catch {
    return next; // nothing to fall back to; a first run has to start somewhere
  }
  if (!previous.people?.length) return next;
  console.error(
    `split: FPL published no squads (deadline lock) — carrying forward ` +
    `${previous.people.length} from ${previous.people_as_of ?? previous.generated_at}`
  );
  return {
    ...next,
    people: previous.people,
    // The mini-league standings come from the same locked endpoints, so they
    // vanish on exactly the same runs and come back the same way.
    league: next.league ?? previous.league ?? null,
    // The stamp the squads actually belong to, which survives repeated
    // carry-forwards rather than creeping to today on each one.
    people_as_of: previous.people_as_of ?? previous.generated_at,
    people_stale: true,
  };
}

const published = carryForwardSquads(gaffers);
writeFileSync("site/data/gaffers.json", JSON.stringify(published, null, 2) + "\n");

// --- what the brain actually needs to read ---
delete bundle.player_file;
delete bundle.squads;
process.stdout.write(JSON.stringify(bundle, null, 2));

const players = JSON.parse(readFileSync("site/data/players.json", "utf8")).players ?? [];
console.error(
  `split: players.json ${players.length} records · gaffers.json ` +
  `${published.people.length} people${published.people_stale ? " (carried forward)" : ""}`
);
