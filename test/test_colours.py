# SPDX-License-Identifier: GPL-3.0-or-later

# Copyright (C) 2026 Darkmine Pty Ltd

# This file is part of baselode.

# baselode is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

# baselode is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU General Public License for more details.

# You should have received a copy of the GNU General Public License
# along with baselode.  If not, see <https://www.gnu.org/licenses/>.

"""Tests for the semantic colour mapping system (baselode.colours)."""

import pytest

from baselode.colours import (
    BUILTIN_COLOUR_MAPS,
    COMMODITY_COLOURS,
    FALLBACK_COLOUR,
    LITHOLOGY_COLOURS,
    get_colour,
    resolve_colour_map,
)


# ---------------------------------------------------------------------------
# Built-in maps
# ---------------------------------------------------------------------------


def test_commodity_colours_contains_core_elements():
    for element in ("Cu", "Au", "Fe", "Ni"):
        assert element in COMMODITY_COLOURS, f"{element} missing from COMMODITY_COLOURS"


def test_lithology_colours_contains_core_categories():
    for lith in ("BIF", "shale", "granite", "basalt"):
        assert lith in LITHOLOGY_COLOURS, f"{lith} missing from LITHOLOGY_COLOURS"


def test_builtin_maps_registry():
    assert "commodity" in BUILTIN_COLOUR_MAPS
    assert "lithology" in BUILTIN_COLOUR_MAPS
    assert BUILTIN_COLOUR_MAPS["commodity"] is COMMODITY_COLOURS
    assert BUILTIN_COLOUR_MAPS["lithology"] is LITHOLOGY_COLOURS


def test_all_commodity_colours_are_strings():
    for key, val in COMMODITY_COLOURS.items():
        assert isinstance(val, str), f"COMMODITY_COLOURS[{key!r}] is not a string"


def test_all_lithology_colours_are_strings():
    for key, val in LITHOLOGY_COLOURS.items():
        assert isinstance(val, str), f"LITHOLOGY_COLOURS[{key!r}] is not a string"


# ---------------------------------------------------------------------------
# get_colour
# ---------------------------------------------------------------------------


def test_get_colour_exact_match():
    assert get_colour("Cu", COMMODITY_COLOURS) == COMMODITY_COLOURS["Cu"]


def test_get_colour_case_insensitive():
    assert get_colour("cu", COMMODITY_COLOURS) == COMMODITY_COLOURS["Cu"]
    assert get_colour("GRANITE", LITHOLOGY_COLOURS) == LITHOLOGY_COLOURS["granite"]


def test_get_colour_missing_returns_fallback():
    result = get_colour("Unobtanium", COMMODITY_COLOURS)
    assert result == FALLBACK_COLOUR


def test_get_colour_custom_fallback():
    result = get_colour("Unobtanium", COMMODITY_COLOURS, fallback="#123456")
    assert result == "#123456"


def test_get_colour_none_value_returns_fallback():
    assert get_colour(None, COMMODITY_COLOURS) == FALLBACK_COLOUR


def test_get_colour_empty_map_returns_fallback():
    assert get_colour("Cu", {}) == FALLBACK_COLOUR


def test_get_colour_none_map_returns_fallback():
    assert get_colour("Cu", None) == FALLBACK_COLOUR


# ---------------------------------------------------------------------------
# resolve_colour_map
# ---------------------------------------------------------------------------


def test_resolve_colour_map_none():
    assert resolve_colour_map(None) == {}


def test_resolve_colour_map_builtin_commodity():
    result = resolve_colour_map("commodity")
    assert result is COMMODITY_COLOURS


def test_resolve_colour_map_builtin_lithology():
    result = resolve_colour_map("lithology")
    assert result is LITHOLOGY_COLOURS


def test_resolve_colour_map_name_case_insensitive():
    assert resolve_colour_map("COMMODITY") is COMMODITY_COLOURS
    assert resolve_colour_map("Lithology") is LITHOLOGY_COLOURS


def test_resolve_colour_map_user_dict():
    user_map = {"sandstone": "#aabbcc"}
    result = resolve_colour_map(user_map)
    assert result is user_map


def test_resolve_colour_map_unknown_name_raises():
    with pytest.raises(ValueError, match="Unknown built-in colour map"):
        resolve_colour_map("geology")


def test_resolve_colour_map_wrong_type_raises():
    with pytest.raises(TypeError):
        resolve_colour_map(42)
