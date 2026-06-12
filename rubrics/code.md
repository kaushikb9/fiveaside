# Code rubric (grader: verify each line independently)

1. `uv run pytest` passes — run it yourself; trust no report.
2. `uv run ruff check .` is clean.
3. New behavior has tests, including at least one failure-mode/degradation test.
4. `core/` remains pure: no network, filesystem, or framework imports inside it.
5. Scope matches the work order — no unrequested files changed, no drive-by refactors.
6. Conventions in AGENTS.md respected (interfaces for sources, env-var config, graceful degradation).
7. Code reads like the surrounding code; no dead code, no commented-out blocks, no TODO-littering.
