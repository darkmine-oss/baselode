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

"""Semantic colour mapping system for Baselode graphs.

This module provides two independent layers of graph styling:

- **Chart theme** (Plotly templates): fonts, layout, backgrounds, axes.
- **Semantic colour mapping** (this module): domain-value → colour dicts for
  commodities, lithologies, and other categorical data.

Built-in maps ship sensible defaults; users can supply their own dicts or
extend the built-ins via ``resolve_colour_map``.

Usage example::

    from baselode.colours import COMMODITY_COLOURS, get_colour, resolve_colour_map

    # Look up a single value with a safe fallback
    colour = get_colour("Cu", COMMODITY_COLOURS)

    # Resolve a map by name or pass through a user dict
    cmap = resolve_colour_map("commodity")
    cmap = resolve_colour_map({"BIF": "#8b6914", "shale": "#607d8b"})
"""

# ---------------------------------------------------------------------------
# Fallback colour used when a value is absent from any colour map.
# ---------------------------------------------------------------------------

FALLBACK_COLOUR = "#7f7f7f"

# ---------------------------------------------------------------------------
# Built-in colour maps
# ---------------------------------------------------------------------------

COMMODITY_COLOURS = {
    "Au": "#FFD700",   # gold
    "Ag": "#C0C0C0",   # silver
    "Cu": "#B87333",   # copper / orange-brown
    "Fe": "#8B4513",   # iron / rusty brown
    "Ni": "#4CAF50",   # nickel / green
    "Zn": "#78909C",   # zinc / blue-grey
    "Pb": "#607D8B",   # lead / slate
    "Mo": "#9C27B0",   # molybdenite / purple
    "Co": "#2196F3",   # cobalt / blue
    "Li": "#FF5722",   # lithium / deep orange
    "Mn": "#795548",   # manganese / brown
    "Cr": "#009688",   # chromium / teal
    "V":  "#673AB7",   # vanadium / deep purple
    "W":  "#FF9800",   # tungsten / amber
    "Sn": "#9E9E9E",   # tin / medium grey
    "Ti": "#00BCD4",   # titanium / cyan
    "Al": "#FFEB3B",   # aluminium / yellow
    "U":  "#8BC34A",   # uranium / lime green
}

LITHOLOGY_COLOURS = {
    # Sedimentary
    "shale":       "#607D8B",   # blue-grey
    "mudstone":    "#78909C",   # lighter blue-grey
    "siltstone":   "#90A4AE",   # pale blue-grey
    "sandstone":   "#F5CBA7",   # sand / light orange-tan
    "limestone":   "#B0BEC5",   # cool grey
    "dolomite":    "#CFD8DC",   # very pale grey
    "conglomerate":"#D7CCC8",   # pebble / warm grey
    "coal":        "#212121",   # near-black
    # Iron-formation
    "BIF":         "#8B4513",   # banded iron formation / rusty brown
    "ironstone":   "#A0522D",   # sienna
    # Igneous – intrusive
    "granite":     "#EF9A9A",   # pale pink
    "granodiorite":"#F48FB1",   # pink-red
    "diorite":     "#CE93D8",   # lilac
    "gabbro":      "#546E7A",   # dark blue-grey
    "peridotite":  "#33691E",   # dark olive green
    "pegmatite":   "#FFF9C4",   # pale yellow
    # Igneous – extrusive / volcanic
    "basalt":      "#37474F",   # very dark grey
    "andesite":    "#78909C",   # medium grey
    "rhyolite":    "#FFCCBC",   # pale salmon
    "dacite":      "#FFAB91",   # light salmon-orange
    "tuff":        "#D7CCC8",   # pale warm grey
    "breccia":     "#BCAAA4",   # warm brownish grey
    # Metamorphic
    "schist":      "#80CBC4",   # mint-teal
    "gneiss":      "#4DB6AC",   # medium teal
    "quartzite":   "#E0F7FA",   # near-white cyan
    "marble":      "#F5F5F5",   # near-white
    "slate":       "#455A64",   # dark blue-grey
    "phyllite":    "#80DEEA",   # light cyan
    # Other
    "quartz":      "#ECEFF1",   # near-white
    "calcite":     "#F9FBE7",   # very pale yellow-green
    "vein":        "#FFFFFF",   # white
    "unknown":     "#9E9E9E",   # medium grey
}

# Registry of all built-in maps; users can look these up by name.
BUILTIN_COLOUR_MAPS = {
    "commodity": COMMODITY_COLOURS,
    "lithology": LITHOLOGY_COLOURS,
}

# ---------------------------------------------------------------------------
# Built-in pattern (hatch) maps for categorical strip-log bands
# ---------------------------------------------------------------------------

