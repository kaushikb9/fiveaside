#!/usr/bin/env bash
# Five-a-Side smoke test. Exercises every room, both themes, every control.
# Usage: smoke.sh <base-url>
set -uo pipefail
B="$HOME/.claude/skills/gstack/browse/dist/browse"
BASE="${1:?usage: smoke.sh <base-url>}"
PASS=0; FAIL=0

check() { # check <name> <expected> <actual>
  if [ "$2" = "$3" ]; then PASS=$((PASS+1)); printf '  ok   %s\n' "$1"
  else FAIL=$((FAIL+1)); printf '  FAIL %s — expected %s, got %s\n' "$1" "$2" "$3"; fi
}
js() { $B js "$1" 2>/dev/null | tail -1; }
go() { $B goto "$BASE$1" >/dev/null 2>&1; sleep 1.5; }
errs() { $B console --errors 2>/dev/null | grep -c "\[error\]" | tr -d ' '; }

$B viewport 1280x900 >/dev/null

for ROOM in "" "gaffers/" "locker/" "about/"; do
  echo "== /$ROOM"
  go "$ROOM"
  $B console --clear >/dev/null 2>&1
  $B goto "$BASE$ROOM" >/dev/null 2>&1; sleep 1.5
  # .door is the signed-out gaffers room, which is a room and not a panel.
  check "renders content"        "true"  "$(js 'document.querySelectorAll(".panel,details.fold,.door").length > 0')"
  check "no empty-state error"   "true"  "$(js '!document.querySelector(".empty") || !/could not load/.test(document.querySelector(".empty").textContent)')"
  check "nav has three rooms"    "3"     "$(js 'document.querySelectorAll(".rooms a").length')"
  check "body painted"           "true"  "$(js 'getComputedStyle(document.body).backgroundColor !== "rgba(0, 0, 0, 0)"')"
  check "no horizontal overflow" "false" "$(js 'document.documentElement.scrollWidth > window.innerWidth')"
done

echo "== theme, on the locker room"
# Probed here rather than on the gaffers: that room is gated, and a signed-out
# visitor sees no table for the ink check to read.
go "locker/"
for T in light dark auto; do
  js "FA.setTheme('$T'); ''" >/dev/null
  BG=$(js 'getComputedStyle(document.body).backgroundColor')
  INK=$(js 'getComputedStyle(document.body).color')
  check "theme $T paints bg+ink differently" "true" "$(js "getComputedStyle(document.body).backgroundColor !== getComputedStyle(document.body).color")"
  printf '       %s: bg=%s ink=%s\n' "$T" "$BG" "$INK"
done
js "FA.setTheme('dark'); ''" >/dev/null
check "dark: table ink is the dark token" "rgb(231, 238, 247)" \
  "$(js 'const t=document.querySelector("td"); t?getComputedStyle(t).color:"none"')"
js "FA.setTheme('auto'); ''" >/dev/null

echo "== the seam: player card from every room"
for ROOM in "" "locker/"; do
  # gaffers is covered by the signed-in run; signed out it has no names.
  go "$ROOM"
  OPENED=$(js 'const l=document.querySelector("[data-player]"); if(!l) "noplink"; else { l.click(); (!document.getElementById("fa-backdrop").hidden).toString() }')
  check "/$ROOM card opens" "true" "$OPENED"
  check "/$ROOM card has a verdict section" "true" "$(js '/Our verdict/.test(document.getElementById("fa-pcard").textContent)')"
  js 'document.querySelector("#fa-pcard [data-fa-close]").click(); ""' >/dev/null
  check "/$ROOM card closes" "true" "$(js 'document.getElementById("fa-backdrop").hidden')"
done

echo "== touchline: the filter"
go ""
BEFORE=$(js 'document.querySelectorAll("ul.feed > li:not([hidden])").length')
js 'const b=document.querySelector(".filters:not(.tabs) .fc[data-filter=\"FPL\"]"); if(b) b.click(); ""' >/dev/null
AFTER=$(js 'document.querySelectorAll("ul.feed > li:not([hidden])").length')
check "FPL filter narrows the feed" "true" "$(js "${AFTER} <= ${BEFORE}")"
check "filter dims the table"       "true" "$(js 'const b=document.querySelector(".filters:not(.tabs) .fc[data-filter^=club]"); if(!b) true; else { b.click(); document.querySelectorAll("tr.dim").length > 0 }')"

echo "== touchline: the league panel"
go ""
sleep 2   # the two match-week tabs arrive from /api/matches after first paint
check "one panel, three tabs" "3" "$(js 'document.querySelectorAll("#league .tabs .fc").length')"
check "exactly one tab is on" "1" "$(js 'document.querySelectorAll("#league .tabs .fc[aria-pressed=true]").length')"
check "exactly one pane shown" "1" \
  "$(js 'document.querySelectorAll("#league .tabpane:not([hidden])").length')"
