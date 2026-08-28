/* split-facts.mjs — never publish an empty room over a full one.
   =========================================================================
   FPL takes its entry endpoints down around every deadline. On 2026-08-28 the
   bundle honestly reported no squads, this script wrote that straight through,
   five squads became zero, and the gaffers room threw on the first panel that
   read a squad — leaving the static "Loading…" on screen. It looked like a
   slow network and was a dead page.

   The squads had not changed; FPL was simply refusing to say what they were.
   These tests pin the fallback, because the failure happens every Friday and
   the symptom points at the wrong layer.

   Usage: node brain/test/split-facts.mjs
   ========================================================================= */

import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../split-facts.mjs", import.meta.url));

let fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log((ok ? "  ok   " : "  FAIL ") + name +
    (ok ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`));
};

const SQUAD = (nick) => ({
  nick, club: "CHE", team_name: nick + " FC", entered: true,
  total_points: 50, gw_points: 12, overall_rank: 1000, bank: 0.5, value: 100.4,
  transfers_made: 1, chips_used: [], active_chip: null, bench_points: 3,
  transfers_cost: 0, picks: [{ name: "Palmer", pos: "MID", role: "xi" }],
});

/* Runs the real script in a throwaway tree, so the hardcoded relative paths
   it writes to cannot touch the repo. */
function run(bundle, previousGaffers, previousPlayers) {
  const dir = mkdtempSync(join(tmpdir(), "split-"));
  mkdirSync(join(dir, "site", "data"), { recursive: true });
  if (previousGaffers) {
    writeFileSync(join(dir, "site/data/gaffers.json"), JSON.stringify(previousGaffers));
  }
  if (previousPlayers) {
    writeFileSync(join(dir, "site/data/players.json"), JSON.stringify(previousPlayers));
  }
  const out = execFileSync("node", [SCRIPT], {
    cwd: dir, input: JSON.stringify(bundle), encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
  return {
    gaffers: JSON.parse(readFileSync(join(dir, "site/data/gaffers.json"), "utf8")),
    players: JSON.parse(readFileSync(join(dir, "site/data/players.json"), "utf8")),
    remainder: JSON.parse(out || "{}"),
  };
}

const FULL = { gameweek: { id: 3 }, squads: [SQUAD("Xabi"), SQUAD("Sir Fergie")], player_file: [] };
const LOCKED = { gameweek: { id: 3 }, squads: [], player_file: [] };
const FULL_OWNED = { gameweek: { id: 3 }, squads: [SQUAD("Xabi")], player_file: [
  { id: 1, name: "Palmer", owned_by: ["Le Professeur"] },
] };

console.log("split-facts.mjs — the deadline lock");

// A normal run publishes what it was given, and says nothing about staleness.
let r = run(FULL, null);
check("a normal run publishes the squads", r.gaffers.people.length, 2);
check("and is not marked stale", r.gaffers.people_stale, undefined);

// The failure this exists for.
const previous = {
  generated_at: "2026-08-28T16:29:38.278Z",
  people: [SQUAD("Xabi"), SQUAD("Sir Fergie")],
  league: { name: "The Five", rows: [{ nick: "Xabi", total: 50 }] },
};
r = run(LOCKED, previous);
check("a locked API does NOT wipe the squads", r.gaffers.people.length, 2);
check("they are marked stale", r.gaffers.people_stale, true);
check("dated to when they were real, not to now",
  r.gaffers.people_as_of, "2026-08-28T16:29:38.278Z");
// The mini-league comes from the same locked endpoints and goes the same way.
check("the league is carried too", r.gaffers.league.rows.length, 1);
// The gameweek and deadline are NOT carried: those come from bootstrap, which
// stays up, and they are the fields that legitimately move during a lock.
check("but the gameweek is today's", r.gaffers.gameweek, 3);

// Carrying forward twice must not creep the date to today, or "squads are from
// Friday" quietly becomes "squads are from just now" while nothing refreshed.
const second = run(LOCKED, r.gaffers).gaffers;
check("a second lock keeps the original date",
  second.people_as_of, "2026-08-28T16:29:38.278Z");

// Once FPL answers again, the fallback gets out of the way.
const recovered = run(FULL, r.gaffers).gaffers;
check("a recovered API drops the stale mark", recovered.people_stale, undefined);
check("and republishes live squads", recovered.people.length, 2);

// owned_by is built from the same squads, so the lock empties it for every
// player: cards read "nobody in the five", owner dots vanish, and a player who
// is only in the file BECAUSE one of the five owns him drops out of it.
const OWNED = { gameweek: { id: 3 }, squads: [], player_file: [
  { id: 1, name: "Palmer", owned_by: [] },
  { id: 2, name: "Haaland", owned_by: [] },
] };
const previousPlayers = { players: [
  { id: 1, name: "Palmer", owned_by: ["Xabi", "Mr CR7"] },
  { id: 2, name: "Haaland", owned_by: [] },
] };
r = run(OWNED, previous, previousPlayers);
check("a locked API does not strip the owners", r.players.players[0].owned_by, ["Xabi", "Mr CR7"]);
check("and leaves genuinely unowned players alone", r.players.players[1].owned_by, []);

const stillOwned = run(FULL_OWNED, previous, previousPlayers).players.players[0].owned_by;
check("live owners win over carried ones", stillOwned, ["Le Professeur"]);

// A genuinely first run has nothing to fall back to and must not invent any.
const firstEver = run(LOCKED, null).gaffers;
check("a first run with no history publishes nothing rather than inventing",
  firstEver.people.length, 0);

console.log(fail ? `\n${fail} FAILED` : "\nall passed");
process.exit(fail ? 1 : 0);