# Plotly-native ``marker.pattern`` shapes: "/", "\\", "x", "-", "|", "+", ".",
# and "" (solid). Keys are a subset of :data:`LITHOLOGY_COLOURS` following
# common geologic hatch conventions; categories absent from the map render
# solid. Mirrors the JS ``LITHOLOGY_PATTERNS``.
LITHOLOGY_PATTERNS = {
    # Sedimentary
    "shale":       "-",
    "mudstone":    "-",
    "siltstone":   "-",
    "sandstone":   ".",
    "limestone":   "+",
    "dolomite":    "/",
    "conglomerate":".",
    # Igneous – intrusive
    "granite":     "+",
    # Igneous – extrusive / volcanic
    "basalt":      "x",
    "breccia":     ".",
    # Metamorphic
    "schist":      "\\",
    "gneiss":      "\\",
    # Other
    "quartz":      "/",
    "vein":        "/",
}

# Registry of all built-in pattern maps; users can look these up by name.
BUILTIN_PATTERN_MAPS = {
    "lithology": LITHOLOGY_PATTERNS,
}

# ---------------------------------------------------------------------------
# Sequential + qualitative ramps for numeric strip logs
# ---------------------------------------------------------------------------

# Magma-style sequential ramp (low → high) used to grade a numeric downhole
# curve by assay value. Mirrors the JS ``ASSAY_COLOR_PALETTE_10``.
ASSAY_COLOR_PALETTE_10 = [
    "#1d1147", "#3b0f70", "#641a80", "#8c2981", "#b73779",
    "#de4968", "#f7705c", "#fe9f6d", "#fece91", "#fcfdbf",
]

# Qualitative colorway for multi-assay overlays — used when a series' column
# name does not resolve to a known commodity colour. Mirrors the JS
# ``MULTI_SERIES_COLORWAY``.
MULTI_SERIES_COLORWAY = [
    "#4e79a7", "#f28e2b", "#59a14f", "#e15759",
    "#b07aa1", "#76b7b2", "#edc948", "#ff9da7",
    "#9c755f", "#bab0ac",
]


def build_plotly_colorscale(palette=None):
    """Convert a hex colour ramp into a Plotly ``colorscale``.

    Returns a list of ``[stop, colour]`` pairs with stops spread evenly across
    ``[0, 1]``. A single-colour palette maps to a flat ``[[0, c], [1, c]]`` so
    Plotly never divides by zero.

    Parameters
    ----------
    palette : list of str, optional
        Ordered low→high hex colours. Defaults to :data:`ASSAY_COLOR_PALETTE_10`.

    Returns
    -------
    list of [float, str]
    """
    colours = palette if palette else ASSAY_COLOR_PALETTE_10
    if len(colours) == 1:
        return [[0.0, colours[0]], [1.0, colours[0]]]
    last = len(colours) - 1
    return [[idx / last, colour] for idx, colour in enumerate(colours)]


def series_colour(col_name, index):
    """Pick a stable colour for an assay series.

    Uses the commodity colour when the column name encodes one (e.g.
    ``"Au_ppm"`` → gold), else cycles :data:`MULTI_SERIES_COLORWAY`.

    Parameters
    ----------
    col_name : str
        Series / column name.
    index : int
        Series index, used to cycle the fallback colorway.

    Returns
    -------
    str
        A CSS hex colour string.
    """
    return commodity_colour_for_property(col_name) or MULTI_SERIES_COLORWAY[index % len(MULTI_SERIES_COLORWAY)]


def with_alpha(colour, alpha):
    """Return *colour* as an ``rgba(...)`` string with the given *alpha*.

    Accepts a ``#rgb`` / ``#rrggbb`` hex; any other input (already-rgba or a
    named colour) is returned unchanged.

    Parameters
    ----------
    colour : str
    alpha : float
        Opacity in ``[0, 1]``.

    Returns
    -------
    str
    """
    import re
    match = re.fullmatch(r"#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})", str(colour).strip())
    if not match:
        return colour
    body = match.group(1)
    if len(body) == 3:
        body = "".join(ch * 2 for ch in body)
    red, green, blue = int(body[0:2], 16), int(body[2:4], 16), int(body[4:6], 16)
    return f"rgba({red}, {green}, {blue}, {alpha})"

# ---------------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------------


def get_colour(value, colour_map, fallback=FALLBACK_COLOUR):
    """Return the colour for *value* from *colour_map*, or *fallback* if absent.

    The lookup is case-insensitive; both the supplied value and the map keys
    are compared after stripping whitespace and converting to lower-case.

    Parameters
    ----------
    value : str
        Domain value to look up (e.g. ``"Cu"``, ``"granite"``).
    colour_map : dict
        Mapping of domain values to colour strings.
    fallback : str, optional
        Hex colour to return when *value* is not found.  Defaults to
        :data:`FALLBACK_COLOUR` (``"#7f7f7f"``).

    Returns
    -------
    str
        A CSS colour string (hex or named colour).
    """
    if not colour_map or value is None:
        return fallback
    key = str(value).strip()
    # Exact match first
    if key in colour_map:
        return colour_map[key]
    # Case-insensitive match
    key_lower = key.lower()
    for map_key, map_colour in colour_map.items():
        if str(map_key).strip().lower() == key_lower:
            return map_colour
    return fallback


