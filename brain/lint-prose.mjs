#!/usr/bin/env node
// Prose lint for the two files the brain writes. Deterministic, no model.
//
// Why this exists (2026-09-05): both prompts have carried a "Plain language"
// section since 2026-08-29 and the output still read like a model doing a
// reveal — "X is a floor, not an asset", a dash every 100 words, a twist
// sentence at the end of every note. Telling a model its writing is fine is
// not a fix; a check it cannot pass until it rewrites is. The validators call
// this on the prose the brain is expected to write THIS run, so a tic fails
// the file and the brain fixes it in the same session, the same way a
// schema error already does.
//
// Usage as a CLI (report only, exit 0):
//   node brain/lint-prose.mjs site/data/fpl.json
//   node brain/lint-prose.mjs site/data/digests.json [--all]
// As a module: lintProse(text) -> { errors: [...], notes: [...] }.

import { readFileSync } from "node:fs";

export const MAX_SENTENCE_WORDS = 35;
// Digest entries dated before this are history and are not linted.
export const LINT_FROM = "2026-09-05";

// Hard failures — each is a pattern the owner has named as the problem, or
// one the HN thread on Opus-5 prose named that turned up in this data.
const BANNED = [
  // the reveal / the twist
  /\bthe (real|only|bigger|better|harder|interesting) question\b/i,
  /\bhere.s the thing\b/i,
  /\bthe (quiet|hard) part\b/i,
  /\bquietly\b/i,
  /\bsmoking gun\b/i,
  /\bload-bearing\b/i,
  /\bbelt and (braces|suspenders)\b/i,
  /\bpressure[- ]test/i,
  /\bby construction\b/i,
  /\bdoing (most of )?the work\b/i,
  /\bheavy lifting\b/i,
  /\bsomewhere in (that|this|the)\b/i,
  /\bthe tell\b/i,
  /\bis (a|the) (mood|floor|ceiling|tell|countdown|hypothesis|luxury|tax|coin flip|accident)\b/i,
  /\bnot the place to be\b/i,
  // scaffolding
  /\bthe key takeaway\b/i,
  /\bwhat matters (is|here)\b/i,
  /\bthis is a reminder\b/i,
  /\bat this stage\b/i,
  /\bmoving forward\b/i,
  /\bin other words\b/i,
  /\bput (simply|differently)\b/i,
  /\bmake no mistake\b/i,
  /\bto be (clear|fair)\b/i,
  /\bthe bottom line\b/i,
  /\bit is worth (noting|remembering|saying)\b/i,
  /\bworth (noting|remembering)\b/i,
  // inflated words the prompt already bans
  /\bnarrative\b/i,
  /\bunderpin/i,
  /\bexacerbat/i,
  /\bthe case for\b/i,
  /\b(the|an) exact (opposite|trigger|difference|shape)\b/i,
  /\bwhich is exactly\b/i,
  /\bgenuinely\b/i,
  /\bhonestly\b/i,
  // reporter branding
  /\bhere we go\b/i,
];

// Soft signals — printed by the CLI, never a failure. Ordinary English words
// that this brain leans on; a run with many of them reads as the machine.
const NOTES = [
  [/\brather than\b/gi, "rather than"],
  [/\bstill\b/gi, "still"],
  [/\b(the|is the) only\b/gi, "the only"],
  [/\bexactly\b/gi, "exactly"],
  [/\bactually\b/gi, "actually"],
  [/\bthe whole (reason|point|team|room|idea)\b/gi, "the whole X"],
  [/\b(not|never) [^.,;]{2,40}, (but|and) \b/gi, "not X, but Y"],
];

const NUMBER_WORDS =
  /\b(thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred)(-\w+)?\b/gi;

// "X is a Y, not a Z" — the shape the HN thread called "it's not X, it's Y".
// Anchored on a copula so an ordinary "not" in a clause does not trip it.
const CONTRAST =
  /\b(is|are|was|were|be|becomes|remains|stays)( a| an| the| one| your| his)? [^.,;:]{1,45}, (not|never) (a |an |the |one |your |his )?[^.,;:]{1,45}[.,;]/i;

// The same shape as a sentence tail: "…when, not if." "…last, not first."
// Every hit in the corpus on 2026-09-05 was the tic, none was a plain "not".
const CONTRAST_TAIL = /[a-z]+, (not|never) (a |an |the |one )?[a-z-]+( [a-z-]+)?[.!?](\s|$)/i;

function stripQuotes(text) {
  // A manager's quote may carry a dash or a semicolon; that is his, not Ted's.
  return text.replace(/"[^"]*"/g, '""').replace(/“[^”]*”/g, "“”");
}

