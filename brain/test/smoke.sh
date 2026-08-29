#!/usr/bin/env bash
# Five-a-Side smoke test. Exercises every room, both themes, every control.
# Usage: smoke.sh <base-url>
set -uo pipefail
B="$HOME/.claude/skills/gstack/browse/dist/browse"
BASE="${1:?usage: smoke.sh <base-url>}"
# Every room is joined on as "gaffers/", so a base without a trailing slash
# silently builds "https://host.devgaffers/" and reports 43 failures that look
# like the site is broken. Normalise rather than trust the caller.
BASE="${BASE%/}/"
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
  # Matches the section heading, not the exact prose — this check pinned the
  # words "Our verdict" and broke when the voice audit renamed it, which is a
  # test asserting a sentence rather than a feature.
  check "/$ROOM card has a verdict section" "true" \
    "$(js '[...document.querySelectorAll("#fa-pcard .sect")].some(function(s){return /verdict/i.test(s.textContent)})')"
  js 'document.querySelector("#fa-pcard [data-fa-close]").click(); ""' >/dev/null
  check "/$ROOM card closes" "true" "$(js 'document.getElementById("fa-backdrop").hidden')"
done

echo "== touchline: the filter"
go ""
BEFORE=$(js 'document.querySelectorAll("ul.feed > li:not([hidden])").length')
js 'const b=document.querySelector(".filters:not(.tabs) .fc[data-filter=\"FPL\"]"); if(b) b.click(); ""' >/dev/null
AFTER=$(js 'document.querySelectorAll("ul.feed > li:not([hidden])").length')
check "FPL filter narrows the feed" "true" "$(js "${AFTER} <= ${BEFORE}")"
# The week filter is All / Football / FPL and nothing else. A club chip per club
# mentioned made the bar as long as the feed and different every day.
check "no club chips in the week filter" "0" "$(js 'document.querySelectorAll(".filters:not(.tabs) .fc[data-filter^=club]").length')"
check "three chips, and they are the tags" "All Football FPL" "$(js 'Array.from(document.querySelectorAll(".filters:not(.tabs) .fc[data-filter]")).map(function(b){return b.textContent.trim()}).join(" ")')"
# Neutral: the table tells you who is top before it tells you who it is for.
check "no club is bolded in the table" "0" "$(js 'document.querySelectorAll("#league tr.focus").length')"
check "no allegiance paragraph"        "true" "$(js '!/clubs this page follows/i.test(document.getElementById("league").textContent)')"
# Long names cost two lines each on a phone.
check "the table says Man City, not Manchester City" "true" "$(js '(function(){var t=document.getElementById("league").textContent;return !/Manchester City|Brighton & Hove|AFC Bournemouth|Tottenham Hotspur/.test(t)})()')"
# The table used to be model-authored and came back trimmed: positions 1-6, 8,
# 10 and 17, with holes. It is written mechanically now, so it is the whole
# division and the positions run without a gap.
check "the table is the whole division" "true" "$(js '(function(){
  var pos = Array.from(document.querySelectorAll("#league tbody tr")).map(function (tr) {
    return Number(tr.children[0].textContent.trim());
  });
  if (pos.length < 20) return false;
  return pos.every(function (p, i) { return p === i + 1; });
})()')"
# Form is derived from results now, so every club that has played has one.
check "form is not just the famous clubs" "true" "$(js '(function(){
  var rows = Array.from(document.querySelectorAll("#league tbody tr"));
  var withForm = rows.filter(function (tr) { return tr.children[2].textContent.trim().length > 0; });
  return withForm.length >= rows.length - 2;
})()')"

