"""Player identity across sources, scoped to a club.

ESPN names a footballer "Patrick Dorgu"; FPL calls him "Dorgu" and keeps the
rest in `first_name`/`second_name`. Joining the two is what turns "Manchester
United played on Wednesday" into "this player started on Wednesday", which is
the difference between a fixture list and a rotation warning.

The join is scoped to ONE CLUB at a time, and that is the whole safety story.
Across the league there are two Palmers and matching them by surname is a coin
flip; inside a single squad a surname is almost always unique, and when it is
not the answer is nothing rather than a guess. FPL's own data makes the point:
Cole Palmer plays for Chelsea and Alex Palmer for Ipswich, so club-scoping
separates them before the name is even looked at.
"""

from __future__ import annotations

import unicodedata


def _fold(name: str) -> str:
    """Lowercase, accents removed, punctuation flattened.

    ESPN and FPL disagree about accents often enough to matter: one writes
    "Estevao" where the other writes "Estêvão", and a strict comparison drops
    the player silently.
    """
    decomposed = unicodedata.normalize("NFKD", name or "")
    stripped = "".join(c for c in decomposed if not unicodedata.combining(c))
    cleaned = "".join(c if c.isalnum() or c.isspace() else " " for c in stripped.lower())
    return " ".join(cleaned.split())


def build_squad(elements: list) -> dict[str, list[int]]:
    """Every way a player in this squad might be named, to element ids.

    A name that fits two players in the same squad keeps BOTH ids, so the
    caller can refuse it. Losing an appearance is a gap; attributing it to the
    wrong player is a lie the page has no way to notice.
    """
    index: dict[str, list[int]] = {}

    def note(name: str, element_id: int) -> None:
        key = _fold(name)
        if not key:
            return
        ids = index.setdefault(key, [])
        if element_id not in ids:
            ids.append(element_id)

    for e in elements:
        full = f"{e.first_name} {e.second_name}".strip()
        note(full, e.id)
        # The same two words the other way round. Sources disagree about name
        # ORDER, not just spelling: FPL files Ao Tanaka as first_name "Tanaka",
        # second_name "Ao", so ESPN's "Ao Tanaka" only matches reversed. Without
        # this the surname fallback compares the wrong halves and rejects a
        # real player as an impostor.
        note(f"{e.second_name} {e.first_name}".strip(), e.id)
        note(e.second_name, e.id)
        note(e.web_name, e.id)
        # "P. Dorgu" and "Dorgu, Patrick" both reduce to the surname, which the
        # line above already covers; the initial form is added for feeds that
        # abbreviate the given name.
        if e.first_name and e.second_name:
            note(f"{e.first_name[0]} {e.second_name}", e.id)
    return index


def resolve_player(
    name: str,
    squad: dict[str, list[int]],
    initials: dict[int, str] | None = None,
) -> int | None:
    """The FPL element id for a name inside one squad, or None if unsure.

    The whole name first. Only then the surname, and only when the given names
    agree on their first letter — because a cup tie is where academy players
    appear, and academy players are exactly who share a surname with a squad
    member without being in FPL at all. Hull fielded Babajide David, whose
    surname would otherwise have found somebody else's David.

    Ambiguity at either step returns None; see build_squad for why.
    """
    if not name:
        return None
    key = _fold(name)
    ids = squad.get(key)
    if ids:
        return ids[0] if len(ids) == 1 else None

    parts = key.split(" ")
    if len(parts) < 2:
        return None  # a bare surname with no given name to corroborate it
    ids = squad.get(parts[-1])
    if not ids or len(ids) > 1:
        return None
    if initials is not None:
        want = initials.get(ids[0], "")
        if want and want != parts[0][:1]:
            return None  # same surname, different man
    return ids[0]


def squad_initials(elements: list) -> dict[int, str]:
    """First letter of each player's given name, for the surname fallback."""
    return {e.id: (e.first_name or "")[:1].lower() for e in elements}
