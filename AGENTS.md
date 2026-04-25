# Repository conventions for AI agents

Baselode styling is opinionated. Follow these rules.

## Python style

**Do not use the `typing` module or PEP-484 type annotations.**

This applies to all Python code in this repo (`python/src/baselode/`, `test/`,
scripts, notebooks, etc.). That means:

- No `from typing import ...` imports.
- No parameter annotations: write `def f(x, y=None)`, not
  `def f(x: int, y: Optional[str] = None)`.
- No return-type annotations: no `-> pd.DataFrame`, no `-> None`.
- No variable annotations: `params = {}`, not `params: dict = {}`.
- No `TypeAlias` / `TypedDict` / `Protocol` / `Generic` declarations.

Document the contract in the docstring instead — parameter types and return
shapes go under `Parameters` / `Returns` sections in numpydoc style, the same
way the existing `baselode.drill.data` module does it.

### One exception: FastAPI

FastAPI route handlers and Pydantic models depend on annotations for request
validation, response schema generation, and OpenAPI docs. Use type hints
freely there — but only there. If you find yourself writing FastAPI-style
annotations in a non-FastAPI module, you're in the wrong file.


Use fully qualified python imports and names for internal modules to improve readability

- Use `import baselode.drill.data` 
- NOT `from baselode.drill import data`

## Imports

**Don't `try: import …` to "softly" handle a missing dependency.** If the code
imports it, the project depends on it — declare it. Always import directly at
the top of the module; if the import fails when you run the code, add the
package to `python/pyproject.toml` (and `python/requirements.txt` if it's used
in CI / scripts), then re-run.

```python
# WRONG — silently masks a missing dep, hides bugs, leaves dead branches
try:
    import pyproj
except ImportError:
    pyproj = None
```

```python
# RIGHT — declare the dep and import normally
import pyproj
```

### One exception: optional baselode extras

Packages declared under `[project.optional-dependencies]` in
`python/pyproject.toml` (currently `viz`, `sql`, `las`, `api`) are genuinely
optional — they're only present when the user installs the matching extra
(`pip install baselode[api]`, etc.). For *those specific imports only*, the
soft-import pattern is correct:

```python
# In code that should work without the optional extra installed:
try:
    import requests as _requests   # provided by the `api` extra
except ImportError:
    _requests = None
```

The downstream code path that needs the extra must raise a clear `ImportError`
with installation instructions when `_requests is None`, the same way
`baselode.adaptors.raw_gswa.api.RawGswaApiClient.__init__` does.

If you find yourself wrapping a `try: import …` around anything that *isn't*
listed under `[project.optional-dependencies]`, the answer is to add it to
the deps — not to soften the import.