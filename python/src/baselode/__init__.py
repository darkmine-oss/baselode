# Copyright (C) 2026 Darkmine Pty Ltd
# SPDX-License-Identifier: GPL-3.0-or-later

from importlib.metadata import version, PackageNotFoundError

try:
    __version__ = version("baselode")
except PackageNotFoundError:
    __version__ = "0.0.0"
