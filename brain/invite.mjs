#!/usr/bin/env node
// Mint, list and revoke the gaffers' invite codes.
//
// A code is a KV key: `invite:<CODE>` -> { nick, issued, last_used }. There is
// no password, no email round trip and no third party — KB makes a code, sends
// it however he likes, and it works on any device until he revokes it.
//
//   node brain/invite.mjs "Sir Fergie"        mint a code (revokes their old one)
//   node brain/invite.mjs --list              who has a code, and whether it was used
//   node brain/invite.mjs --revoke <code>     kill one code
//   node brain/invite.mjs --revoke-all        kill every code
//
// Add --local to work against `wrangler pages dev` instead of production.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const KV = "371bb71f0a1245f697375846236bd58b";
const SITE = "https://fiveaside.pages.dev";
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford: no I, L, O, U
const CODE_LEN = 12;

const args = process.argv.slice(2);
const LOCAL = args.includes("--local");
const rest = args.filter((a) => a !== "--local");

const NICKS = JSON.parse(readFileSync("touchline.config.json", "utf8")).fpl.people.map((p) => p.nick);

const wrangler = (...a) =>
  execFileSync("npx", ["wrangler", "kv", ...a, "--namespace-id", KV, LOCAL ? "--local" : "--remote"],
    { encoding: "utf8", env: { ...process.env, CI: "1" }, stdio: ["ignore", "pipe", "pipe"] });

const format = (c) => (c.match(/.{1,4}/g) || []).join("-");
const normalize = (raw) =>
  String(raw || "").toUpperCase().replace(/[^0-9A-Z]/g, "")
    .replace(/O/g, "0").replace(/[IL]/g, "1");

function newCode() {
  const bytes = new Uint8Array(CODE_LEN);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join("");
}

function listInvites() {
  const keys = JSON.parse(wrangler("key", "list", "--prefix", "invite:"));
  return keys.map((k) => {
    const code = k.name.slice("invite:".length);
    let value = {};
    try { value = JSON.parse(wrangler("key", "get", k.name)); } catch { /* unreadable */ }
    return { code, ...value };
  });
}

function put(code, value) {
  execFileSync("npx",
    ["wrangler", "kv", "key", "put", "invite:" + code, JSON.stringify(value),
     "--namespace-id", KV, LOCAL ? "--local" : "--remote"],
    { encoding: "utf8", env: { ...process.env, CI: "1" }, stdio: ["ignore", "pipe", "pipe"] });
}

// No --force flag on `kv key delete`; CI=1 in the env is what stops it prompting.
const del = (code) => wrangler("key", "delete", "invite:" + code);

/* ---------------- commands ---------------- */

if (rest.includes("--list")) {
  const invites = listInvites();
  if (!invites.length) {
    console.log("No codes minted yet.");
  } else {
    for (const i of invites) {
      console.log(
        `${format(i.code)}  ${(i.nick || "?").padEnd(16)}  ` +
        `issued ${(i.issued || "?").slice(0, 10)}  ` +
        (i.last_used ? `last used ${i.last_used.slice(0, 10)}` : "never used")
      );
    }
  }
  const without = NICKS.filter((n) => !invites.some((i) => i.nick === n));
  if (without.length) console.log("\nNo code yet: " + without.join(", "));
  process.exit(0);
}

if (rest.includes("--revoke-all")) {
  const invites = listInvites();
  for (const i of invites) del(i.code);
  console.log(`Revoked ${invites.length} code(s). Everyone is signed out on their next request.`);
  process.exit(0);
}

const revokeAt = rest.indexOf("--revoke");
if (revokeAt !== -1) {
  const code = normalize(rest[revokeAt + 1]);
  if (!code) { console.error("usage: node brain/invite.mjs --revoke <code>"); process.exit(1); }
  del(code);
  console.log(`Revoked ${format(code)}. That person is signed out on their next request.`);
  process.exit(0);
}

const nick = rest[0];
if (!nick) {
  console.error("usage: node brain/invite.mjs \"<nick>\" | --list | --revoke <code> | --revoke-all");
  console.error("the five: " + NICKS.join(", "));
  process.exit(1);
}
// The nick is checked against the config rather than accepted as typed: a code
// minted for "Sir Ferige" would work perfectly and belong to nobody.
if (!NICKS.includes(nick)) {
  console.error(`"${nick}" is not one of the five: ${NICKS.join(", ")}`);
  process.exit(1);
}

// One code per gaffer. Minting a second would leave the first working, which
// is how a revoked code quietly stays live.
for (const old of listInvites().filter((i) => i.nick === nick)) {
  del(old.code);
  console.log(`(replaced their old code ${format(old.code)})`);
}

const code = newCode();
put(code, { nick, issued: new Date().toISOString() });

console.log(`
  ${nick}

  code   ${format(code)}
  link   ${SITE}/gaffers/?i=${code}

  Either one signs them in on any device, and keeps them in for 30 days.
  Revoke with:  node brain/invite.mjs --revoke ${format(code)}
`);
