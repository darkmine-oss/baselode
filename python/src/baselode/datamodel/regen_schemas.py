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

# This module lives under python/src/baselode/datamodel/.  The repo
# root is four parents up (datamodel → baselode → src → python →
# repo).  Walking parents explicitly is the same shape used by
# `test/test_parity_contract.py`.
_REPO_ROOT = Path(__file__).resolve().parents[4]
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
