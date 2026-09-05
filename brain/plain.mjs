#!/usr/bin/env node
// The copy editor. Runs AFTER a brain has written its file and BEFORE the
// validator: collects the prose fields that fail brain/lint-prose.mjs, hands
// only those to a small model with the "Plain language" section of the
// matching prompt, and writes back every rewrite that passes the lint. Facts
// are not its business — the instruction is to keep every number, name and
// claim and change only the sentences — and structured fields never reach it.
//
// Why a second model (KB, 2026-09-05): the research brain runs on the big
// model with tools, and that is the model whose prose reads like a reveal.
// Rewriting sentences needs no tools and no judgment, so a cheaper model does
// it, with the lint as the referee. The validator still runs afterwards and
// still fails the file if anything slipped through.
//
// Usage: node brain/plain.mjs site/data/fpl.json [--model sonnet] [--all] [--dry]
//   --model  which claude alias to use (default: sonnet)
//   --all    send every prose field of this run, not only the failing ones
//   --dry    print what would change; write nothing
// Exit 0 whether or not anything was rewritten; exit 1 only on a hard error.

import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import {
  lintProse,
  digestProseFields,
  fplProseFields,
  LINT_FROM,
} from "./lint-prose.mjs";

const args = process.argv.slice(2);
const path = args.find((a) => !a.startsWith("--"));
const flag = (name, dflt) => {
  const i = args.indexOf(name);
  return i === -1 ? dflt : args[i + 1];
};
const MODEL = flag("--model", "sonnet");
const ALL = args.includes("--all");
const DRY = args.includes("--dry");
const ROUNDS = 3;

if (!path) {
  console.error("usage: node brain/plain.mjs <site/data/fpl.json | site/data/digests.json> [--model sonnet] [--all] [--dry]");
  process.exit(1);
}

const data = JSON.parse(readFileSync(path, "utf8"));
const isDigest = Array.isArray(data.digests);
const promptFile = isDigest ? "brain/prompt.md" : "brain/fpl-prompt.md";

// The rule section, verbatim from the prompt the brain was given, so the two
// models are held to one text. Everything from "## Plain language" to the
// next "## " heading.
const promptText = readFileSync(promptFile, "utf8");
const start = promptText.indexOf("## Plain language");
if (start === -1) {
  console.error(`${promptFile} has no "## Plain language" section`);
  process.exit(1);
}
const rest = promptText.slice(start + 3);
const end = rest.indexOf("\n## ");
const rules = "## " + (end === -1 ? rest : rest.slice(0, end));

// Which fields are this run's to fix.
const fields = isDigest
  ? data.digests.filter((d) => d.date >= LINT_FROM).flatMap((d) => digestProseFields(d, `entry ${d.date}`))
  : fplProseFields(data);

const setters = new Map();
let todo = [];
for (const [where, text, set] of fields) {
  setters.set(where, set);
  const { errors } = lintProse(text);
  if (ALL || errors.length) todo.push({ where, text, errors });
}

if (!todo.length) {
  console.log(`plain: ${fields.length} prose fields, nothing to rewrite`);
  process.exit(0);
}

const TASK = `You are Ted, the assistant manager who writes the prose for Five-a-Side, a
football and FPL site for five friends. The five have nicknames only: Xabi,
Sir Fergie, Mr CR7, The Special One, Le Professeur. Your writing rules follow,
and a lint enforces them.

${rules}

TASK: below is a JSON object of field path -> current text from today's file,
with the lint's complaint about each. Rewrite each value so it passes every
rule above. Keep every fact, number, name, price and claim exactly as it is:
add nothing, drop nothing, and do not change who the text is addressed to.
Fields under "people[..] (Nick)" that are ".week.", ".big" or ".watchlist" are
Ted talking to that gaffer as "you". "big[].call" fields are headings under 80
characters. "roast.text" keeps its two-sentence joke and its target.
"log[].call" fields stay a diary of the calls made, in plain sentences.

Return ONLY a JSON object with the same keys and the rewritten strings as
values. No commentary, no code fence.`;

function askModel(items) {
  const payload = {};
  for (const it of items) payload[it.where] = it.errors.length ? { text: it.text, lint: it.errors } : { text: it.text };
  const prompt = `${TASK}\n\n${JSON.stringify(payload, null, 1)}`;
  const r = spawnSync("claude", ["-p", prompt, "--model", MODEL, "--tools", "", "--output-format", "text"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
    timeout: 15 * 60 * 1000,
  });
  if (r.status !== 0) {
    console.error(`plain: claude exited ${r.status}: ${(r.stderr || "").trim().slice(0, 300)}`);
    return null;
  }
  let raw = (r.stdout || "").trim().replace(/^```(json)?\s*/, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.error(`plain: could not parse the model's reply: ${e.message}`);
    return null;
  }
}

let fixed = 0;
const changes = [];
for (let round = 1; round <= ROUNDS && todo.length; round++) {
  console.log(`plain: round ${round}, ${todo.length} field${todo.length > 1 ? "s" : ""} to ${MODEL}`);
  const reply = askModel(todo);
  if (!reply) break;
  const remaining = [];
  for (const it of todo) {
    const after = reply[it.where];
    if (typeof after !== "string" || !after.trim()) {
      remaining.push(it);
      continue;
    }
    const { errors } = lintProse(after);
    if (errors.length) {
      remaining.push({ where: it.where, text: after, errors });
      continue;
    }
    if (after !== it.text) {
      setters.get(it.where)(after);
      changes.push([it.where, it.text, after]);
      fixed++;
    }
  }
  todo = remaining;
}

for (const [where, before, after] of changes) {
  console.log(`\n${where}\n  - ${before}\n  + ${after}`);
}
if (todo.length) {
  console.log(`\nplain: ${todo.length} field${todo.length > 1 ? "s" : ""} still failing after ${ROUNDS} rounds — the validator will report them:`);
  for (const it of todo) console.log(`  ${it.where}: ${it.errors.join(" | ")}`);
}
console.log(`\nplain: rewrote ${fixed} of ${fields.length} prose fields${DRY ? " (dry run, nothing written)" : ""}`);

if (!DRY && fixed) writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
