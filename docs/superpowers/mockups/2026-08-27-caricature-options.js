/* Caricature options — four takes on each of the five.
   =========================================================================
   Exploratory, not shipped. Draws on the same 64x64 skeleton as site/faces.js
   so a variant can be lifted straight into it once one is chosen. Option A in
   every row is what is live today, rendered by FA.faceSVG for real.

   Each variant supplies `body(f, uid)` — everything above the bare head — and
   optionally `trim(f)` (drawn on the coat, under the face) and `over(f)`
   (drawn last, for hands and props). The palette `f` comes from
   FA.faceOf(nick), so no colour is redefined here. */
(function () {
  "use strict";

  const TINT = { CHE: "#1E5AA8", MUN: "#C8321F", ARS: "#D8232A" };

  const HEAD = '<ellipse cx="32" cy="27" rx="16" ry="18" />';
  const EAR_L = '<ellipse cx="15.8" cy="29.5" rx="2.8" ry="4" />';
  const EAR_R = '<ellipse cx="48.2" cy="29.5" rx="2.8" ry="4" />';
  const NECK = '<path d="M28.6 41 h6.8 v12 h-6.8 Z" />';
  const COAT = "M10.5 64 C12.6 56 19.4 51.8 25.6 50.6 L32 55.6 L38.4 50.6 " +
    "C44.6 51.8 51.4 56 53.5 64 Z";
  const COLLAR = "M25.6 50.6 L32 55.6 L38.4 50.6 L36.2 49.5 L32 53 L27.8 49.5 Z";
  const EL = 25.6, ER = 38.4, EY = 27;

  /* ---- small parts, shared by the variants ---- */
  const eye = (x, y, r) =>
    '<ellipse cx="' + x + '" cy="' + (y || EY) + '" rx="' + (r || 2.2) + '" ry="' +
    ((r || 2.2) + 0.3) + '" fill="#241F1A"/>';
  const eyes = (r, y) => eye(EL, y, r) + eye(ER, y, r);
  // A closed eye is an arc, not a dot: shouting and winking both need it.
  const shut = (x, y) =>
    '<path d="M' + (x - 3.2) + " " + (y || EY) + ' q3.2 -3.2 6.4 0" stroke="#241F1A" ' +
    'stroke-width="2" fill="none" stroke-linecap="round"/>';
  // Half-lidded: the eye, then a lid in skin over the top of it.
  const lidded = (x, f) =>
    eye(x, EY + 0.4, 2.2) +
    '<path d="M' + (x - 3) + " " + (EY - 0.4) + " q3 -2.2 6 0 v-2.6 h-6 Z\" fill=\"" +
    f.skin + '"/>';
  const brow = (x1, y1, x2, y2, c, w) =>
    '<path d="M' + x1 + " " + y1 + " L" + x2 + " " + y2 + '" stroke="' + c +
    '" stroke-width="' + (w || 2) + '" stroke-linecap="round"/>';
  const browArc = (x, y, c, w, lift) =>
    '<path d="M' + x + " " + y + " q4 " + (lift || -1.6) + " 8 0\" stroke=\"" + c +
    '" stroke-width="' + (w || 1.9) + '" fill="none" stroke-linecap="round"/>';
  const nose = (f, x, y, len) =>
    '<path d="M' + x + " " + y + " L" + (x - 1.2) + " " + (y + (len || 5)) +
    ' q2 1.2 3.8 0" stroke="' + f.shade + '" stroke-width="1.7" fill="none" ' +
    'stroke-linecap="round" stroke-linejoin="round"/>';
  const shout = (cy, rx, ry) =>
    '<ellipse cx="32" cy="' + cy + '" rx="' + rx + '" ry="' + ry + '" fill="#6E2A20"/>' +
    '<path d="M' + (32 - rx * 0.82) + " " + (cy - ry * 0.45) + " q" + (rx * 0.82) +
    " -2.6 " + (rx * 1.64) + " 0 q-" + (rx * 0.82) + " 2 -" + (rx * 1.64) +
    ' 0 Z" fill="#FFFFFF"/>' +
    '<ellipse cx="32" cy="' + (cy + ry * 0.5) + '" rx="' + (rx * 0.5) +
    '" ry="' + (ry * 0.28) + '" fill="#C1584A"/>';
  // A forearm rising into frame, for the variants that need a hand.
  const arm = (f, x, flip) =>
    '<g transform="translate(' + x + ' 0)' + (flip ? " scale(-1 1)" : "") + '">' +
    '<path d="M2 64 L13 64 L11 48 L1 50 Z" fill="' + f.coat + '"/>' +
    '<path d="M1 50 L11 48 L11.6 52 L1.6 54 Z" fill="#FFFFFF" fill-opacity=".16"/>' +
    "</g>";

  /* ---- the hair each face is known by, reused across its own variants ---- */
  const HAIR = {
    fergie: (f) => '<path d="M14.4 33.6 C13.6 23.6 15 13.4 22.2 9.6 C26.2 7.4 29.4 7 32 7 ' +
      "C34.6 7 37.8 7.4 41.8 9.6 C49 13.4 50.4 23.6 49.6 33.6 " +
      "C48.4 34.6 46.4 34.2 45.8 32.8 C45.6 25.4 45 20.8 43.4 18.4 " +
      "C41.2 15.2 36.8 16.2 32 16.2 C27.2 16.2 22.8 15.2 20.6 18.4 " +
      "C19 20.8 18.4 25.4 18.2 32.8 C17.6 34.2 15.6 34.6 14.4 33.6 Z\" fill=\"" +
      f.hair + '"/>',
    xabi: (f) => '<path d="M16 26 C16 13 22.6 7.4 32 7.4 C41.4 7.4 48 13 48 26 ' +
      "C46.4 19.6 44.8 17 42.4 15.8 C38 18 26 18 21.6 15.8 " +
      "C19.2 17 17.6 19.6 16 26 Z\" fill=\"" + f.hair + '"/>',
    cr7: (f) => '<path d="M19.4 15.6 C22.4 4.6 37.4 0.6 46 6.6 C47.6 7.6 47.4 8.8 45.4 8.6 ' +
      "C36.4 7.8 26 10.2 19.4 15.6 Z\" fill=\"" + f.hair + '"/>' +
      '<path d="M16.2 25 C16.2 12 23.6 6.4 32 6.4 C41 6.4 47.8 12.2 47.6 24.2 ' +
      "C46.4 19.4 44.8 16.6 42.2 15 C37.8 17.4 25.6 17.4 21.2 15 " +
      "C18.8 16.6 17.4 19.8 16.2 25 Z\" fill=\"" + f.hair + '"/>',
    mourinho: (f) => '<path d="M15 27.4 C14.2 14.6 21.8 8 32 8 C42.2 8 49.8 14.6 49 27.4 ' +
      "C47.8 18.4 45 14.2 39.4 13 C36.8 15.6 34.2 17.4 32 18.6 " +
      "C29.8 17.4 27.2 15.6 24.6 13 C19 14.2 16.2 18.4 15 27.4 Z\" fill=\"" +
      f.hair + '"/>',
    wenger: (f) => '<path d="M15 32.6 C14.2 21.8 19.4 8.6 32 8.6 C44.4 8.6 49.8 22.4 49 32.6 ' +
      "C48.4 24.6 47.2 19.6 44.8 17.6 C42.2 15.4 38.6 16.4 34.4 18 " +
      "C28.6 20.2 18.4 23.4 15 32.6 Z\" fill=\"" + f.hair + '"/>',
  };

  const stubble = (uid, op) =>
    '<ellipse cx="32" cy="43" rx="14.4" ry="9.6" fill="#4A4F55" opacity="' + (op || 0.26) +
    '" clip-path="url(#' + uid + 'h)"/>';
  const specs = (y, w) =>
    '<g fill="none" stroke="#3A3F45" stroke-width="' + (w || 1.5) + '">' +
    '<rect x="18.4" y="' + y + '" width="12" height="9.4" rx="3" fill="#FFFFFF" ' +
    'fill-opacity=".18"/>' +
    '<rect x="33.6" y="' + y + '" width="12" height="9.4" rx="3" fill="#FFFFFF" ' +
    'fill-opacity=".18"/>' +
    '<path d="M30.4 ' + (y + 3.8) + ' h3.2"/><path d="M18.4 ' + (y + 3) + " L14.4 " +
    (y + 4.4) + '"/><path d="M45.6 ' + (y + 3) + " L49.6 " + (y + 4.4) + '"/></g>';

  const TIE = (f) => '<path d="' + COLLAR + '" fill="#E8E6E0"/>' +
    '<path d="M32 55.6 L29.8 58 L32 64 L34.2 58 Z" fill="' + f.collar + '"/>';
  const LAPELS = (f) => '<path d="M25.6 50.6 L32 55.6 L27.6 64 L20.6 64 Z" fill="' +
    f.collar + '"/><path d="M38.4 50.6 L32 55.6 L36.4 64 L43.4 64 Z" fill="' +
    f.collar + '"/>';
  const VEE = (f) => '<path d="' + COLLAR + '" fill="' + f.collar + '"/>';
  const CHAIN = '<path d="M27.6 54.6 q4.4 5.2 8.8 0" stroke="#E8B84B" ' +
    'stroke-width="1.6" fill="none" stroke-linecap="round"/>';

  /* ======================= the options ======================= */
  const OPTIONS = {
    "Sir Fergie": [
      { id: "B", label: "Hairdryer, full blast",
        note: "The shout, not the nose. Whole face flushed, brows slammed down.",
        trim: TIE,
        body: (f, uid) =>
          '<ellipse cx="32" cy="31" rx="15" ry="15" fill="#C4402A" opacity=".34" ' +
          'clip-path="url(#' + uid + 'h)"/>' + HAIR.fergie(f) +
          brow(19.6, 20.2, 30.6, 25.8, "#B9B2A8", 2.8) +
          brow(44.4, 20.2, 33.4, 25.8, "#B9B2A8", 2.8) +
          eyes(1.7) +
          '<ellipse cx="32" cy="33.4" rx="3.8" ry="4" fill="#B8402B" opacity=".7"/>' +
          shout(42, 6.6, 5.6) +
          // the veins, which is the only place a caricature may put them
          '<path d="M17.6 25.6 q2.4 1.6 1.6 4.4" stroke="#B8402B" stroke-width="1.2" ' +
          'fill="none" opacity=".5"/>' +
          '<path d="M46.4 25.6 q-2.4 1.6 -1.6 4.4" stroke="#B8402B" stroke-width="1.2" ' +
          'fill="none" opacity=".5"/>' },
      { id: "C", label: "The gum",
        note: "Not shouting. Chewing, half-lidded, and enjoying something you cannot see.",
        trim: TIE,
        body: (f, uid) =>
          '<ellipse cx="32" cy="31" rx="15" ry="15" fill="#C4402A" opacity=".12" ' +
          'clip-path="url(#' + uid + 'h)"/>' + HAIR.fergie(f) +
          browArc(20.6, 24.4, "#B9B2A8", 2.2) + browArc(35.4, 24.4, "#B9B2A8", 2.2) +
          lidded(EL, f) + lidded(ER, f) +
          '<ellipse cx="32" cy="34" rx="3" ry="3.4" fill="#B8402B" opacity=".45"/>' +
          // the gum, parked in one cheek
          '<ellipse cx="41.4" cy="37.6" rx="3.6" ry="3.2" fill="' + f.skin + '"/>' +
          '<path d="M38.4 39.6 q2.6 1.6 5.2 -0.6" stroke="' + f.shade +
          '" stroke-width="1" fill="none" opacity=".5"/>' +
          '<path d="M25.6 40.6 q5 2.4 10.4 -2.4" stroke="#7A4436" stroke-width="1.8" ' +
          'fill="none" stroke-linecap="round"/>' },
      { id: "D", label: "Tapping the watch",
        note: "Fergie time. Eyes to slits, one brow up, and the wrist raised into frame.",
        trim: TIE,
        body: (f, uid) =>
          '<ellipse cx="32" cy="31" rx="15" ry="15" fill="#C4402A" opacity=".18" ' +
          'clip-path="url(#' + uid + 'h)"/>' + HAIR.fergie(f) +
          browArc(20.6, 24, "#B9B2A8", 2.2) + browArc(35.4, 21.4, "#B9B2A8", 2.2, -3.4) +
          // slits, because he is not asking
          '<path d="M22.4 27.2 h6.4" stroke="#241F1A" stroke-width="2.4" ' +
          'stroke-linecap="round"/>' +
          '<path d="M35.2 27.2 h6.4" stroke="#241F1A" stroke-width="2.4" ' +
          'stroke-linecap="round"/>' +
          '<ellipse cx="32" cy="34" rx="3.2" ry="3.6" fill="#B8402B" opacity=".5"/>' +
          '<path d="M27.6 41 h8.8" stroke="#7A4436" stroke-width="1.8" ' +
          'stroke-linecap="round"/>',
        // The wrist comes up the right-hand side with the watch turned to face
        // you. No second hand tapping it — two hands at this size is soup.
        over: (f) =>
          '<path d="M50 64 L62 64 L54.6 40.4 L43.4 44.6 Z" fill="' + f.coat + '"/>' +
          '<path d="M43.4 44.6 L54.6 40.4 L56.4 46.2 L45.2 50.4 Z" fill="#E8E6E0"/>' +
          '<path d="M45.2 50.4 L56.4 46.2 L57.6 50 L46.4 54.2 Z" fill="#20242A"/>' +
          '<circle cx="51.6" cy="52" r="4.6" fill="#20242A"/>' +
          '<circle cx="51.6" cy="52" r="3.2" fill="#E8E6E0"/>' +
          '<path d="M51.6 52 V49.6 M51.6 52 h2" stroke="#20242A" stroke-width="0.8" ' +
          'stroke-linecap="round"/>' +
          '<ellipse cx="47.6" cy="41.6" rx="6.2" ry="5.2" fill="' + f.skin + '" ' +
          'transform="rotate(-20 47.6 41.6)"/>' +
          '<g stroke="' + f.shade + '" stroke-width="0.9" opacity=".45" fill="none">' +
          '<path d="M44 39.6 q3.4 -1.6 6.6 -0.4"/><path d="M44.8 42.8 q3.4 -1.6 6.6 -0.4"/>' +
          "</g>" },
    ],

    "Xabi": [
      { id: "B", label: "The gaffer",
        note: "Not the midfielder — the manager. Beard trimmed to a strap, black coat, one brow up.",
        trim: () => '<path d="M25.6 50.6 L32 55.6 L27.6 64 L20.6 64 Z" fill="#20242B"/>' +
          '<path d="M38.4 50.6 L32 55.6 L36.4 64 L43.4 64 Z" fill="#20242B"/>' +
          '<path d="M29.4 52.4 h5.2 v11.6 h-5.2 Z" fill="#E8E6E0"/>',
        body: (f, uid) =>
          '<path d="M16 26.6 C16 13 22.6 7.4 32 7.4 C41.4 7.4 48 13 48 26.6 ' +
          "C47 20.4 45.6 17.4 43.4 16 C39 18.6 25 18.6 20.6 16 " +
          "C18.4 17.4 17 20.4 16 26.6 Z\" fill=\"" + f.hair + '"/>' +
          // a strap, not a thicket
          '<path d="M18.6 31.4 C19 35.4 20.2 39.6 22.6 42.6 C25.4 46 29.6 47 32 47 ' +
          "C34.4 47 38.6 46 41.4 42.6 C43.8 39.6 45 35.4 45.4 31.4 " +
          "C44.4 35.2 42 36.6 38.6 37 C35.6 37.3 28.4 37.3 25.4 37 " +
          "C22 36.6 19.6 35.2 18.6 31.4 Z\" fill=\"" + f.hair + '" opacity=".92"/>' +
          browArc(20.6, 22.8, "#120C06", 2) + browArc(35.4, 21.2, "#120C06", 2, -2.6) +
          eyes(2.2) + nose(f, 32, 30.4, 5) +
          '<path d="M26.4 38.6 q5.6 -2 11.2 0 q-2.8 2.6 -5.6 2.6 q-2.8 0 -5.6 -2.6 Z" ' +
          'fill="' + f.hair + '"/>' +
          '<path d="M28.4 42.6 q3.6 2 7.2 -1.4" stroke="#7A4A38" stroke-width="1.6" ' +
          'fill="none" stroke-linecap="round"/>' },
      { id: "C", label: "The beard, unchecked",
        note: "The joke is the scale. It has left the jaw, taken the shirt, and is heading for the badge.",
        trim: VEE,
        body: (f, uid) => HAIR.xabi(f) +
          '<path d="M11 33 C11.4 41 13.4 50 17.6 57 C22 64 27.6 64 32 64 ' +
          "C36.4 64 42 64 46.4 57 C50.6 50 52.6 41 53 33 " +
          "C50.6 40 45 42.6 38.4 43.2 C34.6 43.5 29.4 43.5 25.6 43.2 " +
          "C19 42.6 13.4 40 11 33 Z\" fill=\"" + f.hair + '"/>' +
          browArc(20.4, 22.6, "#120C06", 2) + browArc(35.4, 22.6, "#120C06", 2) +
          eyes(2.2) + nose(f, 32, 30.4, 4.6) +
          '<path d="M26.6 41.8 q5.4 -2 10.8 0 q-2.7 2.4 -5.4 2.4 q-2.7 0 -5.4 -2.4 Z" ' +
          'fill="' + f.hair + '"/>' },
      { id: "D", label: "Mid-pass",
        note: "Looking where the ball is going, not at you. Both eyes over, mouth open a crack.",
        trim: VEE,
        body: (f, uid) => HAIR.xabi(f) +
          '<path d="M16.6 30.4 C16.8 36.4 18 43.6 21.4 49.6 C25 55.8 29.2 58.4 32 58.4 ' +
          "C34.8 58.4 39 55.8 42.6 49.6 C46 43.6 47.2 36.4 47.4 30.4 " +
          "C45.8 36.4 42.4 38.8 37.6 39.4 C34.2 39.8 29.8 39.8 26.4 39.4 " +
          "C21.6 38.8 18.2 36.4 16.6 30.4 Z\" fill=\"" + f.hair + '"/>' +
          brow(21.4, 23.8, 29.4, 22.2, "#120C06", 2) +
          brow(36.4, 22, 44, 23.4, "#120C06", 2) +
          eye(EL + 2.6, EY, 2.2) + eye(ER + 2.4, EY, 2.2) +
          nose(f, 33.4, 30.4, 5) +
          '<path d="M26.6 37.6 q6.4 -2.2 12.8 0 q-3.2 3 -6.4 3 q-3.2 0 -6.4 -3 Z" ' +
          'fill="' + f.hair + '"/>' +
          '<ellipse cx="33" cy="42.6" rx="2.6" ry="1.8" fill="#5E3428"/>' },
    ],

    "Mr CR7": [
      { id: "B", label: "The landing",
        note: "Eyes shut, chin up, everything open. The moment after the jump, not during it.",
        trim: (f) => VEE(f) + CHAIN,
        body: (f, uid) => HAIR.cr7(f) +
          browArc(20.4, 20.8, "#2A2018", 2, -2.6) + browArc(35.6, 20.8, "#2A2018", 2, -2.6) +
          shut(EL, 25.4) + shut(ER, 25.4) +
          nose(f, 32, 28.6, 4.2) +
          shout(39.6, 6, 6.4) },
      { id: "C", label: "The pose",
        note: "Chin up, brows up, mouth shut. Nothing has happened yet and he is already pleased.",
        trim: (f) => VEE(f) + CHAIN,
        body: (f, uid) => HAIR.cr7(f) +
          browArc(20.4, 20.6, "#2A2018", 1.9, -2.4) + browArc(35.6, 20.6, "#2A2018", 1.9, -2.4) +
          eyes(2.1, 25.6) + nose(f, 32, 29, 4.4) +
          '<path d="M26.6 37.6 q5.4 3 10.8 -1.6" stroke="#7A4436" stroke-width="1.9" ' +
          'fill="none" stroke-linecap="round"/>' +
          // the jaw he keeps for exactly this
          '<path d="M22.4 38.6 q9.6 8 19.2 0" stroke="' + f.shade + '" stroke-width="1.1" ' +
          'fill="none" opacity=".45"/>' },
      { id: "D", label: "The stare",
        note: "Free kick. Cheeks full, brows down, and not a trace of the smile.",
        trim: (f) => VEE(f) + CHAIN,
        body: (f, uid) => HAIR.cr7(f) +
          brow(20.4, 21.4, 29.6, 24.6, "#2A2018", 2.1) +
          brow(43.6, 21.4, 34.4, 24.6, "#2A2018", 2.1) +
          eyes(1.9) + nose(f, 32, 30.4, 4.8) +
          '<ellipse cx="20.6" cy="36.6" rx="4.2" ry="3.6" fill="' + f.skin + '"/>' +
          '<ellipse cx="43.4" cy="36.6" rx="4.2" ry="3.6" fill="' + f.skin + '"/>' +
          '<path d="M27.4 40.4 h9.2" stroke="#6E3226" stroke-width="2" ' +
          'stroke-linecap="round"/>' },
    ],

    "The Special One": [
      { id: "B", label: "The shush",
        note: "One finger, and the whole ground told. The most quotable thing he ever did.",
        trim: LAPELS,
        body: (f, uid) => HAIR.mourinho(f) + stubble(uid, 0.24) +
          browArc(20.6, 22.6, "#6C7075", 1.9) + browArc(35.4, 22.6, "#6C7075", 1.9) +
          eyes(2.3) + nose(f, 32, 30.4, 5.2) +
          '<path d="M28 40.6 h8" stroke="#7A4E3E" stroke-width="1.8" ' +
          'stroke-linecap="round"/>',
        over: (f) => arm(f, 24) +
          '<ellipse cx="31.4" cy="50.4" rx="5.6" ry="4.8" fill="' + f.skin + '"/>' +
          '<path d="M31.4 48.6 V36.4" stroke="' + f.skin + '" stroke-width="4.4" ' +
          'stroke-linecap="round"/>' +
          '<path d="M31.4 37.4 v1.6" stroke="' + f.shade + '" stroke-width="0.9" ' +
          'stroke-linecap="round" opacity=".5"/>' },
      { id: "C", label: "Three fingers",
        note: "Held up, unhurried, at somebody else's crowd. The smirk stays.",
        trim: LAPELS,
        body: (f, uid) => HAIR.mourinho(f) + stubble(uid, 0.26) +
          browArc(20.6, 23.4, "#6C7075", 1.9) + browArc(35.4, 21.8, "#6C7075", 2.1, -3) +
          eyes(2.1) + nose(f, 32, 30.4, 5.2) +
          '<path d="M24.6 41.4 q5 2.6 10.6 -2.4" stroke="#7A4E3E" stroke-width="2" ' +
          'fill="none" stroke-linecap="round"/>',
        over: (f) => arm(f, 42) +
          '<path d="M45.4 52 q6 -1 8.4 0.6 v6 q-4.4 1.4 -8.4 -0.4 Z" fill="' + f.skin + '"/>' +
          '<g stroke="' + f.skin + '" stroke-width="3.2" stroke-linecap="round">' +
          '<path d="M47.4 51.6 V42.6"/><path d="M51 51.8 V41.4"/>' +
          '<path d="M54.4 52.6 V44"/></g>' +
          '<g stroke="' + f.shade + '" stroke-width="0.8" opacity=".45">' +
          '<path d="M49.2 46 v5"/><path d="M52.7 46 v5"/></g>' },
      { id: "D", label: "Collar up",
        note: "Not performing. Collar to the jaw, eyes down, nothing to say to anyone.",
        trim: () => "",
        body: (f, uid) => HAIR.mourinho(f) + stubble(uid, 0.32) +
          brow(20.6, 23.8, 29.4, 23, "#6C7075", 1.9) +
          brow(43.4, 23.8, 34.6, 23, "#6C7075", 1.9) +
          // looking down: the eye sits low and a lid takes the top of it
          eye(EL, EY + 1.4, 2.2) + eye(ER, EY + 1.4, 2.2) +
          '<path d="M22.4 27 q3.2 -2.4 6.4 0 v-3 h-6.4 Z" fill="' + f.skin + '"/>' +
          '<path d="M35.2 27 q3.2 -2.4 6.4 0 v-3 h-6.4 Z" fill="' + f.skin + '"/>' +
          nose(f, 32, 31, 5) +
          '<path d="M28 41 h8" stroke="#7A4E3E" stroke-width="1.7" ' +
          'stroke-linecap="round"/>',
        over: (f) =>
          '<path d="M8 64 C8 52 16 45.6 24.6 44.6 L32 51 L39.4 44.6 ' +
          'C48 45.6 56 52 56 64 Z" fill="' + f.coat + '"/>' +
          // the collar, up and stiff
          '<path d="M24.6 44.6 L32 51 L26 64 L15.6 64 C15.6 54 19 47.6 24.6 44.6 Z" ' +
          'fill="' + f.collar + '"/>' +
          '<path d="M39.4 44.6 L32 51 L38 64 L48.4 64 C48.4 54 45 47.6 39.4 44.6 Z" ' +
          'fill="' + f.collar + '"/>' },
    ],

    "Le Professeur": [
      { id: "B", label: "Fighting the zip",
        note: "The zip is winning, the argument continues regardless. Both hands on it.",
        trim: () => "",
        body: (f, uid) => HAIR.wenger(f) +
          browArc(19.6, 20.4, "#8E857C", 1.9, -2.6) + browArc(37.4, 20.4, "#8E857C", 1.9, -2.6) +
          eyes(2.1) + specs(22.6) +
          '<path d="M32.4 32 L29.4 41 q2.8 1.8 5.4 0.2" stroke="' + f.shade + '" ' +
          'stroke-width="1.9" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' +
          shout(46.4, 4.4, 3.8),
        over: (f) =>
          '<path d="M13 64 C13 56 18 51.4 24 50.4 L32 55 L40 50.4 ' +
          'C46 51.4 51 56 51 64 Z" fill="' + f.coat + '"/>' +
          '<g stroke="#FFFFFF" stroke-opacity=".12" stroke-width="1.3" fill="none">' +
          '<path d="M15 58 q17 -5 34 0"/></g>' +
          '<path d="M32 52 V64" stroke="' + f.collar + '" stroke-width="2.4"/>' +
          // forearms first, then the hands, or the hands read as two thumbprints
          '<path d="M16.6 64 L25.4 64 L29 54 L20.4 51.6 Z" fill="' + f.coat + '"/>' +
          '<path d="M47.4 64 L38.6 64 L35 54 L43.6 51.6 Z" fill="' + f.coat + '"/>' +
          '<ellipse cx="27.4" cy="53" rx="4.8" ry="4.2" fill="' + f.skin + '"/>' +
          '<ellipse cx="36.6" cy="53" rx="4.8" ry="4.2" fill="' + f.skin + '"/>' +
          '<g stroke="' + f.shade + '" stroke-width="0.9" opacity=".5" fill="none">' +
          '<path d="M24.4 51.6 q3 -1.4 6 0"/><path d="M24.4 54.4 q3 -1.4 6 0"/>' +
          '<path d="M33.6 51.6 q3 -1.4 6 0"/><path d="M33.6 54.4 q3 -1.4 6 0"/></g>' +
          '<circle cx="32" cy="52.4" r="2.2" fill="#DFE1E4"/>' },
      { id: "C", label: "Over the top of them",
        note: "Glasses down the nose, brows up. He did not see the incident and neither did you.",
        trim: (f) => '<path d="' + COLLAR + '" fill="' + f.collar + '"/>',
        body: (f, uid) => HAIR.wenger(f) +
          browArc(19.6, 18.6, "#8E857C", 1.9, -3) + browArc(37.4, 18.6, "#8E857C", 1.9, -3) +
          // the eyes are ABOVE the frames, which is the whole point
          eye(EL, 24.4, 2.2) + eye(ER, 24.4, 2.2) +
          '<path d="M32.4 27.4 L29.4 39.4 q2.8 1.8 5.4 0.2" stroke="' + f.shade + '" ' +
          'stroke-width="1.9" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' +
          specs(29.4, 1.4) +
          '<path d="M27.4 44.4 q4.6 -1.6 9.2 0" stroke="#8A5C48" stroke-width="1.8" ' +
          'fill="none" stroke-linecap="round"/>' },
      { id: "D", label: "But what?!",
        note: "Arms out, palms up, the referee already walking away. Mouth open, and staying open.",
        trim: (f) => '<path d="' + COLLAR + '" fill="' + f.collar + '"/>',
        body: (f, uid) => HAIR.wenger(f) +
          browArc(19.6, 18.8, "#8E857C", 2, -3.2) + browArc(37.4, 18.8, "#8E857C", 2, -3.2) +
          eyes(2.3) + specs(22.6) +
          '<path d="M32.4 32 L29.4 40.4 q2.8 1.8 5.4 0.2" stroke="' + f.shade + '" ' +
          'stroke-width="1.9" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' +
          shout(45.6, 4.6, 4.2),
        over: (f) =>
          '<g fill="' + f.coat + '">' +
          '<path d="M22 52 L10 56 L6 64 L18 64 Z"/><path d="M42 52 L54 56 L58 64 L46 64 Z"/></g>' +
          '<ellipse cx="7.4" cy="55" rx="5.4" ry="4.6" fill="' + f.skin + '"/>' +
          '<ellipse cx="56.6" cy="55" rx="5.4" ry="4.6" fill="' + f.skin + '"/>' +
          // four fingers on each, splayed: the gesture is the whole point
          '<g stroke="' + f.skin + '" stroke-width="2.4" stroke-linecap="round">' +
          '<path d="M5 51.6 L3.4 46.6"/><path d="M8 51 L7.6 45.8"/>' +
          '<path d="M11 51.6 L11.8 46.8"/>' +
          '<path d="M59 51.6 L60.6 46.6"/><path d="M56 51 L56.4 45.8"/>' +
          '<path d="M53 51.6 L52.2 46.8"/></g>' +
          '<g stroke="' + f.shade + '" stroke-width="0.8" opacity=".4" fill="none">' +
          '<path d="M4.4 55.4 h6"/><path d="M53.6 55.4 h6"/></g>' },
    ],
  };

  /* ---- the frame, matching site/faces.js exactly ---- */
  let seq = 0;
  window.variantSVG = function (nick, v) {
    const f = FA.faceOf(nick);
    const uid = "vf" + (++seq);
    const tint = TINT[f.club] || "#6B7280";
    return '<svg class="face" viewBox="0 0 64 64" role="img" aria-label="' + nick +
      " option " + v.id + '">' +
      "<defs>" +
      '<clipPath id="' + uid + 'd"><circle cx="32" cy="32" r="31"/></clipPath>' +
      '<clipPath id="' + uid + 'h">' + HEAD + "</clipPath>" +
      '<linearGradient id="' + uid + 'g" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="' + tint + '" stop-opacity=".26"/>' +
      '<stop offset="1" stop-color="' + tint + '" stop-opacity=".08"/>' +
      "</linearGradient></defs>" +
      '<circle cx="32" cy="32" r="31" fill="url(#' + uid + 'g)"/>' +
      '<g clip-path="url(#' + uid + 'd)">' +
      '<path d="' + COAT + '" fill="' + f.coat + '"/>' +
      (v.trim ? v.trim(f) : "") +
      '<g fill="' + f.shade + '">' + NECK + "</g>" +
      '<g fill="' + f.skin + '">' + EAR_L + EAR_R + HEAD + "</g>" +
      v.body(f, uid) +
      (v.over ? v.over(f) : "") +
      "</g>" +
      '<circle cx="32" cy="32" r="30.4" fill="none" stroke="' + tint +
      '" stroke-opacity=".38" stroke-width="1.2"/>' +
      "</svg>";
  };

  window.OPTIONS = OPTIONS;
})();
