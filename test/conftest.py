# SPDX-License-Identifier: GPL-3.0-or-later

# Copyright (C) 2026 Darkmine Pty Ltd

from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
PYTHON_SRC_PATH = ROOT / "python" / "src"

if str(PYTHON_SRC_PATH) not in sys.path:
    sys.path.insert(0, str(PYTHON_SRC_PATH))
