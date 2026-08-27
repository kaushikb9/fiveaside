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

// --- the player file: one evidence record per player, every player ---
writeFileSync(
  "site/data/players.json",
  JSON.stringify(
    { generated_at: stamp, gameweek: gw, players: bundle.player_file ?? [] },
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
writeFileSync("site/data/gaffers.json", JSON.stringify(gaffers, null, 2) + "\n");

// --- what the brain actually needs to read ---
delete bundle.player_file;
delete bundle.squads;
process.stdout.write(JSON.stringify(bundle, null, 2));

const players = JSON.parse(readFileSync("site/data/players.json", "utf8")).players ?? [];
console.error(
  `split: players.json ${players.length} records · gaffers.json ${gaffers.people.length} people`
);
