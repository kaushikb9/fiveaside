"""Player identity inside one squad — the join that turns a fixture into a warning."""

from touchline.core.squads import build_squad, resolve_player, squad_initials


class E:
    """Just enough of an FPLElement for the index."""

    def __init__(self, id, first, second, web):
        self.id, self.first_name, self.second_name, self.web_name = id, first, second, web


def _squad(*els):
    return build_squad(list(els)), squad_initials(list(els))


def test_full_name_and_web_name_both_reach_the_player():
    sq, ini = _squad(E(1, "Cole", "Palmer", "Palmer"))
    assert resolve_player("Cole Palmer", sq, ini) == 1
    assert resolve_player("Palmer", sq, ini) == 1


def test_a_reversed_name_order_still_matches():
    """FPL files Ao Tanaka as first_name "Tanaka", second_name "Ao".

    Sources disagree about name ORDER, not only spelling. Without the reversed
    index the surname fallback compares the wrong halves and rejects him.
    """
    sq, ini = _squad(E(7, "Tanaka", "Ao", "Tanaka"))
    assert resolve_player("Ao Tanaka", sq, ini) == 7


def test_accents_do_not_lose_a_player():
    sq, ini = _squad(E(3, "Estêvão", "Willian", "Estêvão"))
    assert resolve_player("Estevao Willian", sq, ini) == 3
    assert resolve_player("Estêvão", sq, ini) == 3


def test_two_squad_mates_sharing_a_surname_resolve_to_nobody():
    """A gap is a gap. A wrong attribution is a lie the page cannot notice."""
    sq, ini = _squad(
        E(1, "Ryan", "Sessegnon", "Sessegnon"),
        E(2, "Steven", "Sessegnon", "Sessegnon"),
    )
    assert resolve_player("Sessegnon", sq, ini) is None
    # Given the full name, there is no ambiguity left to refuse.
    assert resolve_player("Ryan Sessegnon", sq, ini) == 1


def test_an_academy_player_does_not_inherit_a_squad_mates_surname():
    """A cup tie is exactly where this happens.

    Hull fielded Babajide David, who is not in FPL. Without the initial check
    his appearance would have been credited to somebody else's David.
    """
    sq, ini = _squad(E(9, "Promise", "David", "David"))
    assert resolve_player("Promise David", sq, ini) == 9
    assert resolve_player("Babajide David", sq, ini) is None


def test_a_bare_surname_with_no_given_name_is_refused_when_unknown():
    sq, ini = _squad(E(9, "Promise", "David", "David"))
    # The squad knows this surname, so a bare "David" is him.
    assert resolve_player("David", sq, ini) == 9
    # A name the squad has never heard of stays unresolved.
    assert resolve_player("Wilson", sq, ini) is None