def commodity_colour_for_property(col_name):
    """Return the commodity colour for a column name, or ``None`` if unrecognised.

    Column names like ``"Au_ppm"``, ``"Au_ppb"``, or ``"Au"`` all resolve to
    the gold colour because the element token ``"Au"`` is found in
    :data:`COMMODITY_COLOURS`.  Splitting is done on ``_``, ``-``, ``/``, and
    whitespace; each token is checked with an exact match first, then
    case-insensitively.

    Parameters
    ----------
    col_name : str
        Column / property name to examine.

    Returns
    -------
    str or None
        A CSS hex colour string, or ``None`` when no match is found.
    """
    import re
    if not col_name:
        return None
    for token in re.split(r'[_\-/\s]+', str(col_name)):
        if token in COMMODITY_COLOURS:
            return COMMODITY_COLOURS[token]
        low = token.lower()
        for key, colour in COMMODITY_COLOURS.items():
            if key.lower() == low:
                return colour
    return None


def resolve_colour_map(name_or_map):
    """Return a colour map dict from a name or pass through a user-supplied dict.

    Parameters
    ----------
    name_or_map : str or dict or None
        - ``None``: returns an empty dict.
        - A ``str``: looked up in :data:`BUILTIN_COLOUR_MAPS`.  Unknown names
          raise a ``ValueError``.
        - A ``dict``: returned as-is (user-supplied mapping).

    Returns
    -------
    dict
        Colour map dictionary.

    Raises
    ------
    ValueError
        If *name_or_map* is a string that does not match any built-in map.
    TypeError
        If *name_or_map* is neither ``None``, a ``str``, nor a ``dict``.
    """
    if name_or_map is None:
        return {}
    if isinstance(name_or_map, dict):
        return name_or_map
    if isinstance(name_or_map, str):
        key = name_or_map.strip().lower()
        if key in BUILTIN_COLOUR_MAPS:
            return BUILTIN_COLOUR_MAPS[key]
        available = ", ".join(sorted(BUILTIN_COLOUR_MAPS))
        raise ValueError(
            f"Unknown built-in colour map '{name_or_map}'. "
            f"Available maps: {available}"
        )
    raise TypeError(
        f"colour_map must be None, a str, or a dict; got {type(name_or_map).__name__!r}"
    )


def get_pattern(value, pattern_map, fallback=""):
    """Return the pattern shape for *value* from *pattern_map*, or *fallback*.

    Lookup semantics match :func:`get_colour` (case-insensitive, trimmed).
    The default fallback is ``""`` — a solid fill with no hatch overlay.

    Parameters
    ----------
    value : str
        Domain value to look up (e.g. ``"sandstone"``).
    pattern_map : dict
        Mapping of domain values to Plotly pattern shape strings.
    fallback : str, optional
        Shape returned when *value* is not found. Defaults to ``""`` (solid).

    Returns
    -------
    str
        A Plotly ``marker.pattern.shape`` string.
    """
    return get_colour(value, pattern_map, fallback=fallback)


def resolve_pattern_map(name_or_map):
    """Return a pattern map dict from a name or pass through a user-supplied dict.

    Parameters
    ----------
    name_or_map : str or dict or None
        - ``None``: returns an empty dict.
        - A ``str``: looked up in :data:`BUILTIN_PATTERN_MAPS`.  Unknown names
          raise a ``ValueError``.
        - A ``dict``: returned as-is (user-supplied mapping).

    Returns
    -------
    dict
        Pattern map dictionary (category → Plotly pattern shape).

    Raises
    ------
    ValueError
        If *name_or_map* is a string that does not match any built-in map.
    TypeError
        If *name_or_map* is neither ``None``, a ``str``, nor a ``dict``.
    """
    if name_or_map is None:
        return {}
    if isinstance(name_or_map, dict):
        return name_or_map
    if isinstance(name_or_map, str):
        key = name_or_map.strip().lower()
        if key in BUILTIN_PATTERN_MAPS:
            return BUILTIN_PATTERN_MAPS[key]
        available = ", ".join(sorted(BUILTIN_PATTERN_MAPS))
        raise ValueError(
            f"Unknown built-in pattern map '{name_or_map}'. "
            f"Available maps: {available}"
        )
    raise TypeError(
        f"pattern_map must be None, a str, or a dict; got {type(name_or_map).__name__!r}"
    )
