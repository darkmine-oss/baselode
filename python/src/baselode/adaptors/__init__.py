# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Darkmine Pty Ltd
"""Source-specific adaptors that convert third-party raw schemas into the
baselode canonical data model.

Each adaptor sub-package targets one source (e.g. ``raw_gswa``) and provides:

- ``build_*_query`` helpers that return SQL strings ready to run against the
  source.
- ``convert_*`` functions that take pandas DataFrames (the raw query results)
  and return baselode-shaped DataFrames consumable by ``baselode.drill.data``
  loaders and downstream baselode utilities.
"""