echo "== touchline: the league panel"
go ""
# The river arrives from /api/matches AFTER first paint, and a cold edge cache
# makes that call ~1.8s against a flat 2s sleep — so this raced and reported a
# missing river as a broken page. Wait for the thing itself.
for _ in 1 2 3 4 5 6 7 8 9 10; do
  [ "$(js 'document.querySelectorAll("#league .fx-dayhead").length > 0')" = "true" ] && break
  sleep 1
done
check "one panel, two tabs" "2" "$(js 'document.querySelectorAll("#league .tabs .fc").length')"
check "exactly one tab is on" "1" "$(js 'document.querySelectorAll("#league .tabs .fc[aria-selected=true]").length')"
check "exactly one pane shown" "1" \
  "$(js 'document.querySelectorAll("#league .tabpane:not([hidden])").length')"
check "the table is in a tab"  "true" \
  "$(js 'document.querySelectorAll("#league [data-pane=table] tbody tr").length > 0')"
# The tabs were FPL gameweeks, which is why a Tuesday in Europe could never
# appear in one. The river is a calendar window instead: a week either side of
# today, grouped by day, with a rule where today falls.
check "no gameweek tabs remain" "0" \
  "$(js 'document.querySelectorAll("#league .fc[data-tab=now], #league .fc[data-tab=next]").length')"
js 'const b=document.querySelector("#league .fc[data-tab=matches]"); if(b) b.click(); ""' >/dev/null
sleep 0.5
check "the river has matches" "true" \
  "$(js 'document.querySelectorAll("#league [data-pane=matches] .fx").length > 0')"
# The day heading is a collapsible button now, not a bare .fx-day div — this
# check asserted the old markup and read a restructure as a broken page.
check "grouped by day"       "true" \
  "$(js 'document.querySelectorAll("#league [data-pane=matches] .fx-dayhead").length > 1')"
check "and a day can be opened and shut" "true" "$(js '(function(){
  var h = document.querySelector("#league [data-pane=matches] .fx-dayhead");
  if (!h) return "no day heading";
  var was = h.getAttribute("aria-expanded");
  h.click();
  return h.getAttribute("aria-expanded") !== was;
})()')"
check "today is ruled once"  "1" \
  "$(js 'document.querySelectorAll("#league [data-pane=matches] .fx-today").length')"
check "a played match shows a score" "true" \
  "$(js '[...document.querySelectorAll("#league [data-pane=matches] .fx-score")].some(s => /\d/.test(s.textContent))')"
# ESPN sends score "0" for a fixture that has not kicked off, so an upcoming
# match will claim to be a goalless draw unless the status is consulted.
check "an upcoming match shows a time, not 0-0" "true" \
  "$(js '[...document.querySelectorAll("#league [data-pane=matches] .fx-score.pre")].every(s => !/\d/.test(s.textContent))')"
check "no attribute leaked into a scorer name" "false" \
  "$(js '/plink|data-player|\">/.test(document.querySelector("#league [data-pane=matches]").innerText)')"
# The rule, changed 2026-08-29: a name that is a whole ROW links, a name inside
# a run of text does not. A goalscorer line is a comma-separated run, so it is
# plain text — six underlined names made a match row look like a bibliography.
check "scorer names are plain text" "true" "$(js '(function(){
  var lines = [...document.querySelectorAll("#league [data-pane=matches] .fx-goals .g")]
    .filter(function (x) { return x.textContent.trim().length; });
  if (!lines.length) return true;
  return lines.every(function (x) { return !x.querySelector("[data-pid], .plink"); });
})()')"
# And the seam still exists where the name IS the row, so it was narrowed
# rather than dropped.
check "a row-name still opens a card" "true" "$(js '(function(){
  var a = document.querySelector("#main .rows .row-name .plink");
  if (!a) return true;
  a.click();
  var open = !document.getElementById("fa-backdrop").hidden;
  FA.closeCard();
  return open;
})()')"

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
# Back to your OWN room first: the checks above switch to Le Professeur, and
# a star only renders where you can press it — in your own watchlist and
# nobody else's. Without this the whole block skips itself.
js 'const n=FA.myNick(); const b=n && document.querySelector(`#gbar .gchip[data-nick="${n}"]`); if (b) b.click(); ""' >/dev/null
sleep 1
check "back in your own room" "true" "$(js 'const p=document.querySelector("#gbar .gchip[aria-pressed=true]"); !!p && p.textContent.includes(FA.myNick())')"

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

check "the chip clock is gone"        "0" \
  "$(js '[...document.querySelectorAll("#main .panel h3")].filter(function(h){return /chip clock/i.test(h.textContent)}).length')"
check "crowd missed is gone from here" "0" \
  "$(js '[...document.querySelectorAll("#main .panel h3")].filter(function(h){return /crowd missed/i.test(h.textContent)}).length')"
# The week looks backwards. "What's next" was an essay and became The Big
# Decision, which is short and only appears when it can still change something.
check "the week is two blocks, not three" "2" \
  "$(js 'document.querySelectorAll(".week2 .wk").length')"
check "no What is next block remains"  "0" \
  "$(js '[...document.querySelectorAll("#main h4")].filter(function(h){return /next/i.test(h.textContent)}).length')"
# Only assertable when the deadline is close; the check passes cleanly when the
# panel is correctly absent.
check "the big decision is short and timed" "true" "$(js '(function(){
  var p = document.querySelector(".panel.big");
  if (!p) return true;
  var rows = p.querySelectorAll(".row").length;
  return rows > 0 && rows <= 2 && !!p.querySelector(".big-clock");
})()')"

