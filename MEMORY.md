# Team memory

Maintained by the night shift's dream pass — durable lessons distilled from each
night's trace. Imperative, one lesson per bullet. See AGENTS.md/README for rules
that are not repeated here.

## Resilient parsing & graceful degradation
- A broad `try/except` around the whole fetch+parse makes one bad record suppress
  ALL data (saw `name: null` -> `ValidationError` drop the entire football section);
  parse per-record and tolerate anomalies so one bad item can't blank a section.
- Coerce missing/null/empty/whitespace fields to a sentinel (e.g. `name -> "TBD"`)
  rather than failing; guard nested objects too (`match.get("homeTeam") or {}`).
- Keep optional codes/ids passing through as-is (may stay `None`); don't widen a
  required `str` field just to absorb bad input — fix it at the parse boundary.

## Reconciling refactors
- When a module is reshaped across PRs, audit git history for behaviors AND their
  dedicated test files — merges silently drop both (e.g. `winner` prop + ge=0 + tests).
- Restore lost behavior adapted to the *current* model shape (flat vs nested), never
  by reverting; keep additive so existing fields stay untouched.

## Repo structure & conventions
- New package dirs may exist without `__init__.py` (saw it for `render/`, `web/`);
  add the package marker before importing or the import fails.
- Register CLI entry points in `pyproject.toml` `[project.scripts]`
  (`terrace = "terrace.cli:main"`), then `uv run terrace ...` works.
- Build the web app with a `create_app(source=None, *, now_fn=None)` factory so tests
  inject fake sources and a fixed clock; expose module-level `app` for serving.
- Derive model fields with pydantic computed properties + `Field(ge=0)` validation;
  core keeps to pydantic + stdlib imports only.
- Pure core derivations (e.g. `compute_standings`) import only `terrace.core.models`
  + pydantic; use `model_copy` to mutate frozen models (e.g. reassigning `position`).

## Rendering
- Use `%d` (zero-padded) for digest date headers; `%-d` is non-portable.
- Pure renderers take a digest and return a string — no I/O, only core imports.
- Reuse the digest template's PWA head/style for new web pages to stay consistent.

## Budget & scoping
- Multi-file slices blow the turn limit: the RSS-news item touched core+base+digest+
  CLI+3 test files+README and the implementer hit `error_max_turns` at 41 turns with
  zero usable output. Split such work orders into single-surface slices.
- Large multi-file items burn turns fast (web PWA took ~38 implementer turns); scope
  tightly and split when a work order spans many new files.
- Sessions can hit a hard session limit mid-item (a reviewer halted with revisions=0
  on the standings item); front-load the riskiest work and commit progress early so
  a halt loses less.
