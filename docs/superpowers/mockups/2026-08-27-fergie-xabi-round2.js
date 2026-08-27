/* Round two — Sir Fergie and Xabi.
   =========================================================================
   Round one shared ONE head ellipse across all five, and that is why the
   likenesses came out generic: five men with different hair. Here each of
   the two gets his own skull.

   Fergie is jowly — narrow at the temples, heavy and wide at the jaw, broad
   chin. Xabi is the opposite: long, narrow, angular, chin coming to a point.
   Everything else follows from that. Both also get the things that were
   missing and that age and place a face more than any single feature:
   nasolabial folds, a brow shadow so the eyes sit deep rather than painted
   on, and a nose with actual nostrils instead of a coloured ball.

   Exploratory. Whichever wins gets lifted into site/faces.js, which will
   need `head` and `ears` to become per-face there too. */
(function () {
  "use strict";

  const TINT = { CHE: "#1E5AA8", MUN: "#C8321F" };
  const COAT = "M10.5 64 C12.6 56 19.4 51.8 25.6 50.6 L32 55.6 L38.4 50.6 " +
    "C44.6 51.8 51.4 56 53.5 64 Z";
  const COLLAR = "M25.6 50.6 L32 55.6 L38.4 50.6 L36.2 49.5 L32 53 L27.8 49.5 Z";

  /* ---- the two skulls ---- */
  // Heavy at the bottom: the jaw is wider than the temples, which is the
  // single thing that makes a face read as sixty rather than thirty.
  const HEAD_F =
    "M17.2 26 C17.2 14.8 23.6 8.6 32 8.6 C40.4 8.6 46.8 14.8 46.8 26 " +
    "C46.8 30 48.4 34.8 47.4 38.8 C46.2 43.6 40.4 47 32 47 " +
    "C23.6 47 17.8 43.6 16.6 38.8 C15.6 34.8 17.2 30 17.2 26 Z";
  // Long and narrow, and the chin comes to a point rather than a curve.
  const HEAD_X =
    "M18.8 25.4 C18.8 14 24.6 7.2 32 7.2 C39.4 7.2 45.2 14 45.2 25.4 " +
    "C45.2 32.6 43.4 39.2 40.2 43.4 C37.6 46.8 34.4 48.2 32 48.2 " +
    "C29.6 48.2 26.4 46.8 23.8 43.4 C20.6 39.2 18.8 32.6 18.8 25.4 Z";

  const EARS = (x1, x2, y) =>
    '<ellipse cx="' + x1 + '" cy="' + y + '" rx="2.7" ry="3.9"/>' +
    '<ellipse cx="' + x2 + '" cy="' + y + '" rx="2.7" ry="3.9"/>';

  const EL = 25.8, ER = 38.2;

  /* ---- parts ---- */
  // The eye plus the shadow above it. Without the shadow an eye is a sticker.
  const deepEye = (x, y, r, f) =>
    '<ellipse cx="' + x + '" cy="' + y + '" rx="' + r + '" ry="' + (r + 0.3) +
    '" fill="#241F1A"/>' +
    '<path d="M' + (x - r - 1.4) + " " + (y - r - 0.6) + " q" + (r + 1.4) + " -1.8 " +
    ((r + 1.4) * 2) + ' 0" stroke="' + f.shade + '" stroke-width="1.1" fill="none" ' +
    'stroke-linecap="round" opacity=".55"/>';
  const shutEye = (x, y) =>
    '<path d="M' + (x - 3.2) + " " + y + ' q3.2 -3.2 6.4 0" stroke="#241F1A" ' +
    'stroke-width="2" fill="none" stroke-linecap="round"/>';
  const lid = (x, y, f) =>
    '<path d="M' + (x - 3.1) + " " + y + " q3.1 -2.4 6.2 0 v-2.8 h-6.2 Z\" fill=\"" +
    f.skin + '"/>';
  const browLine = (x1, y1, x2, y2, c, w) =>
    '<path d="M' + x1 + " " + y1 + " L" + x2 + " " + y2 + '" stroke="' + c +
    '" stroke-width="' + w + '" stroke-linecap="round"/>';
  const browArc = (x, y, c, w, lift) =>
    '<path d="M' + x + " " + y + " q4 " + lift + " 8 0\" stroke=\"" + c +
    '" stroke-width="' + w + '" fill="none" stroke-linecap="round"/>';
  // The two creases from the nose to the mouth corners. Nothing else does as
  // much work per line.
  const folds = (f, x, y, drop, spread) =>
    '<g stroke="' + f.shade + '" stroke-width="1.3" fill="none" opacity=".42" ' +
    'stroke-linecap="round">' +
    '<path d="M' + (32 - x) + " " + y + " q" + -spread + " " + drop + " " +
    (-spread * 0.35) + " " + (drop + 2.4) + '"/>' +
    '<path d="M' + (32 + x) + " " + y + " q" + spread + " " + drop + " " +
    (spread * 0.35) + " " + (drop + 2.4) + '"/></g>';
  // A nose with a bridge, a bulb and two nostrils, rather than a red sphere.
  const bigNose = (f, cy, w, red) =>
    // the bridge
    '<path d="M32 26.4 L' + (32 - w * 0.3) + " " + (cy - 1.6) + '" stroke="' + f.shade +
    '" stroke-width="1.5" fill="none" stroke-linecap="round" opacity=".75"/>' +
    // the bulb, outlined so it has an edge at any size
    '<path d="M' + (32 - w) + " " + (cy - 1.4) + " q-1.2 " + (w * 1.1) + " " + w +
    " " + (w * 1.15) + " q" + w + " 0.6 " + w + " -" + (w * 1.15) + '" fill="' + f.skin +
    '" stroke="' + f.shade + '" stroke-width="1.2" stroke-linejoin="round" opacity="1"/>' +
    '<path d="M' + (32 - w) + " " + (cy - 1.4) + " q-1.2 " + (w * 1.1) + " " + w + " " +
    (w * 1.15) + " q" + w + " 0.6 " + w + " -" + (w * 1.15) + '" fill="#B8402B" ' +
    'opacity="' + (red === undefined ? 0.42 : red) + '"/>' +
    '<g fill="' + f.shade + '" opacity=".7">' +
    '<ellipse cx="' + (32 - w * 0.52) + '" cy="' + (cy + w * 0.72) + '" rx="1.2" ry="0.85"/>' +
    '<ellipse cx="' + (32 + w * 0.52) + '" cy="' + (cy + w * 0.72) + '" rx="1.2" ry="0.85"/></g>';
  // Two short curves where a heavy jaw folds. Cheap, and it adds twenty years.
  const jowls = (f) =>
    '<g stroke="' + f.shade + '" stroke-width="1.2" fill="none" opacity=".38" ' +
    'stroke-linecap="round">' +
    '<path d="M20.4 37.6 q1.4 5 4.6 7.2"/><path d="M43.6 37.6 q-1.4 5 -4.6 7.2"/></g>';
  const slimNose = (f, top, len) =>
    '<path d="M32.2 ' + top + " L30.8 " + (top + len) + ' q2.2 1.3 4 0.1" stroke="' +
    f.shade + '" stroke-width="1.7" fill="none" stroke-linecap="round" ' +
    'stroke-linejoin="round"/>';
  const shout = (cy, rx, ry) =>
    '<ellipse cx="32" cy="' + cy + '" rx="' + rx + '" ry="' + ry + '" fill="#6E2A20"/>' +
    '<path d="M' + (32 - rx * 0.82) + " " + (cy - ry * 0.45) + " q" + (rx * 0.82) +
    " -2.6 " + (rx * 1.64) + " 0 q-" + (rx * 0.82) + " 2 -" + (rx * 1.64) +
    ' 0 Z" fill="#FFFFFF"/>' +
    '<ellipse cx="32" cy="' + (cy + ry * 0.5) + '" rx="' + (rx * 0.5) +
    '" ry="' + (ry * 0.28) + '" fill="#C1584A"/>';

  /* ---- Fergie: hair with volume, temples out, and the blotching ---- */
  const HAIR_F = (f) =>
    '<path d="M15.4 31.4 C14.4 20.6 18.4 10.6 25.8 8.4 C28.6 7.6 35.4 7.6 38.2 8.4 ' +
    "C45.6 10.6 49.6 20.6 48.6 31.4 C48 32.6 46.2 32.6 45.6 31.4 " +
    "C45.2 25 44 21.2 42 19.4 C39 16.8 36 17.4 32 17.4 C28 17.4 25 16.8 22 19.4 " +
    "C20 21.2 18.8 25 18.4 31.4 C17.8 32.6 16 32.6 15.4 31.4 Z\" fill=\"" +
    f.hair + '"/>' +
    // the tufts over the ears, which is where the volume actually is
    '<path d="M15.8 27.4 q3.4 1.6 3.2 8.2 q-3 0.8 -4.2 -1.6 Z" fill="' + f.hair + '"/>' +
    '<path d="M48.2 27.4 q-3.4 1.6 -3.2 8.2 q3 0.8 4.2 -1.6 Z" fill="' + f.hair + '"/>';
  // Blotching, not a flush: three soft patches, because an evenly red face
  // reads as sunburn and a red ball reads as a clown.
  const BLOTCH = (uid, o) =>
    '<g fill="#B8402B" clip-path="url(#' + uid + 'h)">' +
    // one warm wash over the whole face, then two soft patches wide enough not
    // to read as two circles of rouge
    '<rect x="14" y="8" width="36" height="40" opacity="' + (o * 0.5) + '"/>' +
    '<ellipse cx="21.4" cy="36.4" rx="7.4" ry="4.6" opacity="' + (o * 0.42) + '"/>' +
    '<ellipse cx="42.6" cy="36.4" rx="7.4" ry="4.6" opacity="' + (o * 0.42) + '"/></g>';

  /* ---- Xabi: hair back off the face, beard with a clean edge ---- */
  const HAIR_X = (f, back) =>
    (back || "") +
    '<path d="M18.8 24.6 C18.8 12.6 24.6 7 32 7 C39.4 7 45.2 12.6 45.2 24.6 ' +
    "C44.4 19.4 43.2 16.8 41.4 15.6 C37.8 17.6 26.2 17.6 22.6 15.6 " +
    "C20.8 16.8 19.6 19.4 18.8 24.6 Z\" fill=\"" + f.hair + '"/>';
  const BEARD_X = (f) =>
    '<path d="M19.4 28.6 C19.6 33.8 20.6 39.6 23.2 43.6 C26 47.4 29.4 48.6 32 48.6 ' +
    "C34.6 48.6 38 47.4 40.8 43.6 C43.4 39.6 44.4 33.8 44.6 28.6 " +
    "C43.2 33.2 40.2 35 36.6 35.4 C34.2 35.7 29.8 35.7 27.4 35.4 " +
    "C23.8 35 20.8 33.2 19.4 28.6 Z\" fill=\"" + f.hair + '"/>';
  const TASH_X = (f) =>
    '<path d="M26.6 37 q5.4 -2 10.8 0 q-2.7 2.8 -5.4 2.8 q-2.7 0 -5.4 -2.8 Z" ' +
    'fill="' + f.hair + '"/>';

  const TIE = (f) => '<path d="' + COLLAR + '" fill="#E8E6E0"/>' +
    '<path d="M32 55.6 L29.8 58 L32 64 L34.2 58 Z" fill="' + f.collar + '"/>';
  const VEE = (f) => '<path d="' + COLLAR + '" fill="' + f.collar + '"/>';

  /* ======================= the options ======================= */
  const R2 = {
    "Sir Fergie": { head: HEAD_F, ears: EARS(16.6, 47.4, 30), opts: [
      { id: "F1", label: "The chew, redrawn",
        note: "Same idea as the live one, on a jowly skull: heavy jaw, folds, a real nose, and blotching instead of a red ball.",
        trim: TIE,
        body: (f, uid) => HAIR_F(f) + BLOTCH(uid, 0.36) +
          browLine(20.6, 22.4, 29.4, 25.2, "#C6C0B6", 2.5) +
          browLine(43.4, 22.4, 34.6, 25.2, "#C6C0B6", 2.5) +
          deepEye(EL, 28, 1.9, f) + deepEye(ER, 28, 1.9, f) +
          bigNose(f, 34.6, 3.6) + jowls(f) + folds(f, 4.6, 35.4, 5.4, 2.2) +
          // chewing: off-centre, one corner open
          '<path d="M25.4 41.6 C28.4 40.4 36 40.8 38.8 42.6 C36 45.6 27.8 45.2 25.4 41.6 Z" ' +
          'fill="#6E3226"/>' +
          '<path d="M27 41.8 C29.6 41.2 34.8 41.4 37 42.4 Z" fill="#FFF" opacity=".85"/>' +
          '<path d="M26.6 46.4 q5.4 1.6 10.8 -0.4" stroke="' + f.shade +
          '" stroke-width="1" fill="none" opacity=".35"/>' },
      { id: "F2", label: "Hairdryer, redrawn",
        note: "The shout, with the jaw dropped into the jowls and the blotching gone dark. Brows over the eyes, not above them.",
        trim: TIE,
        body: (f, uid) => HAIR_F(f) + BLOTCH(uid, 0.58) +
          browLine(19.8, 21.6, 30, 26.4, "#C6C0B6", 2.8) +
          browLine(44.2, 21.6, 34, 26.4, "#C6C0B6", 2.8) +
          deepEye(EL, 28.4, 1.7, f) + deepEye(ER, 28.4, 1.7, f) +
          bigNose(f, 34, 3.4, 0.6) + jowls(f) + folds(f, 5, 34.8, 6.2, 2.6) +
          shout(42.4, 6.4, 5.2) +
          '<g stroke="#B8402B" stroke-width="1.2" fill="none" opacity=".55">' +
          '<path d="M18.6 25.6 q2.4 1.6 1.6 4.4"/>' +
          '<path d="M45.4 25.6 q-2.4 1.6 -1.6 4.4"/></g>' },
      { id: "F3", label: "The gum, redrawn",
        note: "Half-lidded, jaw working, one cheek loaded. The quiet version, and the one that ages best on a page you see every week.",
        trim: TIE,
        body: (f, uid) => HAIR_F(f) + BLOTCH(uid, 0.24) +
          browArc(20.8, 24.6, "#C6C0B6", 2.3, -1.4) +
          browArc(35.2, 24.6, "#C6C0B6", 2.3, -1.4) +
          deepEye(EL, 28.2, 1.9, f) + deepEye(ER, 28.2, 1.9, f) +
          lid(EL, 27.6, f) + lid(ER, 27.6, f) +
          bigNose(f, 34.6, 3.5) + jowls(f) + folds(f, 4.6, 35.4, 5, 2.2) +
          // the gum, parked and visible
          '<ellipse cx="41.6" cy="38.6" rx="3.8" ry="3.4" fill="' + f.skin + '"/>' +
          '<path d="M38.6 40.8 q2.8 1.6 5.4 -0.8" stroke="' + f.shade +
          '" stroke-width="1" fill="none" opacity=".45"/>' +
          '<path d="M25.8 42 q5.2 2.4 10.6 -2.2" stroke="#7A4436" stroke-width="1.9" ' +
          'fill="none" stroke-linecap="round"/>' },
      { id: "F4", label: "Fergie time",
        note: "The wrist up, the watch turned round, and the face saying nothing at all. Weakest of the four at owner-dot size.",
        trim: TIE,
        body: (f, uid) => HAIR_F(f) + BLOTCH(uid, 0.3) +
          browArc(20.8, 23.8, "#C6C0B6", 2.3, -1.2) +
          browArc(35.2, 21.6, "#C6C0B6", 2.3, -3.2) +
          '<path d="M22.6 28.2 h6.4" stroke="#241F1A" stroke-width="2.4" ' +
          'stroke-linecap="round"/>' +
          '<path d="M35 28.2 h6.4" stroke="#241F1A" stroke-width="2.4" ' +
          'stroke-linecap="round"/>' +
          bigNose(f, 34.6, 3.5) + jowls(f) + folds(f, 4.6, 35.4, 5, 2.2) +
          '<path d="M27.4 42.4 h9.2" stroke="#7A4436" stroke-width="1.9" ' +
          'stroke-linecap="round"/>',
        over: (f) =>
          '<path d="M50 64 L62 64 L54.6 40.4 L43.4 44.6 Z" fill="' + f.coat + '"/>' +
          '<path d="M43.4 44.6 L54.6 40.4 L56.4 46.2 L45.2 50.4 Z" fill="#E8E6E0"/>' +
          '<path d="M45.2 50.4 L56.4 46.2 L57.6 50 L46.4 54.2 Z" fill="#20242A"/>' +
          '<circle cx="51.6" cy="52" r="4.6" fill="#20242A"/>' +
          '<circle cx="51.6" cy="52" r="3.2" fill="#E8E6E0"/>' +
          '<path d="M51.6 52 V49.6 M51.6 52 h2" stroke="#20242A" stroke-width="0.8" ' +
          'stroke-linecap="round"/>' +
          '<ellipse cx="47.6" cy="41.6" rx="6.2" ry="5.2" fill="' + f.skin + '" ' +
          'transform="rotate(-20 47.6 41.6)"/>' },
    ] },

    "Xabi": { head: HEAD_X, ears: EARS(18.2, 45.8, 29), opts: [
      { id: "X1", label: "The Basque",
        note: "The honest one, properly drawn: long narrow skull, pointed chin, straight nose, beard with an edge rather than a blob.",
        trim: VEE,
        body: (f, uid) => HAIR_X(f) + BEARD_X(f) +
          browLine(21.4, 23.4, 29.6, 22.4, "#120C06", 2.2) +
          browLine(42.6, 23.4, 34.4, 22.4, "#120C06", 2.2) +
          deepEye(EL, 27, 2.1, f) + deepEye(ER, 27, 2.1, f) +
          slimNose(f, 26.6, 8.4) +
          TASH_X(f) +
          '<path d="M28.8 41.6 h6.4" stroke="#7A4A38" stroke-width="1.5" ' +
          'stroke-linecap="round" opacity=".7"/>' },
      { id: "X2", label: "The gaffer",
        note: "Bayer Leverkusen Xabi: hair slicked back off a high forehead, beard cut to a strap, black overcoat, and the faintest idea he has already won.",
        trim: () => '<path d="M25.6 50.6 L32 55.6 L27.6 64 L20.6 64 Z" fill="#1B1F25"/>' +
          '<path d="M38.4 50.6 L32 55.6 L36.4 64 L43.4 64 Z" fill="#1B1F25"/>' +
          '<path d="M29.4 52.6 h5.2 v11.4 h-5.2 Z" fill="#E8E6E0"/>' +
          '<path d="M32 55.6 L30.2 57.6 L32 64 L33.8 57.6 Z" fill="#0B2A52"/>',
        body: (f, uid) =>
          // slicked back: the hairline sits higher and the mass runs backwards
          '<path d="M19.4 24 C19.4 12.4 25 6.8 32 6.8 C39 6.8 44.6 12.4 44.6 24 ' +
          "C44 18.4 42.8 15.4 40.8 14 C37.2 16.6 26.8 16.6 23.2 14 " +
          "C21.2 15.4 20 18.4 19.4 24 Z\" fill=\"" + f.hair + '"/>' +
          '<g stroke="#000" stroke-opacity=".22" stroke-width="0.9" fill="none">' +
          '<path d="M23.4 15.4 q8.6 -4.6 17.2 0"/><path d="M22.4 19 q9.6 -4.6 19.2 0"/></g>' +
          // a strap, not a thicket
          '<path d="M21 30 C21.4 34.6 22.4 39.6 24.8 43.2 C27.4 46.8 29.8 48 32 48 ' +
          "C34.2 48 36.6 46.8 39.2 43.2 C41.6 39.6 42.6 34.6 43 30 " +
          "C42 33.6 39.6 35 36.4 35.4 C34.4 35.7 29.6 35.7 27.6 35.4 " +
          "C24.4 35 22 33.6 21 30 Z\" fill=\"" + f.hair + '" opacity=".94"/>' +
          browLine(21.6, 23, 29.6, 22.2, "#120C06", 2.1) +
          browArc(34.4, 21, "#120C06", 2.1, -2.4) +
          deepEye(EL, 26.6, 2.1, f) + deepEye(ER, 26.6, 2.1, f) +
          slimNose(f, 26.2, 8) +
          '<path d="M27 37.4 q5 -1.8 10 0 q-2.5 2.6 -5 2.6 q-2.5 0 -5 -2.6 Z" ' +
          'fill="' + f.hair + '"/>' +
          '<path d="M28.6 41.6 q3.4 2 6.8 -1.4" stroke="#7A4A38" stroke-width="1.5" ' +
          'fill="none" stroke-linecap="round"/>' },
      { id: "X3", label: "Tied back",
        note: "The playing years: hair pulled back off the face into a knot, so the silhouette is his before the features are.",
        trim: VEE,
        body: (f, uid) => HAIR_X(f,
          // the knot, drawn behind the head so it breaks the outline
          '<circle cx="47.4" cy="20.4" r="5.4" fill="' + f.hair + '"/>' +
          '<path d="M40 14 q6 1.6 7 6.4 q-4 1.4 -8 -1.6 Z" fill="' + f.hair + '"/>') +
          '<g stroke="#000" stroke-opacity=".2" stroke-width="0.9" fill="none">' +
          '<path d="M22.6 15.8 q9.4 -4.8 18.8 0"/><path d="M21.4 19.6 q10.6 -4.6 21.2 0"/>' +
          "</g>" +
          BEARD_X(f) +
          browLine(21.4, 23.2, 29.6, 22.2, "#120C06", 2.2) +
          browLine(42.6, 23.2, 34.4, 22.2, "#120C06", 2.2) +
          deepEye(EL, 26.8, 2.1, f) + deepEye(ER, 26.8, 2.1, f) +
          slimNose(f, 26.4, 8.4) + TASH_X(f) +
          '<path d="M28.8 41.6 h6.4" stroke="#7A4A38" stroke-width="1.5" ' +
          'stroke-linecap="round" opacity=".7"/>' },
      { id: "X4", label: "Weighing it up",
        note: "Brow down, eyes off to the side, jaw set. The face of a man deciding whether to make the change now or at seventy minutes.",
        trim: VEE,
        body: (f, uid) => HAIR_X(f) + BEARD_X(f) +
          browLine(21.6, 22.2, 29.8, 24.2, "#120C06", 2.3) +
          browLine(42.4, 22.2, 34.2, 24.2, "#120C06", 2.3) +
          deepEye(EL + 2.4, 27.2, 2.1, f) + deepEye(ER + 2.2, 27.2, 2.1, f) +
          slimNose(f, 26.6, 8.4) + TASH_X(f) +
          '<path d="M28.4 41.8 q3.4 -1.4 6.8 -0.2" stroke="#7A4A38" stroke-width="1.5" ' +
          'fill="none" stroke-linecap="round" opacity=".8"/>' },
    ] },
  };

  /* ---- the frame, with the head now a parameter ---- */
  let seq = 0;
  window.r2SVG = function (nick, v) {
    const f = FA.faceOf(nick);
    const set = R2[nick];
    const uid = "r2" + (++seq);
    const tint = TINT[f.club] || "#6B7280";
    const head = '<path d="' + set.head + '"/>';
    return '<svg class="face" viewBox="0 0 64 64" role="img" aria-label="' + nick +
      " option " + v.id + '">' +
      "<defs>" +
      '<clipPath id="' + uid + 'd"><circle cx="32" cy="32" r="31"/></clipPath>' +
      '<clipPath id="' + uid + 'h">' + head + "</clipPath>" +
      '<linearGradient id="' + uid + 'g" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="' + tint + '" stop-opacity=".26"/>' +
      '<stop offset="1" stop-color="' + tint + '" stop-opacity=".08"/>' +
      "</linearGradient></defs>" +
      '<circle cx="32" cy="32" r="31" fill="url(#' + uid + 'g)"/>' +
      '<g clip-path="url(#' + uid + 'd)">' +
      '<path d="' + COAT + '" fill="' + f.coat + '"/>' +
      (v.trim ? v.trim(f) : "") +
      '<path d="M28.6 41 h6.8 v12 h-6.8 Z" fill="' + f.shade + '"/>' +
      '<g fill="' + f.skin + '">' + set.ears + head + "</g>" +
      v.body(f, uid) +
      (v.over ? v.over(f) : "") +
      "</g>" +
      '<circle cx="32" cy="32" r="30.4" fill="none" stroke="' + tint +
      '" stroke-opacity=".38" stroke-width="1.2"/>' +
      "</svg>";
  };
  window.R2 = R2;
})();
