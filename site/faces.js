/* the five, drawn — caricatures of the managers and players we borrowed our
   names from.
   =========================================================================
   Inline SVG, no external images, same rule as the kits in common.js: one
   frame, five sets of parameters, tinted per club.

   These are CARICATURES, not portraits, and the proportions are deliberately
   wrong: the head takes well over half the frame, the shoulders are a
   suggestion, and each face gets one feature blown out of all proportion —
   Fergie's nose and the rage behind it, the Professeur's zip pulled up over
   his mouth, the Special One's eyebrow halfway to his hairline, CR7 caught
   mid-celebration with a wink, and a beard on Xabi that has reached the
   badge. A likeness that is merely accurate reads as a stock avatar; the
   exaggeration is what makes it one of us.

   Every face is drawn in a 64x64 box on the same skeleton (backdrop, coat,
   neck, head, ears, hair, eyes, nose, mouth) so they read as one set. Only
   the tells differ.

   Real names never appear here, in markup or in a title attribute: these are
   caricatures of the FOOTBALL people the five are named after, which is a
   different thing from the five themselves.
   ========================================================================= */
(function () {
  "use strict";
  const esc = FA.esc;

  /* Club tints for the backdrop disc. Kept a shade off the kit colours in
     common.js so a face never fights the kit drawn next to it. */
  const TINT = { CHE: "#1E5AA8", MUN: "#C8321F", ARS: "#D8232A" };

  /* A face may bring its own skull. Sharing one ellipse across all five was
     the reason the first set read as five men in different wigs: the shape of
     the head carries more likeness than any feature sitting on it. Fergie is
     the one that needed it — narrow at the temples, heavy through the jaw,
     broad chin. The other four are fine on the default. */
  const HEAD_JOWLY = '<path d="M17.2 26 C17.2 14.8 23.6 8.6 32 8.6 ' +
    "C40.4 8.6 46.8 14.8 46.8 26 C46.8 30 48.4 34.8 47.4 38.8 " +
    "C46.2 43.6 40.4 47 32 47 C23.6 47 17.8 43.6 16.6 38.8 " +
    'C15.6 34.8 17.2 30 17.2 26 Z"/>';
  const EARS_JOWLY = '<ellipse cx="16.6" cy="30" rx="2.7" ry="3.9"/>' +
    '<ellipse cx="47.4" cy="30" rx="2.7" ry="3.9"/>';

  const FACES = {
    "Xabi": {
      clubName: "Chelsea", club: "CHE", skin: "#CF9468", shade: "#B07749",
      hair: "#1C150E", coat: "#0B3F86", collar: "#FFFFFF", style: "xabi",
    },
    "Sir Fergie": {
      clubName: "Man Utd", club: "MUN", skin: "#E9A184", shade: "#C87F60",
      hair: "#DEDBD4", coat: "#2A2E35", collar: "#B01C10", style: "fergie",
      head: HEAD_JOWLY, ears: EARS_JOWLY,
    },
    "Mr CR7": {
      clubName: "Man Utd", club: "MUN", skin: "#C08652", shade: "#9E6A3A",
      hair: "#171008", coat: "#C8321F", collar: "#FFFFFF", style: "cr7",
    },
    "The Special One": {
      clubName: "Chelsea", club: "CHE", skin: "#D3A17A", shade: "#B0805A",
      hair: "#9BA1A8", coat: "#171A21", collar: "#3E4650", style: "mourinho",
    },
    "Le Professeur": {
      clubName: "Arsenal", club: "ARS", skin: "#DDB194", shade: "#BC8E70",
      hair: "#A29C93", coat: "#17253F", collar: "#D8232A", style: "wenger",
    },
  };

  /* ---- the shared skeleton ---------------------------------------------
     The head is 32 units across in a 64 box — half the frame wide and more
     than half of it tall — and the shoulders are cut down to match. That
     ratio is the whole trick. Coordinates are fixed on purpose: sliding an
     eye 2px per face is how a set stops looking like a set. */
  const HEAD = '<ellipse cx="32" cy="27" rx="16" ry="18" />';
  const EAR_L = '<ellipse cx="15.8" cy="29.5" rx="2.8" ry="4" />';
  const EAR_R = '<ellipse cx="48.2" cy="29.5" rx="2.8" ry="4" />';

  const NECK = '<path d="M28.6 41 h6.8 v12 h-6.8 Z" />';
  const COAT = "M10.5 64 C12.6 56 19.4 51.8 25.6 50.6 L32 55.6 L38.4 50.6 " +
    "C44.6 51.8 51.4 56 53.5 64 Z";
  const COLLAR = "M25.6 50.6 L32 55.6 L38.4 50.6 L36.2 49.5 L32 53 L27.8 49.5 Z";

  const EYE_L = 25.6, EYE_R = 38.4, EYE_Y = 27;
  function eyes(o) {
    const c = (o && o.color) || "#241F1A";
    const r = (o && o.r) || 2.2;
    const shut = (x) =>
      '<path d="M' + (x - 3) + " " + EYE_Y + ' q3 -3 6 0" stroke="' + c +
      '" stroke-width="2" fill="none" stroke-linecap="round"/>';
    const open = (x) =>
      '<ellipse cx="' + x + '" cy="' + EYE_Y + '" rx="' + r + '" ry="' + (r + 0.3) +
      '" fill="' + c + '"/>';
    return ((o && o.wink) === "left" ? shut(EYE_L) : open(EYE_L)) +
      ((o && o.wink) === "right" ? shut(EYE_R) : open(EYE_R));
  }

  /* An eye with the crease above it. A bare dot reads as a sticker; the
     crease is what makes it sit in a socket. */
  const deepEye = (x, y, r, f) =>
    '<ellipse cx="' + x + '" cy="' + y + '" rx="' + r + '" ry="' + (r + 0.3) +
    '" fill="#241F1A"/>' +
    '<path d="M' + (x - r - 1.4) + " " + (y - r - 0.6) + " q" + (r + 1.4) + " -1.8 " +
    ((r + 1.4) * 2) + ' 0" stroke="' + f.shade + '" stroke-width="1.1" fill="none" ' +
    'stroke-linecap="round" opacity=".55"/>';

  /* The two creases from the nose to the mouth corners, and the two where a
     heavy jaw folds. Four short lines, and they do more ageing than anything
     else available at this size. */
  const folds = (f) =>
    '<g stroke="' + f.shade + '" stroke-width="1.3" fill="none" opacity=".42" ' +
    'stroke-linecap="round">' +
    '<path d="M27.4 35.4 q-2.2 5.4 -0.8 7.8"/>' +
    '<path d="M36.6 35.4 q2.2 5.4 0.8 7.8"/></g>';
  const jowls = (f) =>
    '<g stroke="' + f.shade + '" stroke-width="1.2" fill="none" opacity=".38" ' +
    'stroke-linecap="round">' +
    '<path d="M20.4 37.6 q1.4 5 4.6 7.2"/><path d="M43.6 37.6 q-1.4 5 -4.6 7.2"/></g>';

  /* A nose has to read as a nose before it reads as a red one. Bridge, an
     outlined bulb, a red wash over it, two nostrils — in that order. The
     first version was a red sphere, which reads as a clown, not a manager. */
  const bigNose = (f, cy, w, red) =>
    '<path d="M32 26.4 L' + (32 - w * 0.3) + " " + (cy - 1.6) + '" stroke="' + f.shade +
    '" stroke-width="1.5" fill="none" stroke-linecap="round" opacity=".75"/>' +
    '<path d="M' + (32 - w) + " " + (cy - 1.4) + " q-1.2 " + (w * 1.1) + " " + w + " " +
    (w * 1.15) + " q" + w + " 0.6 " + w + " -" + (w * 1.15) + '" fill="' + f.skin +
    '" stroke="' + f.shade + '" stroke-width="1.2" stroke-linejoin="round"/>' +
    '<path d="M' + (32 - w) + " " + (cy - 1.4) + " q-1.2 " + (w * 1.1) + " " + w + " " +
    (w * 1.15) + " q" + w + " 0.6 " + w + " -" + (w * 1.15) + '" fill="#B8402B" ' +
    'opacity="' + (red === undefined ? 0.42 : red) + '"/>' +
    '<g fill="' + f.shade + '" opacity=".7">' +
    '<ellipse cx="' + (32 - w * 0.52) + '" cy="' + (cy + w * 0.72) + '" rx="1.2" ry="0.85"/>' +
    '<ellipse cx="' + (32 + w * 0.52) + '" cy="' + (cy + w * 0.72) + '" rx="1.2" ry="0.85"/></g>';

  /* Blotching, not rouge and not sunburn: one warm wash over the whole face,
     then two patches wide enough that they do not read as two red circles. */
  const blotch = (uid, o) =>
    '<g fill="#B8402B" clip-path="url(#' + uid + 'h)">' +
    '<rect x="14" y="8" width="36" height="40" opacity="' + (o * 0.5) + '"/>' +
    '<ellipse cx="21.4" cy="36.4" rx="7.4" ry="4.6" opacity="' + (o * 0.42) + '"/>' +
    '<ellipse cx="42.6" cy="36.4" rx="7.4" ry="4.6" opacity="' + (o * 0.42) + '"/></g>';

  /* Each style returns the layers that sit ABOVE the bare head: hair first,
     then brows, eyes, nose, mouth, then the tell. */
  const STYLE = {
    /* Jowls, folds, and a jaw locked mid-chew. The likeness is in the skull
       before it is in the nose: narrow at the temples, heavy at the jaw. */
    fergie: (f, uid) =>
      blotch(uid, 0.36) +
      // silver, gone at the crown, with the volume where it really sits —
      // in two tufts over the ears
      '<path d="M15.4 31.4 C14.4 20.6 18.4 10.6 25.8 8.4 C28.6 7.6 35.4 7.6 38.2 8.4 ' +
      "C45.6 10.6 49.6 20.6 48.6 31.4 C48 32.6 46.2 32.6 45.6 31.4 " +
      "C45.2 25 44 21.2 42 19.4 C39 16.8 36 17.4 32 17.4 C28 17.4 25 16.8 22 19.4 " +
      "C20 21.2 18.8 25 18.4 31.4 C17.8 32.6 16 32.6 15.4 31.4 Z\" fill=\"" +
      f.hair + '"/>' +
      '<path d="M15.8 27.4 q3.4 1.6 3.2 8.2 q-3 0.8 -4.2 -1.6 Z" fill="' + f.hair + '"/>' +
      '<path d="M48.2 27.4 q-3.4 1.6 -3.2 8.2 q3 0.8 4.2 -1.6 Z" fill="' + f.hair + '"/>' +
      '<path d="M20.6 22.4 L29.4 25.2" stroke="#C6C0B6" stroke-width="2.5" ' +
      'stroke-linecap="round"/>' +
      '<path d="M43.4 22.4 L34.6 25.2" stroke="#C6C0B6" stroke-width="2.5" ' +
      'stroke-linecap="round"/>' +
      deepEye(25.8, 28, 1.9, f) + deepEye(38.2, 28, 1.9, f) +
      bigNose(f, 34.6, 3.6) + jowls(f) + folds(f) +
      // mid-chew: off-centre, one corner open, and it has always been so
      '<path d="M25.4 41.6 C28.4 40.4 36 40.8 38.8 42.6 C36 45.6 27.8 45.2 25.4 41.6 Z" ' +
      'fill="#6E3226"/>' +
      '<path d="M27 41.8 C29.6 41.2 34.8 41.4 37 42.4 Z" fill="#FFFFFF" opacity=".85"/>' +
      '<path d="M26.6 46.4 q5.4 1.6 10.8 -0.4" stroke="' + f.shade + '" ' +
      'stroke-width="1" fill="none" opacity=".35"/>',

    /* The zip. It has come up over his mouth and he is going to argue
       through it anyway. */
    wenger: (f, uid) =>
      '<path d="M15 32.6 C14.2 21.8 19.4 8.6 32 8.6 C44.4 8.6 49.8 22.4 49 32.6 ' +
      "C48.4 24.6 47.2 19.6 44.8 17.6 C42.2 15.4 38.6 16.4 34.4 18 " +
      "C28.6 20.2 18.4 23.4 15 32.6 Z\" fill=\"" + f.hair + '"/>' +
      '<path d="M19.6 21.6 q4 -1.8 7 -0.2" stroke="#8E857C" stroke-width="1.9" ' +
      'stroke-linecap="round" fill="none"/>' +
      '<path d="M37.4 21.4 q3 -1.6 7 0.2" stroke="#8E857C" stroke-width="1.9" ' +
      'stroke-linecap="round" fill="none"/>' +
      eyes({ r: 2.1 }) +
      // the glasses, sized for a man who reads the fixture list at arm's length
      '<g fill="none" stroke="#3A3F45" stroke-width="1.5">' +
      '<rect x="18.4" y="22.6" width="12" height="9.4" rx="3" fill="#FFFFFF" ' +
      'fill-opacity=".18"/>' +
      '<rect x="33.6" y="22.6" width="12" height="9.4" rx="3" fill="#FFFFFF" ' +
      'fill-opacity=".18"/>' +
      '<path d="M30.4 26.4 h3.2"/><path d="M18.4 25.6 L14.4 27.6"/>' +
      '<path d="M45.6 25.6 L49.6 27.6"/></g>' +
      // the nose that arrives before the argument does
      '<path d="M32.4 32 L29.4 42.4 q2.8 1.8 5.4 0.2" stroke="' + f.shade + '" ' +
      'stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" fill="none"/>' +
      // THE TELL: the puffer collar, zipped clean over the mouth
      '<path d="M14 64 C14 51.6 21.6 45 32 45 C42.4 45 50 51.6 50 64 Z" ' +
      'fill="' + f.coat + '"/>' +
      '<g stroke="#FFFFFF" stroke-opacity=".12" stroke-width="1.3" fill="none">' +
      '<path d="M16 52 q16 -6 32 0"/><path d="M14.6 58 q17.4 -6 34.8 0"/></g>' +
      '<path d="M32 44.6 V64" stroke="' + f.collar + '" stroke-width="2.4"/>' +
      '<path d="M32 46.4 v4" stroke="#DFE1E4" stroke-width="1.4" stroke-linecap="round"/>' +
      '<circle cx="32" cy="46" r="2" fill="#DFE1E4"/>',

    /* One eyebrow has left for the hairline and is not coming back. */
    mourinho: (f, uid) =>
      '<path d="M15 27.4 C14.2 14.6 21.8 8 32 8 C42.2 8 49.8 14.6 49 27.4 ' +
      "C47.8 18.4 45 14.2 39.4 13 C36.8 15.6 34.2 17.4 32 18.6 " +
      "C29.8 17.4 27.2 15.6 24.6 13 C19 14.2 16.2 18.4 15 27.4 Z\" " +
      'fill="' + f.hair + '"/>' +
      // stubble, clipped to the head so it stops at the jaw
      '<ellipse cx="32" cy="43" rx="14.4" ry="9.6" fill="#4A4F55" opacity=".26" ' +
      'clip-path="url(#' + uid + 'h)"/>' +
      // the level one, for contrast
      '<path d="M20.6 23.4 q4.4 -1.6 8 0.2" stroke="#6C7075" stroke-width="1.9" ' +
      'stroke-linecap="round" fill="none"/>' +
      // and the one that goes up, though the hand is the headline now
      '<path d="M35.4 21.8 q4.6 -3 9 -0.4" stroke="#6C7075" stroke-width="2.1" ' +
      'stroke-linecap="round" fill="none"/>' +
      eyes({ r: 2.1 }) +
      '<path d="M32.2 30.4 L30.6 36.6 q2.2 1.4 4.2 0.2" stroke="' + f.shade + '" ' +
      'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>' +
      // the smirk: one end up, one end nowhere
      '<path d="M24.6 41.4 q5 2.6 10.6 -2.4" stroke="#7A4E3E" stroke-width="2" ' +
      'stroke-linecap="round" fill="none"/>',

    /* Mid-celebration, and winking at someone behind the camera. */
    cr7: (f, uid) =>
      // the bit that takes the longest in the morning
      '<path d="M19.4 15.6 C22.4 4.6 37.4 0.6 46 6.6 C47.6 7.6 47.4 8.8 45.4 8.6 ' +
      "C36.4 7.8 26 10.2 19.4 15.6 Z\" fill=\"" + f.hair + '"/>' +
      '<path d="M16.2 25 C16.2 12 23.6 6.4 32 6.4 C41 6.4 47.8 12.2 47.6 24.2 ' +
      "C46.4 19.4 44.8 16.6 42.2 15 C37.8 17.4 25.6 17.4 21.2 15 " +
      "C18.8 16.6 17.4 19.8 16.2 25 Z\" fill=\"" + f.hair + '"/>' +
      '<path d="M20.6 22.6 q4.6 -1.6 8.2 0.2" stroke="#2A2018" stroke-width="1.9" ' +
      'stroke-linecap="round" fill="none"/>' +
      '<path d="M35.4 22.8 q4 -1.8 8.2 0" stroke="#2A2018" stroke-width="1.9" ' +
      'stroke-linecap="round" fill="none"/>' +
      eyes({ r: 2.2, wink: "right" }) +
      '<path d="M32 30.4 L30.8 35.4 q2 1.2 3.8 0" stroke="' + f.shade + '" ' +
      'stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" fill="none"/>' +
      // siuuu
      '<ellipse cx="32" cy="38.8" rx="4.2" ry="4.8" fill="#7A3A2E"/>' +
      '<path d="M28 36.8 q4 -2.2 8 0 q-4 1.5 -8 0 Z" fill="#FFFFFF"/>' +
      '<ellipse cx="32" cy="42.2" rx="2.4" ry="1.2" fill="#C1584A"/>',

    /* The beard has reached the badge and shows no sign of stopping. */
    xabi: (f, uid) =>
      '<path d="M16 26 C16 13 22.6 7.4 32 7.4 C41.4 7.4 48 13 48 26 ' +
      "C46.4 19.6 44.8 17 42.4 15.8 C38 18 26 18 21.6 15.8 " +
      "C19.2 17 17.6 19.6 16 26 Z\" fill=\"" + f.hair + '"/>' +
      // the beard: down past the jaw and onto the shirt
      '<path d="M17 30.4 C17.2 35.8 18.4 42.2 21.6 47.4 C25 52.6 29.2 54.8 32 54.8 ' +
      "C34.8 54.8 39 52.6 42.4 47.4 C45.6 42.2 46.8 35.8 47 30.4 " +
      "C45.6 36 42.4 38.4 37.6 39 C34.2 39.4 29.8 39.4 26.4 39 " +
      "C21.6 38.4 18.4 36 17 30.4 Z\" fill=\"" + f.hair + '"/>' +
      '<path d="M20.4 22.6 q4.6 -1.8 8.2 0" stroke="#120C06" stroke-width="2" ' +
      'stroke-linecap="round" fill="none"/>' +
      '<path d="M35.4 22.6 q4.6 -1.8 8.2 0" stroke="#120C06" stroke-width="2" ' +
      'stroke-linecap="round" fill="none"/>' +
      eyes({ r: 2.2 }) +
      '<path d="M32 30.4 L30.8 35.6 q2 1.2 3.8 0" stroke="' + f.shade + '" ' +
      'stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" fill="none"/>' +
      // moustache over a level mouth — no verdict, ever
      '<path d="M25.6 38.8 q6.4 -2.2 12.8 0 q-3.2 3 -6.4 3 q-3.2 0 -6.4 -3 Z" ' +
      'fill="' + f.hair + '"/>' +
      '<path d="M28.6 43.4 h6.8" stroke="#7A4A38" stroke-width="1.6" ' +
      'stroke-linecap="round" opacity=".7"/>',
  };

  /* Coat trim, drawn after the coat so it sits on top of it. The Professeur
     has none: his coat is drawn with his face, because the zip is the joke. */
  const TRIM = {
    // a club-coloured tie under a dark suit
    fergie: (f) => '<path d="' + COLLAR + '" fill="#E8E6E0"/>' +
      '<path d="M32 55.6 L29.8 58 L32 64 L34.2 58 Z" fill="' + f.collar + '"/>',
    wenger: () => "",
    // overcoat lapels
    mourinho: (f) => '<path d="M25.6 50.6 L32 55.6 L27.6 64 L20.6 64 Z" fill="' +
      f.collar + '"/>' +
      '<path d="M38.4 50.6 L32 55.6 L36.4 64 L43.4 64 Z" fill="' + f.collar + '"/>',
    // kit collar and the chain
    cr7: (f) => '<path d="' + COLLAR + '" fill="' + f.collar + '"/>' +
      '<path d="M27.6 54.6 q4.4 5.2 8.8 0" stroke="#E8B84B" stroke-width="1.6" ' +
      'fill="none" stroke-linecap="round"/>',
    // plain white collar, nothing to prove
    xabi: (f) => '<path d="' + COLLAR + '" fill="' + f.collar + '"/>',
  };

  /* Props, drawn last. Only one face has one: three fingers, held up,
     unhurried, at somebody else's crowd. The forearm has to be drawn before
     the hand or the hand reads as a thumbprint stuck to the shoulder. */
  const PROP = {
    mourinho: (f) =>
      '<path d="M44 64 L55 64 L53 48 L43 50 Z" fill="' + f.coat + '"/>' +
      '<path d="M43 50 L53 48 L53.6 52 L43.6 54 Z" fill="#FFFFFF" fill-opacity=".16"/>' +
      '<path d="M45.4 52 q6 -1 8.4 0.6 v6 q-4.4 1.4 -8.4 -0.4 Z" fill="' + f.skin + '"/>' +
      '<g stroke="' + f.skin + '" stroke-width="3.2" stroke-linecap="round">' +
      '<path d="M47.4 51.6 V42.6"/><path d="M51 51.8 V41.4"/>' +
      '<path d="M54.4 52.6 V44"/></g>' +
      '<g stroke="' + f.shade + '" stroke-width="0.8" opacity=".45">' +
      '<path d="M49.2 46 v5"/><path d="M52.7 46 v5"/></g>',
  };

  /* ---- the drawing -------------------------------------------------------
     `uid` must be unique per rendered face: two of the styles clip to a path
     that lives in this SVG's own defs, and duplicate ids on one page make the
     second face clip against the first. */
  let seq = 0;

  FA.faceOf = (nick) => FACES[nick] || null;
  FA.faceClub = (nick) => (FACES[nick] || {}).clubName || "";
  FA.FACE_NICKS = Object.keys(FACES);

  /* The five are frozen and live in several files at once. This one is the
     only place they are DRAWN, so it says so out loud rather than quietly
     showing an initial where a face belongs. */
  FA.NICKS.forEach((n) => {
    if (!FACES[n]) console.warn("faces.js: no caricature for " + n);
  });

  FA.faceSVG = function (nick, opts) {
    const f = FACES[nick];
    const o = opts || {};
    if (!f) {
      // An unknown nickname still gets a mark rather than a hole.
      return '<svg class="face" viewBox="0 0 64 64" role="img" aria-label="' +
        esc(nick || "unknown") + '"><circle cx="32" cy="32" r="31" fill="var(--raise)" ' +
        'stroke="var(--line)"/><text x="32" y="40" text-anchor="middle" font-size="22" ' +
        'font-weight="700" fill="var(--faint)">' + esc(FA.initial(nick || "?")) +
        "</text></svg>";
    }
    const uid = "fa" + (++seq);
    const tint = TINT[f.club] || "#6B7280";
    // A face may bring its own skull and ears; most sit on the shared pair.
    const head = f.head || HEAD;
    const ears = f.ears || (EAR_L + EAR_R);
    const flat = o.flat === true;   // no disc — for a face inside a tight chip
    const dim = o.dim === true;     // not you, or not yet signed in

    return '<svg class="face' + (dim ? " dim" : "") + '" viewBox="0 0 64 64" ' +
      'role="img" aria-label="' + esc(nick) + '">' +
      "<defs>" +
      '<clipPath id="' + uid + 'd"><circle cx="32" cy="32" r="31"/></clipPath>' +
      '<clipPath id="' + uid + 'h">' + head + "</clipPath>" +
      '<linearGradient id="' + uid + 'g" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="' + tint + '" stop-opacity=".26"/>' +
      '<stop offset="1" stop-color="' + tint + '" stop-opacity=".08"/>' +
      "</linearGradient></defs>" +
      (flat ? "" : '<circle cx="32" cy="32" r="31" fill="url(#' + uid + 'g)"/>') +
      '<g clip-path="url(#' + uid + 'd)">' +
      // shoulders, then collar trim, then the person
      '<path d="' + COAT + '" fill="' + f.coat + '"/>' +
      (TRIM[f.style] ? TRIM[f.style](f) : "") +
      '<g fill="' + f.shade + '">' + NECK + "</g>" +
      '<g fill="' + f.skin + '">' + ears + head + "</g>" +
      STYLE[f.style](f, uid) +
      (PROP[f.style] ? PROP[f.style](f) : "") +
      "</g>" +
      (flat ? "" : '<circle cx="32" cy="32" r="30.4" fill="none" stroke="' + tint +
        '" stroke-opacity=".38" stroke-width="1.2"/>') +
      "</svg>";
  };
})();
