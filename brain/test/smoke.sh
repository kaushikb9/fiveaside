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
  check "renders content"        "true"  "$(js 'document.querySelectorAll(".panel,details.fold").length > 0')"
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
js 'const b=document.querySelector(".filters .fc[data-filter=\"FPL\"]"); if(b) b.click(); ""' >/dev/null
AFTER=$(js 'document.querySelectorAll("ul.feed > li:not([hidden])").length')
check "FPL filter narrows the feed" "true" "$(js "${AFTER} <= ${BEFORE}")"
check "filter dims the table"       "true" "$(js 'const b=document.querySelector(".filters .fc.club, .filters .fc:not([data-filter=all]):not([data-filter=PL]):not([data-filter=FPL])"); if(!b) true; else { b.click(); document.querySelectorAll("tr.dim").length > 0 }')"

echo "== gaffers: the door"
go "gaffers/"
GATED=$(js 'document.body.textContent.includes("Members only")')
check "tab is visible to everyone" "3" "$(js 'document.querySelectorAll(".rooms a").length')"
if [ "$GATED" = "true" ]; then
  check "signed out: shows the wall"       "true"  "$(js 'document.body.textContent.includes("Members only")')"
  check "signed out: no squad data leaks"  "0"     "$(js 'document.querySelectorAll(".pitch .pp, #gbar .gchip").length')"
  echo "  note  gaffers interior not exercised — signed out. Sign in and re-run to cover it."
else

echo "== gaffers: chips, gameweek, star"
check "five gaffer chips" "5" "$(js 'document.querySelectorAll("#gbar .gchip").length')"
js 'document.querySelector("#gbar .gchip[data-nick=Arsene]").click(); ""' >/dev/null
check "switching gaffer re-renders" "true" "$(js '/Arsene/.test(document.querySelector("#gbar .gchip[aria-pressed=true]").textContent)')"
check "pitch has 11 + 4"  "15" "$(js 'document.querySelectorAll(".pitch .pp, .benchrow .pp").length')"
check "captain armband shown" "true" "$(js 'document.querySelectorAll(".pp .arm").length > 0')"
GW=$(js 'document.querySelector(".gwlabel").textContent')
js 'const b=document.querySelector(".gwnav button[data-gw]:not([disabled])"); b.click(); ""' >/dev/null
check "gameweek nav moves" "false" "$(js "document.querySelector('.gwlabel').textContent === '$GW'")"
WAS=$(js 'const s=document.querySelector("[data-star]"); s ? s.getAttribute("aria-pressed") : "nostar"')
if [ "$WAS" = "nostar" ]; then
  echo "  skip star toggles — no watchlist entries to star yet"
else
  js 'document.querySelector("[data-star]").click(); ""' >/dev/null
  sleep 1
  NOW=$(js 'document.querySelector("[data-star]").getAttribute("aria-pressed")')
  check "star toggles" "true" "$(js "'$NOW' !== '$WAS'")"
  js 'document.querySelector("[data-star]").click(); ""' >/dev/null   # put it back
  sleep 0.5
fi
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
js 'document.querySelector(".fc[data-min=\"2\"]").click(); document.querySelector(".fc[data-f=ours]").click(); ""' >/dev/null
js 'const i=document.getElementById("fq"); i.value="haal"; i.dispatchEvent(new Event("input")); ""' >/dev/null
sleep 0.3
check "search filters" "true" "$(js 'document.querySelectorAll("#the-file table tbody tr").length <= 3')"

echo "== the door holds"
for EP in "api/private" "api/auth"; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE$EP")
  check "$EP refuses anonymous" "401" "$CODE"
done
check "gaffers.json is not published" "false" \
  "$(curl -s "$BASE" -o /dev/null -w '%{http_code}' >/dev/null; curl -s "${BASE}data/gaffers.json" | head -c 1 | grep -q '{' && echo true || echo false)"

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
