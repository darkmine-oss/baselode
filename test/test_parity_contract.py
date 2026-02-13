# SPDX-License-Identifier: GPL-3.0-or-later

# Copyright (C) 2026 Darkmine Pty Ltd

import importlib
import json
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
CONTRACT_PATH = ROOT / "test" / "data" / "parity_contract.json"
JS_INDEX_PATH = ROOT / "javascript" / "packages" / "baselode" / "src" / "index.js"
PYTHON_SRC_PATH = ROOT / "python" / "src"

if str(PYTHON_SRC_PATH) not in sys.path:
    sys.path.insert(0, str(PYTHON_SRC_PATH))


def _load_contract():
    with CONTRACT_PATH.open("r", encoding="utf-8") as f:
        return json.load(f)


def test_contract_shape_is_valid():
    contract = _load_contract()
    assert "capabilities" in contract
    assert isinstance(contract["capabilities"], list)
    assert contract["capabilities"]


def test_python_symbols_exist_for_contract():
    contract = _load_contract()
    for capability in contract["capabilities"]:
        for module_name, symbol_name in capability.get("pythonSymbols", []):
            module = importlib.import_module(module_name)
            assert hasattr(module, symbol_name), f"Missing python symbol {module_name}.{symbol_name}"


def test_js_exports_declared_for_contract():
    contract = _load_contract()
    source = JS_INDEX_PATH.read_text(encoding="utf-8")
    for capability in contract["capabilities"]:
        for symbol in capability.get("jsExports", []):
            assert symbol in source, f"Missing JS export symbol in index.js: {symbol}"
