"""Club identity across sources — the join FPL and ESPN do not provide."""

from touchline.core.clubs import build_index, resolve

# Exactly what the FPL bootstrap returns: (name, short_code).
FPL_TEAMS = [
    ("Arsenal", "ARS"), ("Aston Villa", "AVL"), ("Brighton", "BHA"),
    ("Bournemouth", "BOU"), ("Brentford", "BRE"), ("Chelsea", "CHE"),
    ("Coventry City", "COV"), ("Crystal Palace", "CRY"), ("Everton", "EVE"),
    ("Fulham", "FUL"), ("Hull City", "HUL"), ("Ipswich Town", "IPS"),
    ("Leeds", "LEE"), ("Liverpool", "LIV"), ("Man City", "MCI"),
    ("Man Utd", "MUN"), ("Newcastle", "NEW"), ("Nott'm Forest", "NFO"),
    ("Sunderland", "SUN"), ("Spurs", "TOT"),
]

# What ESPN calls the same twenty.
ESPN_NAMES = {
    "Arsenal": "ARS", "Aston Villa": "AVL", "Brighton & Hove Albion": "BHA",
    "AFC Bournemouth": "BOU", "Brentford": "BRE", "Chelsea": "CHE",
    "Coventry City": "COV", "Crystal Palace": "CRY", "Everton": "EVE",
    "Fulham": "FUL", "Hull City": "HUL", "Ipswich Town": "IPS",
    "Leeds United": "LEE", "Liverpool": "LIV", "Manchester City": "MCI",
    "Manchester United": "MUN", "Newcastle United": "NEW",
    "Nottingham Forest": "NFO", "Sunderland": "SUN", "Tottenham Hotspur": "TOT",
}


def test_every_espn_name_reaches_its_fpl_club():
    """The whole point: without this join a cup tie cannot reach a player card."""
    index = build_index(FPL_TEAMS)
    for espn_name, code in ESPN_NAMES.items():
        assert resolve(espn_name, index) == code, f"{espn_name} did not resolve"


def test_spurs_is_the_case_no_rule_can_reach():
    """"Tottenham Hotspur" and "Spurs" share no token, which is why the map exists."""
    index = build_index(FPL_TEAMS)
    assert resolve("Tottenham Hotspur", index) == "TOT"
    assert resolve("Spurs", index) == "TOT"


def test_an_ambiguous_name_resolves_to_nothing_rather_than_the_wrong_club():
    """Both Manchester clubs reduce to "manchester" once noise words go.

    A key that could mean two clubs is worse than no key: unmatched gets
    reported, mismatched quietly credits Manchester United's cup exit to
    Manchester City.
    """
    index = build_index(FPL_TEAMS)
    assert resolve("Manchester", index) is None
    assert resolve("Manchester City", index) == "MCI"
    assert resolve("Manchester United", index) == "MUN"


def test_clubs_we_do_not_follow_stay_unresolved():
    """A cup opponent or a European side must not be forced into a PL code."""
    index = build_index(FPL_TEAMS)
    for outsider in ["Benfica", "Bradford City", "Napoli", "Real Madrid", ""]:
        assert resolve(outsider, index) is None


def test_short_codes_resolve_to_themselves():
    index = build_index(FPL_TEAMS)
    assert resolve("CHE", index) == "CHE"
    assert resolve("che", index) == "CHE"
