#!/usr/bin/env bash
# Build the mockup: ASCII-fold the template, inline the real data, and REFUSE
# to emit anything whose script does not parse. A broken string literal renders
# a blank page with an empty console, which cost a debugging round once.
set -euo pipefail
cd "$(dirname "$0")"
OUT="${1:?usage: build.sh <output.html>}"

python3 - <<'PY'
import io
src = io.open("tpl.html", encoding="utf-8").read()
i = src.index("<script>")
ents = lambda t: "".join(c if ord(c) < 128 else "&#%d;" % ord(c) for c in t)
uesc = lambda t: "".join(c if ord(c) < 128 else "\\u%04x" % ord(c) for c in t)
out = ents(src[:i]) + uesc(src[i:])
assert all(ord(c) < 128 for c in out), "non-ascii survived"
io.open("tpl.ascii.html", "w", encoding="ascii").write(out)
PY

python3 - <<'PY'
import json, io
d = json.load(io.open("data.json", encoding="utf-8"))
io.open("data.ascii.json", "w", encoding="ascii").write(
    json.dumps(d, ensure_ascii=True, separators=(",", ":")))
PY

node -e '
const fs = require("fs");
const [tpl, data, out] = process.argv.slice(1);
const html = fs.readFileSync(tpl, "utf8").replace("__DATA__", () => fs.readFileSync(data, "utf8"));
if (/[^\x00-\x7F]/.test(html)) throw new Error("non-ascii survived");
const js = html.slice(html.indexOf("<script>") + 8, html.lastIndexOf("</script>"));
new Function(js);                       // throws on a syntax error, before anything is written
fs.writeFileSync(out, html);
console.log(`built ${out} — ${Math.round(html.length / 1024)}KB, script parses`);
' tpl.ascii.html data.ascii.json "$OUT"
