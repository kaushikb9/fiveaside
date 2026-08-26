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

  const FACES = {
    "Xabi": {
      clubName: "Chelsea", club: "CHE", skin: "#CF9468", shade: "#B07749",
      hair: "#1C150E", coat: "#0B3F86", collar: "#FFFFFF", style: "xabi",
    },
    "Sir Fergie": {
      clubName: "Man Utd", club: "MUN", skin: "#E9A184", shade: "#C87F60",
      hair: "#DEDBD4", coat: "#2A2E35", collar: "#B01C10", style: "fergie",
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

  /* Each style returns the layers that sit ABOVE the bare head: hair first,
     then brows, eyes, nose, mouth, then the tell. */
  const STYLE = {
    /* The nose, and the rage behind it. Silver horseshoe, no crown left,
       jaw locked mid-chew. */
    fergie: (f, uid) =>
      // the flush, painted over the whole face before anything else
      '<ellipse cx="32" cy="31" rx="15" ry="15" fill="#C4402A" opacity=".2" ' +
      'clip-path="url(#' + uid + 'h)"/>' +
      '<path d="M14.4 33.6 C13.6 23.6 15 13.4 22.2 9.6 C26.2 7.4 29.4 7 32 7 ' +
      "C34.6 7 37.8 7.4 41.8 9.6 C49 13.4 50.4 23.6 49.6 33.6 " +
      "C48.4 34.6 46.4 34.2 45.8 32.8 C45.6 25.4 45 20.8 43.4 18.4 " +
      "C41.2 15.2 36.8 16.2 32 16.2 C27.2 16.2 22.8 15.2 20.6 18.4 " +
      "C19 20.8 18.4 25.4 18.2 32.8 C17.6 34.2 15.6 34.6 14.4 33.6 Z\" " +
      'fill="' + f.hair + '"/>' +
      // brows driven down over the eyes: this is the hairdryer, mid-blast
      '<path d="M20.4 21.6 L30.4 25" stroke="#B9B2A8" stroke-width="2.6" ' +
      'stroke-linecap="round"/>' +
      '<path d="M43.6 21.6 L33.6 25" stroke="#B9B2A8" stroke-width="2.6" ' +
      'stroke-linecap="round"/>' +
      eyes({ r: 2 }) +
      // THE nose. Everything else on this face is a supporting act.
      '<ellipse cx="20.6" cy="35.6" rx="4" ry="2.6" fill="#B8402B" opacity=".3"/>' +
      '<ellipse cx="43.4" cy="35.6" rx="4" ry="2.6" fill="#B8402B" opacity=".3"/>' +
      '<ellipse cx="32" cy="34.2" rx="5.2" ry="5.6" fill="#B8402B" opacity=".72"/>' +
      '<ellipse cx="30.2" cy="32.4" rx="1.5" ry="1.7" fill="#FFFFFF" opacity=".22"/>' +
      // mid-chew: the jaw is open and off to one side
      '<path d="M24.6 40.6 C28 39.4 36 39.8 39.4 41.8 C36.6 45.4 27.4 44.8 24.6 40.6 Z" ' +
      'fill="#6E3226"/>' +
      '<path d="M26.4 40.9 C29.4 40.3 35 40.5 37.6 41.6 Z" fill="#FFFFFF" opacity=".85"/>',

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
      // and the one that has gone up to the hairline to have a look
      '<path d="M34.8 22.4 q4.6 -4.6 9 -0.8" stroke="#6C7075" stroke-width="2.1" ' +
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
      '<path d="M16.6 30.4 C16.8 36.4 18 43.6 21.4 49.6 C25 55.8 29.2 58.4 32 58.4 ' +
      "C34.8 58.4 39 55.8 42.6 49.6 C46 43.6 47.2 36.4 47.4 30.4 " +
      "C45.8 36.4 42.4 38.8 37.6 39.4 C34.2 39.8 29.8 39.8 26.4 39.4 " +
      "C21.6 38.8 18.2 36.4 16.6 30.4 Z\" fill=\"" + f.hair + '"/>' +
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
    const flat = o.flat === true;   // no disc — for a face inside a tight chip
    const dim = o.dim === true;     // not you, or not yet signed in

    return '<svg class="face' + (dim ? " dim" : "") + '" viewBox="0 0 64 64" ' +
      'role="img" aria-label="' + esc(nick) + '">' +
      "<defs>" +
      '<clipPath id="' + uid + 'd"><circle cx="32" cy="32" r="31"/></clipPath>' +
      '<clipPath id="' + uid + 'h">' + HEAD + "</clipPath>" +
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
      '<g fill="' + f.skin + '">' + EAR_L + EAR_R + HEAD + "</g>" +
      STYLE[f.style](f, uid) +
      "</g>" +
      (flat ? "" : '<circle cx="32" cy="32" r="30.4" fill="none" stroke="' + tint +
        '" stroke-opacity=".38" stroke-width="1.2"/>') +
      "</svg>";
  };
})();