check "the table is in a tab"  "true" \
  "$(js 'document.querySelectorAll("#league [data-pane=table] tbody tr").length > 0')"
check "this match week has fixtures" "true" "$(js 'const b=document.querySelector("#league .fc[data-tab=now]"); b.click(); document.querySelectorAll("#league [data-pane=now] .fx").length > 0')"
check "a finished score is shown" "true" \
  "$(js '/\d/.test(document.querySelector("#league [data-pane=now] .fx-score").textContent)')"
check "next match week has fixtures" "true" "$(js 'const b=document.querySelector("#league .fc[data-tab=next]"); b.click(); document.querySelectorAll("#league [data-pane=next] .fx").length > 0')"
check "no scores in the next week" "true" \
  "$(js '[...document.querySelectorAll("#league [data-pane=next] .fx-score")].every(s => !/\d/.test(s.textContent))')"
check "no attribute leaked into a scorer name" "false" \
  "$(js '/plink|data-player|">/.test(document.querySelector("#league [data-pane=now]").innerText)')"

echo "== the archive"
check "home shows one entry only" "0" "$(js 'document.querySelectorAll("#main details.fold").length')"
go "archive/"
check "archive lists the rest" "true" "$(js 'document.querySelectorAll("details.fold").length > 0')"
check "archive renders an entry" "true" "$(js 'const d=document.querySelector("details.fold"); d.open=true; d.querySelectorAll(".panel").length > 0')"

echo "== gaffers: the door"
go "gaffers/"
GATED=$(js '!!document.querySelector(".door")')
check "tab is visible to everyone" "3" "$(js 'document.querySelectorAll(".rooms a").length')"
if [ "$GATED" = "true" ]; then
  check "signed out: shows the wall"       "true"  "$(js '!!document.querySelector(".door")')"
  check "signed out: the five are drawn"   "5"     "$(js 'document.querySelectorAll(".door .lu .face").length')"
  check "signed out: no squad data leaks"  "0"     "$(js 'document.querySelectorAll(".pitch .pp, #gbar .gchip").length')"
  check "signed out: offers a code box"    "true"  "$(js 'document.querySelectorAll("#codeform input, #codeform button").length === 2')"
  check "signed out: no third-party script" "true" "$(js '![...document.scripts].some(s => /accounts\.google|gstatic|gsi/.test(s.src))')"
  echo "  note  gaffers interior not exercised — signed out. Sign in and re-run to cover it."
else

echo "== gaffers: chips, gameweek, star"
check "five gaffer chips" "5" "$(js 'document.querySelectorAll("#gbar .gchip").length')"
check "every chip carries a face" "5" "$(js 'document.querySelectorAll("#gbar .gchip .face").length')"
# The nick is quoted because it has a space in it, and it is the CURRENT nick:
# this branch never ran until the door worked, so it still named Arsene, who was
# renamed to Le Professeur on 2026-08-24 and frozen.
js 'document.querySelector("#gbar .gchip[data-nick=\"Le Professeur\"]").click(); ""' >/dev/null
check "switching gaffer re-renders" "true" "$(js '/Professeur/.test(document.querySelector("#gbar .gchip[aria-pressed=true]").textContent)')"
check "pitch has 11 + 4"  "15" "$(js 'document.querySelectorAll(".pitch .pp, .benchrow .pp").length')"
check "captain armband shown" "true" "$(js 'document.querySelectorAll(".pp .arm").length > 0')"
GW=$(js 'document.querySelector(".gwlabel").textContent')
js 'const b=document.querySelector(".gwnav button[data-gw]:not([disabled])"); b.click(); ""' >/dev/null
check "gameweek nav moves" "false" "$(js "document.querySelector('.gwlabel').textContent === '$GW'")"
# A star moves the row between "yours" and "what the brain suggests" and
# re-renders the panel, so the FIRST [data-star] on the page is not the same
# player before and after. Pin to the element id and follow it across the move.
SID=$(js 'const s=document.querySelector("[data-star]"); s ? s.dataset.star : ""')
if [ -z "$SID" ]; then
  echo "  skip star toggles — nothing starrable in this room"