# The card is reachable from every room, and since 2026-08-27 it is where a
# star is pressed. Both halves are new and neither had coverage.
echo "== the card: the five drawn, and the star"
js 'const a=document.querySelector("[data-player]"); if (a) a.click(); ""' >/dev/null
sleep 0.5
check "card opens from a name"   "false" "$(js 'document.getElementById("fa-backdrop").hidden')"
check "owners drawn, not lettered" "true" "$(js 'const o=document.querySelector(".pcard .ownfaces"); !!o && (o.querySelectorAll(".ownface .face").length > 0 || /nobody in the five/.test(o.textContent))')"
check "signed in, card offers the star" "1" "$(js 'document.querySelectorAll(".pcard .cardstar").length')"
check "star button says which way it goes" "true" "$(js '/watchlist/i.test(document.querySelector(".pcard .cardstar").textContent)')"
# The label has to be an ACTION in both directions. "On your watchlist" was a
# status sitting on a button, and an already-starred player was offered "Add
# to your watchlist" again whenever the star list had not landed yet.
check "no status-as-label"  "true" "$(js '!/On your watchlist/i.test(document.querySelector(".pcard .cardstar").textContent)')"
CWAS=$(js 'document.querySelector(".pcard .cardstar").getAttribute("aria-pressed")')
js 'document.querySelector(".pcard .cardstar").click(); ""' >/dev/null
sleep 1
check "card star flips"     "true" "$(js "document.querySelector('.pcard .cardstar').getAttribute('aria-pressed') !== '$CWAS'")"
check "starred says how to undo it" "true" "$(js 'const b=document.querySelector(".pcard .cardstar"); b.getAttribute("aria-pressed") !== "true" || /Remove/i.test(b.textContent)')"
check "unstarred says how to add"   "true" "$(js 'const b=document.querySelector(".pcard .cardstar"); b.getAttribute("aria-pressed") !== "false" || /Add/i.test(b.textContent)')"
# The bug that started this: a starred row said NAILED and the card it opened
# said "nobody in the five", because they were two different players sharing a
# surname. The row carries the team; the card has to agree.
check "card agrees with the row that opened it" "true" "$(js '(function(){
  FA.closeCard();
  var a = document.querySelector(".panel .rows .row [data-pid]");
  if (!a) return true;
  var side = a.closest(".row").querySelector(".row-side");
  if (!side) return true;
  var team = side.textContent.trim().split(/\s+/)[0];
  a.click();
  var meta = document.querySelector(".pcard .meta").textContent;
  var ok = meta.indexOf(team) !== -1;
  return ok;
})()')"
js 'document.querySelector(".pcard .cardstar").click(); ""' >/dev/null   # put it back
sleep 0.5
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
# 14 surnames are shared in a 622-man file — two Palmers, two Wilsons, three
# Phillipses. Cards used to be addressed by NAME, so clicking Chelsea's Palmer
# opened the Ipswich goalkeeper. Every link carries the element id now; the
# price is the discriminator, since the two Palmers are £9.5m and £4.0m.
check "every card is the man whose row opened it" "true" "$(js '(function(){
  var bad = 0;
  Array.from(document.querySelectorAll("#the-file tbody tr")).slice(0, 30).forEach(function (tr) {
    var a = tr.querySelector("[data-pid]"); if (!a) return;
    var price = tr.querySelector("td.n").textContent.trim();
    a.click();
    if (document.querySelector(".pcard .meta").textContent.indexOf("\u00a3" + price + "m") === -1) bad++;
    FA.closeCard();
  });
  return bad === 0;
})()')"
# Prose has no id to carry, so linkPlayers has to GUESS which Palmer the
# editor meant — and it must guess the one the reader has heard of, not
# whoever sat later in the file.
check "prose picks the player you have heard of" "true" "$(js '(function(){
  var a = document.querySelector("[data-player=\"Palmer\"]");
  if (!a) return true;                       // not in this view, nothing to prove
  a.click();
  var meta = document.querySelector(".pcard .meta").textContent;
  FA.closeCard();
  return /MID/.test(meta);                   // Chelsea midfielder, not the Ipswich keeper
})()')"
check "threshold changes the file" "true" "$(js "${T0} >= ${T10}")"
# "ours" was retired on 2026-08-27; this line only resets the file to a normal
# state before the search assertion, so it resets to everyone instead.
js 'document.querySelector(".fc[data-min=\"2\"]").click(); document.querySelector(".fc[data-f=all]").click(); ""' >/dev/null
js 'const i=document.getElementById("fq"); i.value="haal"; i.dispatchEvent(new Event("input")); ""' >/dev/null
sleep 0.3
check "search filters" "true" "$(js 'document.querySelectorAll("#the-file table tbody tr").length <= 3')"

