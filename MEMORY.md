# Team memory

Maintained by the night shift's dream pass — durable lessons distilled from each
night's trace. Imperative, one lesson per bullet. See AGENTS.md/README for rules
that are not repeated here.

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

## Rendering
- Use `%d` (zero-padded) for digest date headers; `%-d` is non-portable.
- Pure renderers take a digest and return a string — no I/O, only core imports.

## Budget & scoping
- Large multi-file items burn turns fast (web PWA item took ~38 implementer turns);
  scope tightly and split when a work order spans many new files.
- Sessions can hit a hard limit mid-item and halt with revisions=0 — front-load the
  riskiest work and commit progress early so a halt loses less.