else
  WAS=$(js "const s=document.querySelector('[data-star=\"$SID\"]'); s.getAttribute('aria-pressed')")
  js "document.querySelector('[data-star=\"$SID\"]').click(); ''" >/dev/null
  sleep 1
  NOW=$(js "const s=document.querySelector('[data-star=\"$SID\"]'); s ? s.getAttribute('aria-pressed') : 'gone'")
  check "star toggles"            "true" "$(js "'$NOW' !== '$WAS'")"
  check "starred row survives"    "true" "$(js "'$NOW' !== 'gone'")"
  js "const s=document.querySelector('[data-star=\"$SID\"]'); if (s) s.click(); ''" >/dev/null
  sleep 0.5
fi

# The card is reachable from every room, and since 2026-08-27 it is where a
# star is pressed. Both halves are new and neither had coverage.
echo "== the card: the five drawn, and the star"
js 'const a=document.querySelector("[data-player]"); if (a) a.click(); ""' >/dev/null
sleep 0.5
check "card opens from a name"   "false" "$(js 'document.getElementById("fa-backdrop").hidden')"
check "owners drawn, not lettered" "true" "$(js 'const o=document.querySelector(".pcard .ownfaces"); !!o && (o.querySelectorAll(".ownface .face").length > 0 || /nobody in the five/.test(o.textContent))')"
check "signed in, card offers the star" "1" "$(js 'document.querySelectorAll(".pcard .cardstar").length')"
check "star button says which way it goes" "true" "$(js '/watchlist/i.test(document.querySelector(".pcard .cardstar").textContent)')"
js 'FA.closeCard(); ""' >/dev/null
sleep 0.3
fi

echo "== locker: filters, threshold, search"
go "locker/"
ALL=$(js 'document.querySelectorAll("#the-file table tbody tr").length')
js 'document.querySelector(".fc[data-f=all]").click(); ""' >/dev/null
check "'everyone' shows at least as many" "true" "$(js "document.querySelectorAll('#main table tbody tr').length >= ${ALL}")"
js 'document.querySelector(".fc[data-min=\"10\"]").click(); ""' >/dev/null
T10=$(js 'document.querySelectorAll("#the-file table tbody tr").length')
js 'document.querySelector(".fc[data-min=\"0\"]").click(); ""' >/dev/null
T0=$(js 'document.querySelectorAll("#the-file table tbody tr").length')
check "threshold changes the file" "true" "$(js "${T0} >= ${T10}")"
# "ours" was retired on 2026-08-27; this line only resets the file to a normal
# state before the search assertion, so it resets to everyone instead.
js 'document.querySelector(".fc[data-min=\"2\"]").click(); document.querySelector(".fc[data-f=all]").click(); ""' >/dev/null
js 'const i=document.getElementById("fq"); i.value="haal"; i.dispatchEvent(new Event("input")); ""' >/dev/null
sleep 0.3
check "search filters" "true" "$(js 'document.querySelectorAll("#the-file table tbody tr").length <= 3')"

echo "== the door holds"
for EP in "api/private" "api/auth"; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE$EP")
  check "$EP refuses anonymous" "401" "$CODE"
done
# A wrong invite code is refused, and refused the same way whichever wrong
# code it is — the endpoint must not become an oracle for which codes exist.
# 403 when the code is simply wrong, 429 once this script's own repeated runs
# have tripped the throttle. Both are refusals; asserting which one made the
# test fail on its fourth run in ten minutes, which is a test bug, not a leak.
refused() { case "$1" in 403|429) echo "refused" ;; *) echo "$1" ;; esac; }
BADCODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${BASE}api/auth" \
  -H 'content-type: application/json' -d '{"code":"ZZZZZZZZZZZZ"}')
check "api/auth refuses a wrong code" "refused" "$(refused "$BADCODE")"
EMPTY=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${BASE}api/auth" \
  -H 'content-type: application/json' -d '{"code":""}')
check "api/auth refuses an empty code" "refused" "$(refused "$EMPTY")"
# Pages answers a missing path with its SPA fallback AND labels it
# application/json when the path ends .json, so neither the status nor the
# content type tells you anything. Parsing the body does.
LEAK=$(curl -s "${BASE}data/gaffers.json" | node -e '
  let s = ""; process.stdin.on("data", d => s += d).on("end", () => {
    try { const j = JSON.parse(s); console.log(Array.isArray(j.people) ? "leaked" : "safe"); }
    catch { console.log("safe"); }
  });')
check "gaffers.json is not published" "safe" "$LEAK"

echo "== phone, 390px"
$B viewport 390x844 >/dev/null
for ROOM in "" "gaffers/" "locker/" "about/"; do
  go "$ROOM"
  check "/$ROOM no overflow at 390" "false" "$(js 'document.documentElement.scrollWidth > window.innerWidth')"
done
$B viewport 1280x900 >/dev/null

echo
echo "passed $PASS, failed $FAIL"
[ "$FAIL" -eq 0 ]
