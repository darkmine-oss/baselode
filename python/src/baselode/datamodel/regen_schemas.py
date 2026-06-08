# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Darkmine Pty Ltd

"""Regenerate the committed ``baselode_schemas.json`` files.

Run via::

    python -m baselode.datamodel.regen_schemas

Writes two identical copies of the combined JSON Schema document:

1. ``test/data/baselode_schemas.json`` — the parity-contract truth.
2. ``javascript/packages/baselode/src/data/baselode_schemas.json`` —
   bundled into the JS package so the loader can ship the schemas to
   the browser without a network fetch.

A separate parity test asserts that the two copies match the
generator's current output bit-for-bit — failures there mean someone
edited the JSON by hand or forgot to run the regen after touching a
``BASELODE_DATA_MODEL_*`` dict.
"""

import json
import sys
from pathlib import Path

from baselode.datamodel.schemas import to_json_schema_all

# Baselode-specific filesystem markers that prove we're inside a
# source checkout (and not, say, an installed wheel under
# site-packages).  Both must exist at the same parent for us to call
# that parent the repo root.
_REPO_MARKERS = (
    Path("test") / "data" / "parity_contract.json",
    Path("javascript") / "packages" / "baselode" / "src" / "data",
)


def _find_repo_root(start):
    """Walk upward from *start* looking for a baselode source checkout.

    Raises ``RuntimeError`` with a clear message when no parent
    contains every marker in :data:`_REPO_MARKERS` — i.e. when the
    module is being run from an installed wheel rather than the repo.
    """
    for candidate in (start, *start.parents):
        if all((candidate / marker).exists() for marker in _REPO_MARKERS):
            return candidate
    raise RuntimeError(
        "baselode.datamodel.regen_schemas must be run from a source "
        "checkout of the baselode repo — none of the parent "
        f"directories of {start} contain the expected markers "
        f"({', '.join(str(m) for m in _REPO_MARKERS)}).  Clone the "
        "repo from https://github.com/darkmine-oss/baselode and run "
        "the regen from there."
    )


# Lazily resolved at import time; safe because both the parity test
# and the entrypoint script always run from inside the checkout.  If
# an installed-wheel caller imports this module, the error fires
# immediately with the explanation above rather than silently writing
# into site-packages.
_REPO_ROOT = _find_repo_root(Path(__file__).resolve().parent)
PY_OUT_PATH = _REPO_ROOT / "test" / "data" / "baselode_schemas.json"
JS_OUT_PATH = (
    _REPO_ROOT / "javascript" / "packages" / "baselode" / "src" / "data" / "baselode_schemas.json"
)


def render():
    """Render the combined schema document as a stable JSON string."""
    doc = to_json_schema_all()
    # ``ensure_ascii=False`` so unit symbols (°, …) stay as-is if any
    # are added later.  Trailing newline keeps git's "no newline at
    # end of file" warning silent.
    return json.dumps(doc, indent=2, ensure_ascii=False, sort_keys=False) + "\n"


def write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return path


def main(argv=None):
    text = render()
    written = []
    for out in (PY_OUT_PATH, JS_OUT_PATH):
        write(out, text)
        written.append(out)
    for path in written:
        print(f"wrote {path.relative_to(_REPO_ROOT)} ({len(text)} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