# ROADMAP 4b: form was Premier League only, so a club that played a cup tie
# showed a gap its real form did not have. Leeds beat Forest twice in four
# days, league then cup, and the card could only see one of them.
js 'const i=document.getElementById("fq"); i.value=""; i.dispatchEvent(new Event("input")); ""' >/dev/null
sleep 0.3
# "What the crowd missed" was a gaffers panel of eight names that could not be
# sorted, searched or crossed with a verdict. It is a question about the player
# file, so it is a filter in the file.
# Renamed from "Team news" on 2026-08-28 and tightened: a club-level signal has
# to carry the FPL consequence. Passes cleanly when there are none to show.
check "the radar carries a consequence" "true" "$(js '(function(){
  var panel = [...document.querySelectorAll("#main .panel")].find(function (p) {
    var h = p.querySelector("h3"); return h && /team radar/i.test(h.textContent);
  });
  if (!panel) return true;
  var rows = [...panel.querySelectorAll(".row")];
  return rows.length > 0 && rows.every(function (r) { return !!r.querySelector(".radar-do"); });
})()')"
check "team news is gone from the locker" "0" "$(js '[...document.querySelectorAll("#main .panel h3")].filter(function(h){return /team news/i.test(h.textContent)}).length')"
check "differentials is a filter in the file" "1" \
  "$(js 'document.querySelectorAll("#the-file .fc[data-f=differentials]").length')"
check "and it narrows to the under-owned" "true" "$(js '(function(){
  document.querySelector("#the-file .fc[data-f=differentials]").click();
  var rows = [...document.querySelectorAll("#the-file tbody tr")];
  if (!rows.length) return "nothing shown";
  return rows.every(function (tr) { return parseFloat(tr.children[3].textContent) < 10; });
})()')"
check "form spans every competition" "true" "$(js '(function(){
  var rows = [...document.querySelectorAll("#the-file [data-pid]")].slice(0, 40);
  for (var i = 0; i < rows.length; i++) {
    rows[i].click();
    var cup = document.querySelector(".pcard .frun i[data-cup]");
    FA.closeCard();
    if (cup) return true;
  }
  return "no cup result on the first 40 cards";
})()')"
# The card is the same object in every room, so the five are drawn here too —
# faces.js used to load only in the gaffers room and this fell back to letters.
# A cup start between two league games is why a player gets rested, and it was
# invisible until the ESPN team sheets were joined to FPL's squads.
check "a midweek appearance reaches the card" "true" "$(js '(function(){
  var rows = [...document.querySelectorAll("#the-file [data-pid]")].slice(0, 40);
  for (var i = 0; i < rows.length; i++) {
    rows[i].click();
    var mw = document.querySelector(".pcard .mw-row.on");
    FA.closeCard();
    if (mw && /Started/.test(mw.textContent)) return true;
  }
  return "no midweek start on the first 40 cards";
})()')"
# What is coming is the CLUB's fixture, not his. The explaining note was cut in
# the caption sweep, so the distinction now rests entirely on the row naming
# the club — which makes it worth a check rather than less worth one.
check "an upcoming cup tie names the club, not the player" "true" "$(js '(function(){
  var rows = [...document.querySelectorAll("#the-file [data-pid]")].slice(0, 20);
  for (var i = 0; i < rows.length; i++) {
    rows[i].click();
    var next = document.querySelector(".pcard .mw-row.next");
    var club = next && next.querySelector("b");
    var team = document.querySelector(".pcard .meta");
    FA.closeCard();
    if (next) return !!club && team.textContent.indexOf(club.textContent) !== -1;
  }
  return true;
})()')"
check "the five are drawn on the card, not lettered" "true" "$(js '(function(){
  var a = document.querySelector("#the-file [data-pid]");
  if (!a) return true;
  a.click();
  var o = document.querySelector(".pcard .ownfaces");
  var ok = !o || o.querySelectorAll(".ownface .face").length > 0 || /nobody in the five/.test(o.textContent);
  FA.closeCard();
  return ok;
})()')"

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
# /usage/ is unlisted, and unlisted means the reading endpoint gives away no
# more than the page does: a 404 whether you are signed out or signed in as
# one of the other four. A 401 or a 403 here would confirm it exists.
USAGE=$(curl -s -o /dev/null -w "%{http_code}" "${BASE}api/telemetry?days=7")
check "api/telemetry hides itself" "404" "$USAGE"
# And the collector accepts a post without ever answering with a body — a
# reader must not be able to tell whether anything was written.
TEL=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${BASE}api/telemetry" \
  -H 'content-type: application/json' -d '{"e":"view","p":"/"}')
check "api/telemetry accepts quietly" "204" "$TEL"
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