function sentences(text) {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z£0-9"“(])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Lint one prose string. Returns { errors, notes }, each an array of strings. */
export function lintProse(raw) {
  const errors = [];
  const notes = [];
  if (typeof raw !== "string" || !raw.trim()) return { errors, notes };
  const text = stripQuotes(raw);

  const dashes = (text.match(/—/g) || []).length + (text.match(/\s–\s/g) || []).length;
  if (dashes) errors.push(`${dashes} dash${dashes > 1 ? "es" : ""} — write two sentences, or a comma`);
  const semis = (text.match(/;/g) || []).length;
  if (semis) errors.push(`${semis} semicolon${semis > 1 ? "s" : ""} — a full stop is better`);

  const m = text.match(CONTRAST) || text.match(CONTRAST_TAIL);
  if (m) errors.push(`"X, not Y" contrast: "${m[0].trim()}" — say what it is and stop`);

  for (const re of BANNED) {
    const hit = text.match(re);
    if (hit) errors.push(`banned phrase "${hit[0]}"`);
  }

  const nums = text.match(NUMBER_WORDS);
  if (nums) errors.push(`spelled-out number "${nums[0]}" — use digits (${nums.length} in this field)`);

  for (const s of sentences(text)) {
    const words = s.split(/\s+/).length;
    if (words > MAX_SENTENCE_WORDS)
      errors.push(`${words}-word sentence (limit ${MAX_SENTENCE_WORDS}): "${s.slice(0, 70)}…"`);
  }

  for (const [re, label] of NOTES) {
    const hits = text.match(re);
    if (hits) notes.push(`${label} ×${hits.length}`);
  }
  return { errors, notes };
}

/**
 * Lint a set of [where, text] pairs. Returns { errors: [{where, msg}], notes: [{where, msg}] }.
 * Validators call this and fail on any error; the CLI prints both.
 */
export function lintFields(pairs) {
  const errors = [];
  const notes = [];
  for (const [where, text] of pairs) {
    const r = lintProse(text);
    for (const msg of r.errors) errors.push({ where, msg });
    for (const msg of r.notes) notes.push({ where, msg });
  }
  return { errors, notes };
}

// ------------------------------------------------------------ field maps
// Which strings in each file are Ted's own words. Titles of linked articles
// are somebody else's headline and are skipped; structured fields are not prose.

// Each item is [where, text, set] — `set` writes a replacement back into the
// object, which is what the editor pass (brain/plain.mjs) uses.
export function digestProseFields(entry, where = "entry") {
  const out = [];
  const add = (w, o, k) => typeof o?.[k] === "string" && out.push([w, o[k], (v) => { o[k] = v; }]);
  add(`${where}.headline`, entry, "headline");
  for (const [i, w] of (entry.week ?? []).entries()) {
    add(`${where}.week[${i}].kicker`, w, "kicker");
    add(`${where}.week[${i}].text`, w, "text");
  }
  for (const [i, w] of (entry.wider ?? []).entries()) add(`${where}.wider[${i}].hook`, w, "hook");
  if (entry.read) add(`${where}.read.hook`, entry.read, "hook");
  for (const [i, t] of (entry.top_teams ?? []).entries()) add(`${where}.top_teams[${i}].note`, t, "note");
  for (const [i, e] of (entry.elsewhere ?? []).entries()) add(`${where}.elsewhere[${i}].note`, e, "note");
  for (const [i, r] of (entry.rumours ?? []).entries()) add(`${where}.rumours[${i}].note`, r, "note");
  return out;
}

export function fplProseFields(data) {
  const out = [];
  const add = (w, o, k) => typeof o?.[k] === "string" && out.push([w, o[k], (v) => { o[k] = v; }]);
  for (const [i, p] of (data.people ?? []).entries()) {
    const w = `people[${i}] (${p?.nick ?? "?"})`;
    add(`${w}.week.worked`, p?.week, "worked");
    add(`${w}.week.didnt`, p?.week, "didnt");
    for (const [j, b] of (p?.big ?? []).entries()) {
      add(`${w}.big[${j}].call`, b, "call");
      add(`${w}.big[${j}].why`, b, "why");
    }
    for (const [j, s] of (p?.watchlist ?? []).entries()) add(`${w}.watchlist[${j}].note`, s, "note");
  }
  for (const [i, s] of (data.watchlist ?? []).entries()) add(`watchlist[${i}].note`, s, "note");
  for (const [i, v] of (data.verdicts ?? []).entries()) {
    add(`verdicts[${i}] (${v?.name ?? "?"}).why`, v, "why");
    add(`verdicts[${i}] (${v?.name ?? "?"}).trigger`, v, "trigger");
  }
  for (const [i, s] of (data.signals ?? []).entries()) {
    add(`signals[${i}].text`, s, "text");
    add(`signals[${i}].action`, s, "action");
  }
  for (const [i, d] of (data.doctrine ?? []).entries()) add(`doctrine[${i}] (${d?.id ?? "?"}).text`, d, "text");
  if (data.roast) add("roast.text", data.roast, "text");
  if (data.plan) add("plan.outlook", data.plan, "outlook");
  if (data.chips) add("chips.note", data.chips, "note");
  // log is append-and-settle: a settled entry is frozen, so only open ones are Ted's to fix.
  for (const [i, e] of (data.log ?? []).entries()) {
    if (e?.verdict === "open") add(`log[${i}] (${e.date}).call`, e, "call");
  }
  return out;
}

// ------------------------------------------------------------ CLI
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*\//, ""));
if (isMain) {
  const path = process.argv[2];
  const all = process.argv.includes("--all");
  if (!path) {
    console.error("usage: node brain/lint-prose.mjs <site/data/fpl.json | site/data/digests.json> [--all]");
    process.exit(2);
  }
  const data = JSON.parse(readFileSync(path, "utf8"));
  let pairs;
  if (Array.isArray(data.digests)) {
    const entries = all ? data.digests : data.digests.slice(-1);
    pairs = entries.flatMap((e) => digestProseFields(e, e.date));
  } else {
    pairs = fplProseFields(data);
  }
  const { errors, notes } = lintFields(pairs);
  for (const e of errors) console.log(`FAIL  ${e.where}: ${e.msg}`);
  const tally = {};
  for (const n of notes) {
    const k = n.msg.replace(/ ×\d+$/, "");
    tally[k] = (tally[k] || 0) + Number(n.msg.match(/×(\d+)$/)?.[1] ?? 1);
  }
  console.log(`\n${pairs.length} prose fields, ${errors.length} failures`);
  console.log("notes:", Object.entries(tally).map(([k, v]) => `${k} ${v}`).join(" · ") || "none");
}
