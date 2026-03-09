# Copyright (C) 2026 Darkmine Pty Ltd
# SPDX-License-Identifier: GPL-3.0-or-later

"""LAS file loader for downhole geophysics data.

Requires the optional ``lasio`` dependency::

    pip install lasio
    # or
    pip install "baselode[las]"

LAS (Log ASCII Standard) is the industry-standard format for wireline log data.
This loader reads LAS 1.2 and 2.0 files and returns a DataFrame consistent with
the baselode geophysics data model, using a single ``depth`` column (point schema)
rather than ``from``/``to`` intervals, since LAS measurements are always recorded
at a single measured depth.

Mapping from LAS sections to the baselode data model:

    ~WELL   WELL / UWI / API  →  hole_id
    ~WELL   NULL              →  null sentinel (default -999.25)
    ~CURVE  first curve       →  depth axis (DEPT / DEPTH / MD)
    ~CURVE  other curves      →  value columns (gamma, density, etc.)
    ~A      data rows         →  one row per sample depth
"""

import pandas as pd

from baselode.datamodel import HOLE_ID, DEPTH, GEOPHYSICS_NULL


def load_geophysics_las(source, hole_id=None, null_sentinel=None, keep_all=True, **kwargs):
    """Load downhole geophysics data from a LAS 1.2 or 2.0 file.

    Parameters
    ----------
    source : str, Path, or file-like
        Path to the LAS file, or a file-like object opened in text mode.
    hole_id : str, optional
        Override the hole identifier. When omitted the value is read from the
        LAS ``~WELL`` section (``WELL`` mnemonic, falling back to ``UWI`` then
        ``API``).
    null_sentinel : float, optional
        Value to replace with ``NaN``. When omitted the value is read from the
        ``NULL`` mnemonic in the ``~WELL`` section, defaulting to ``-999.25``
        if absent.
    keep_all : bool, optional
        If ``False``, drop columns outside the base schema (``hole_id``,
        ``depth``). Default ``True`` retains all value columns.
    **kwargs
        Additional keyword arguments forwarded to ``lasio.read()``.

    Returns
    -------
    pd.DataFrame
        Columns: ``hole_id``, ``depth``, and one column per geophysics channel
        (e.g. ``gamma``, ``density``, ``resistivity``).  Column names are the
        lowercased LAS curve mnemonics.  Null sentinels are replaced with
        ``NaN``.  Rows are sorted by ``hole_id`` then ``depth``.

    Raises
    ------
    ImportError
        If ``lasio`` is not installed.
    ValueError
        If the LAS file contains no curve data.
    """
    try:
        import lasio
    except ImportError:
        raise ImportError(
            "lasio is required for LAS file support. "
            'Install it with: pip install lasio  or  pip install "baselode[las]"'
        )

    if hasattr(source, "read"):
        las = lasio.read(source, **kwargs)
    else:
        las = lasio.read(str(source), **kwargs)

    # --- hole_id ---
    if hole_id is None:
        for mnem in ("WELL", "UWI", "API"):
            item = las.well.get(mnem)
            if item is not None:
                candidate = str(item.value).strip()
                if candidate:
                    hole_id = candidate
                    break
    if not hole_id:
        hole_id = "unknown"

    # --- null sentinel ---
    if null_sentinel is None:
        null_item = las.well.get("NULL")
        if null_item is not None:
            try:
                null_sentinel = float(null_item.value)
            except (ValueError, TypeError):
                null_sentinel = GEOPHYSICS_NULL
        else:
            null_sentinel = GEOPHYSICS_NULL

    # --- build DataFrame (lasio returns depth as index) ---
    df = las.df().reset_index()

    if df.empty or len(df.columns) < 2:
        raise ValueError(f"LAS file for hole '{hole_id}' contains no curve data")

    # Normalize column names to lowercase
    df.columns = [str(col).strip().lower() for col in df.columns]

    # First column is always depth (DEPT / DEPTH / MD etc.)
    depth_col = df.columns[0]
    df = df.rename(columns={depth_col: DEPTH})

    # Coerce numeric and replace null sentinel
    value_cols = [col for col in df.columns if col != DEPTH]
    for col in value_cols:
        df[col] = pd.to_numeric(df[col], errors="coerce")
        if null_sentinel is not None:
            df[col] = df[col].replace(null_sentinel, float("nan"))

    df[DEPTH] = pd.to_numeric(df[DEPTH], errors="coerce")
    df = df.dropna(subset=[DEPTH]).copy()

    # Prepend hole_id
    df.insert(0, HOLE_ID, hole_id)

    if not keep_all:
        df = df[[HOLE_ID, DEPTH]]

    return df.sort_values([HOLE_ID, DEPTH]).reset_index(drop=True)
