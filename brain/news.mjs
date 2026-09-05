#!/usr/bin/env node
// Pre-fetch the news so the brain does not have to. Mechanical, no LLM.
//
// Why this exists: profiled on 2026-09-05, the two editorial brains spent
// most of their run crawling BBC, Guardian and Google News by hand — 31 Bash
// calls and ~136 KB of raw HTML per FPL run, re-read on every one of 37
// turns. Fetching is deterministic work; only the reading is judgment. This
// script does the fetching once, up front, and emits a compact NEWS BUNDLE
// (headline, standfirst, opening paragraphs, published time, source) that
// curate.sh and curate-fpl.sh inject next to the FACTS bundle. The brain may
// still WebFetch to verify or follow a lead; it should not re-crawl the feeds.
//
// Sources: the editorial feeds in fiveaside.config.json `feeds`, plus every
// Google News RSS URL listed in brain/sources.md (the transfer-reporter
// wires). sources.md stays the single place a source is added or retired.
//
// Usage: node brain/news.mjs [--hours 48] [--out brain/scratch/news.json]
// Prints the bundle JSON to stdout; never exits non-zero on a feed failure —
// a dead feed is reported in `errors` so the brain can say so, per prompt.md.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith("--") ? [a.slice(2), all[i + 1]] : []).filter(Boolean));
const HOURS = Number(args.hours || 48);
const OUT = args.out || "brain/scratch/news.json";
const UA = "curl/8.7.1"; // ESPN and several news CDNs 403 browser UAs and accept curl — see AGENTS.md
const PER_FEED = 30;      // newest items kept per editorial feed
const PER_WIRE = 15;      // newest items kept per reporter wire (aggregator noise past that)
const BODIES_PER_FEED = 12; // items per editorial feed whose article page is read for opening paragraphs
const PARAS = 3;          // opening paragraphs kept per article
const BODY_CHARS = 700;   // cap per article body
const TIMEOUT_MS = 15000;
const CONCURRENCY = 4;

const config = JSON.parse(readFileSync("fiveaside.config.json", "utf8"));
const sourcesMd = readFileSync("brain/sources.md", "utf8");

const editorial = (config.feeds || []).map((f) => ({ label: f.label, url: f.url, kind: "editorial" }));
const wires = [...new Set(sourcesMd.match(/https:\/\/news\.google\.com\/rss\/search\?[^\s)]+/g) || [])].map((url) => {
  const q = decodeURIComponent(new URL(url).searchParams.get("q") || "");
  const name = (q.match(/"([^"]+)"/) || [])[1] || q;
  return { label: `Google News wire — ${name}`, url, kind: "wire" };
});
const feeds = [...editorial, ...wires];

const since = Date.now() - HOURS * 3600 * 1000;
const errors = [];

async function get(url) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { headers: { "user-agent": UA, accept: "text/html,application/rss+xml,application/xml,*/*" }, signal: ctl.signal, redirect: "follow" });
    const body = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return body;
  } finally { clearTimeout(t); }
}

const decode = (s) => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
// Feeds escape HTML inside <description>; decode first so those tags are
// stripped too, then decode again for entities that were double-escaped.
const strip = (html) => decode(decode(html).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
const tag = (xml, name) => (xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`)) || [])[1] || "";

function parseFeed(xml) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, it]) => {
    const link = strip(tag(it, "link")) || (it.match(/<link[^>]*href="([^"]+)"/) || [])[1] || "";
    return {
      title: strip(tag(it, "title")),
      url: link.replace(/[?&]at_medium=RSS[^ ]*$/, "").replace(/&amp;/g, "&"),
      published: new Date(strip(tag(it, "pubDate")) || strip(tag(it, "dc:date")) || 0).toISOString(),
      standfirst: strip(tag(it, "description")).slice(0, 400),
      source: strip(tag(it, "source")) || null,
    };
  }).filter((i) => i.title && i.url && Date.parse(i.published) >= since);
}

// Opening paragraphs: scope to the article body where the site marks one,
// else fall back to the whole page with nav chrome filtered out.
function openingParas(html) {
  const scoped = (html.match(/<article[\s\S]*?<\/article>/i) || [])[0]
    || (html.match(/data-gu-name="body"[\s\S]*?(?=<footer|<aside|$)/i) || [])[0]
    || html;
  return [...scoped.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)]
    .map((m) => strip(m[1]))
    .filter((t) => t.length > 60 && !/skip to content|cookies|sign in|newsletter|©|photograph:|view image in fullscreen|getty images|enable javascript|can ?not be played|prefer the guardian|published \d+ (hours?|minutes?) ago/i.test(t))
    .slice(0, PARAS)
    .join("\n\n")
    .slice(0, BODY_CHARS);
}

async function mapLimit(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}

const result = { fetched_at: new Date().toISOString(), window_hours: HOURS, feeds: [], errors };
for (const f of feeds) {
  let items = [];
  try { items = parseFeed(await get(f.url)).sort((a, b) => Date.parse(b.published) - Date.parse(a.published)).slice(0, f.kind === "wire" ? PER_WIRE : PER_FEED); }
  catch (e) { errors.push({ feed: f.label, url: f.url, error: e.message }); }
  if (f.kind === "editorial") {
    await mapLimit(items.slice(0, BODIES_PER_FEED), CONCURRENCY, async (it) => {
      try { it.opening = openingParas(await get(it.url)); }
      catch (e) { it.opening_error = e.message; }
    });
  } else {
    // Google News links are redirect stubs; the item title carries "headline - outlet".
    for (const it of items) { const m = it.title.match(/^(.*) - ([^-]+)$/); if (m) { it.title = m[1]; it.source = it.source || m[2].trim(); } delete it.standfirst; delete it.url; /* redirect stubs, not citable */ }
  }
  result.feeds.push({ label: f.label, kind: f.kind, url: f.url, count: items.length, items });
}

const json = JSON.stringify(result, null, 1);
try { mkdirSync("brain/scratch", { recursive: true }); writeFileSync(OUT, json); } catch {}
process.stdout.write(json);
