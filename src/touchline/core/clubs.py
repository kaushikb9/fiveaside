"""Club identity across sources.

The same twenty clubs are named differently by everyone. FPL calls Tottenham
"Spurs" and Manchester United "Man Utd"; ESPN calls them "Tottenham Hotspur"
and "Manchester United". Nothing joins those automatically, and that mismatch
is what ROADMAP 4b named as the real work behind showing a player's form
across every competition rather than only the league.

Why a hand-written map rather than a clever normaliser: a normaliser handles
"Newcastle United" to "Newcastle" and even "Manchester City" to "Man City",
and then dies on Tottenham Hotspur to Spurs, which share not one character of
a token. Any rule that bridges those two is a rule that will also bridge two
clubs that should stay apart. So the exceptions are written down, the obvious
cases are still matched automatically, and anything left over is REPORTED
rather than dropped -- a promoted club nobody has mapped yet must be loud.
"""

from __future__ import annotations

# ESPN's name for a club -> FPL's short code. Only clubs whose names cannot be
# matched by the normaliser below need an entry, but the current top flight is
# listed in full so a season's promotions are an obvious diff.
ESPN_TO_FPL: dict[str, str] = {
    "Arsenal": "ARS",
    "Aston Villa": "AVL",
    "AFC Bournemouth": "BOU",
    "Bournemouth": "BOU",
    "Brentford": "BRE",
    "Brighton & Hove Albion": "BHA",
    "Brighton and Hove Albion": "BHA",
    "Chelsea": "CHE",
    "Coventry City": "COV",
    "Crystal Palace": "CRY",
    "Everton": "EVE",
    "Fulham": "FUL",
    "Hull City": "HUL",
    "Ipswich Town": "IPS",
    "Leeds United": "LEE",
    "Liverpool": "LIV",
    "Manchester City": "MCI",
    "Manchester United": "MUN",
    "Newcastle United": "NEW",
    "Nottingham Forest": "NFO",
    "Sunderland": "SUN",
    # The one no rule can reach.
    "Tottenham Hotspur": "TOT",
    "Tottenham": "TOT",
    # Recently up or down, kept so a relegated club's cup run still resolves.
    "Leicester City": "LEI",
    "Southampton": "SOU",
    "West Ham United": "WHU",
    "Wolverhampton Wanderers": "WOL",
}

# Words that carry no identity: two clubs are never told apart by them.
_NOISE = {"afc", "fc", "united", "city", "town", "wanderers", "albion", "hotspur", "rovers"}


def _key(name: str) -> str:
    """A comparable core for a club name: lowercase, no noise words, no punctuation."""
    cleaned = "".join(c if c.isalnum() or c.isspace() else " " for c in name.lower())
    words = [w for w in cleaned.split() if w and w not in _NOISE]
    return " ".join(words)


def build_index(fpl_teams: list[tuple[str, str]]) -> dict[str, str]:
    """Map every way a club might be named to its FPL short code.

    `fpl_teams` is (name, short_code) straight off the FPL bootstrap, so the
    codes are whatever FPL says today rather than a second copy of them here.

    Exact names always win. Normalised keys are only kept when they are
    UNAMBIGUOUS: "Manchester City" and "Manchester United" both reduce to
    "manchester" once the noise words go, and a key that could mean two clubs
    is worse than no key at all -- an unmatched club gets reported, a
    mismatched one quietly attributes Manchester United's cup exit to
    Manchester City. Same failure the player cards had when they were keyed by
    surname and two Palmers shared one.
    """
    exact: dict[str, str] = {}
    loose: dict[str, set[str]] = {}
    codes = {c for _, c in fpl_teams}

    def note(name: str, code: str) -> None:
        exact[name.lower()] = code
        k = _key(name)
        if k:
            loose.setdefault(k, set()).add(code)

    for name, code in fpl_teams:
        exact[code.lower()] = code
        note(name, code)

    # The hand-written aliases exist for the cases the normaliser gets wrong,
    # so their exact spellings must not be shadowed by it.
    for espn_name, code in ESPN_TO_FPL.items():
        if code in codes:
            note(espn_name, code)

    index = dict(exact)
    for k, owners in loose.items():
        if len(owners) == 1 and k not in index:
            index[k] = next(iter(owners))
    return index


def resolve(name: str, index: dict[str, str]) -> str | None:
    """The FPL short code for a club name, or None if nothing in the index fits."""
    if not name:
        return None
    direct = index.get(name.lower())
    if direct:
        return direct
    return index.get(_key(name))
