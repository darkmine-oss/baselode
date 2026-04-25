# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Darkmine Pty Ltd
"""DataFrame transforms: GSWA ``raw_gswa`` raw rows -> baselode canonical model.

Converters are pure DataFrame in / DataFrame out: the caller fetches rows
from the ``raw_gswa`` schema using the SQL builders in ``queries`` (or any
other client) and passes the resulting DataFrame here. Output shapes match
the baselode canonical model declared in ``baselode.drill.data`` and in
``columns.BASELODE_DATA_MODEL_SURFACE_SAMPLE``.

All converters:

- Rename raw GSWA columns to baselode names (snake_case).
- Drop helper / metadata columns the caller does not need.
- Coerce types where it is unambiguous (e.g. ``hole_id`` to ``str``).
- Delegate row-level validation (missing intervals, overlap, mid
  computation, ...) to the matching ``baselode.drill.data.load_*`` function
  by routing through it whenever practical.
"""

import pandas as pd
import geopandas as gpd

import baselode.drill.data
from baselode.datamodel import (
    HOLE_ID, FROM, TO, DEPTH, DIP, AZIMUTH, ALPHA, BETA,
    LATITUDE, LONGITUDE, EASTING, NORTHING, ELEVATION, CRS, COMMENTS, MID,
    EXTRA,
    DATASOURCE_HOLE_ID,
    SAMPLE_ID,
    DATASOURCE_SAMPLE_ID,
    DATASOURCE_SURFACE_SAMPLE_ID,
    SURFACE_SAMPLE_TYPE,
    BASELODE_DATA_MODEL_DRILL_COLLAR,
    BASELODE_DATA_MODEL_DRILL_SURVEY,
    BASELODE_DATA_MODEL_DRILL_GEOLOGY,
    BASELODE_DATA_MODEL_DRILL_ASSAY,
    BASELODE_DATA_MODEL_STRUCTURAL_POINT,
    BASELODE_DATA_MODEL_SURFACE_SAMPLE,
)
from baselode.adaptors.raw_gswa.columns import (
    GSWA_RAW_TO_BASELODE_COLLAR,
    GSWA_RAW_TO_BASELODE_SURVEY,
    GSWA_RAW_TO_BASELODE_INTERVAL,
    GSWA_RAW_TO_BASELODE_SURFACE_SAMPLE,
    GSWA_STRUCTURE_ATTR_TO_BASELODE,
    GSWA_GEOLOGY_ATTR_TO_BASELODE,
)


_VALID_EXTRAS_MODES = ("bundle", "spread", "drop")


def _apply_extras(df, mode, model, reserved=None):
    """Apply the chosen extras mode to a wide DataFrame produced by a load_*.

    - ``"bundle"`` (default): non-canonical columns get folded into the
      ``extra`` dict column (per :func:`baselode.drill.data.bundle_extras`).
    - ``"spread"``: leave the wide DataFrame alone.
    - ``"drop"``: keep only canonical (and ``reserved``) columns.
    """
    if mode is None or mode == "spread":
        return df
    if mode == "bundle":
        return baselode.drill.data.bundle_extras(df, model.keys(), reserved=reserved)
    if mode == "drop":
        keep = set(model.keys()) | set(reserved or [])
        cols = [c for c in df.columns if c in keep]
        return df[cols].copy()
    raise ValueError(
        f"extras must be one of {_VALID_EXTRAS_MODES}, got {mode!r}"
    )


# --------------------------------------------------------------------- helpers

def _rename(df, mapping):
    """Rename only columns present in ``df`` using ``mapping``."""
    return df.rename(columns={k: v for k, v in mapping.items() if k in df.columns})


def _drop_internal(df):
    """Drop columns whose names start with ``_`` (internal join keys)."""
    return df.drop(columns=[c for c in df.columns if isinstance(c, str) and c.startswith("_")],
                   errors="ignore")


def _epsg_from_datum_zone(datum, zone):
    """Best-effort EPSG resolver for the GSWA datum/zone columns.

    Maps the most common Western Australian projections used by GSWA
    (GDA94 + MGA zones 49–52, GDA2020 + MGA zones 49–52). Returns ``None``
    when the datum/zone combination is unknown — the caller can still
    keep the raw ``datum``/``projection``/``zone`` columns for inspection.
    """
    if datum is None or zone is None:
        return None
    d = str(datum).strip().upper().replace(" ", "")
    try:
        z = int(str(zone).strip().split(".")[0])
    except (ValueError, AttributeError):
        return None
    if d in {"GDA94", "GDA-94"}:
        if 49 <= z <= 56:
            return f"EPSG:{28300 + z}"
    if d in {"GDA2020", "GDA-2020"}:
        if 46 <= z <= 59:
            return f"EPSG:{7800 + z}"   # 7849 = GDA2020 / MGA zone 49 etc.
    return None


def pivot_eav(long_df, parent_key, attr_col="AttributeColumn",
              value_col="AttributeValue", keep=None):
    """Pivot an EAV ``*attr`` table onto its parent row.

    Parameters
    ----------
    long_df : pd.DataFrame
        Result of joining a parent interval/sample table to its ``*attr``
        EAV table — one row per (parent, attribute) pair.
    parent_key : str
        Column that identifies the parent row (e.g. ``"DHGeologyId"``).
    attr_col, value_col : str
        Names of the EAV attribute and value columns.
    keep : list of str, optional
        Parent-row columns to carry through (e.g. ``["HoleId", "FromDepth",
        "ToDepth"]``). Defaults to every non-EAV column.

    Returns
    -------
    pd.DataFrame
        One row per parent, with attribute names pivoted to columns.
    """
    if long_df.empty:
        return long_df.copy()
    if keep is None:
        keep = [c for c in long_df.columns if c not in {attr_col, value_col}]
    if parent_key not in keep:
        keep = [parent_key, *keep]

    # Drop rows that have no attribute (parent row with zero attrs).
    has_attr = long_df[attr_col].notna() & (long_df[attr_col].astype(str) != "")
    no_attr_parents = long_df.loc[~has_attr, keep].drop_duplicates(subset=[parent_key])

    pivoted_attrs = (
        long_df.loc[has_attr]
        .pivot_table(
            index=parent_key,
            columns=attr_col,
            values=value_col,
            aggfunc="first",
            sort=False,
        )
        .reset_index()
    )
    parent_rows = long_df.loc[has_attr, keep].drop_duplicates(subset=[parent_key])
    pivoted = parent_rows.merge(pivoted_attrs, on=parent_key, how="left")

    if not no_attr_parents.empty:
        pivoted = pd.concat([pivoted, no_attr_parents], ignore_index=True, sort=False)

    pivoted.columns.name = None
    return pivoted


# ---------------------------------------------------------------------- collar

def convert_collars(raw, *, extras="bundle", crs=None):
    """Convert raw_gswa collar rows -> baselode collars (GeoDataFrame).

    Expected input shape: result of :func:`build_collar_query`. One row per
    collar, with at least ``HoleId``, ``Latitude``, ``Longitude`` and the
    optional projected/elevation columns.

    The returned object is a ``geopandas.GeoDataFrame`` produced by
    :func:`baselode.drill.data.load_collars`, which validates required
    columns and attaches a point geometry in WGS84 (or in the projected
    CRS if ``Easting``/``Northing`` are present).

    Parameters
    ----------
    raw : pd.DataFrame
    extras : {"bundle", "spread", "drop"}, optional
        How to handle source columns that fall outside the canonical
        baselode collar model:

        - ``"bundle"`` (default) — fold them into a single ``extra`` dict
          column per row (``hole_type``, ``max_depth``, ``anumber``, etc.).
        - ``"spread"`` — leave them as top-level columns alongside the
          canonical ones (matches the historical ``keep_all=True`` shape).
        - ``"drop"`` — discard them entirely.
    crs : str, optional
        Override CRS to use when building the geometry. If omitted and
        easting/northing are present, the adaptor tries to resolve from the
        ``Datum``/``Zone`` columns.
    """
    if raw is None or raw.empty:
        # load_collars needs lat/lon or easting/northing to build a geometry,
        # so construct an empty GeoDataFrame directly for the empty case.
        return gpd.GeoDataFrame(
            {HOLE_ID: pd.Series(dtype=str),
             DATASOURCE_HOLE_ID: pd.Series(dtype=str),
             EXTRA: pd.Series(dtype=object)},
            geometry=gpd.points_from_xy([], []),
            crs=crs or "EPSG:4326",
        )

    df = _rename(raw, GSWA_RAW_TO_BASELODE_COLLAR)
    df[HOLE_ID] = df[HOLE_ID].astype(str).str.strip()

    # CompanyHoleId is often null in GSWA; load_collars will backfill
    # datasource_hole_id from hole_id when missing.
    if DATASOURCE_HOLE_ID in df.columns:
        df[DATASOURCE_HOLE_ID] = df[DATASOURCE_HOLE_ID].astype(object)

    if crs is None and EASTING in df.columns and NORTHING in df.columns:
        # Datum + Zone are per-row but practically constant within a query;
        # resolve from the first non-null pair.
        first = df.dropna(subset=["datum", "zone"]).head(1) if {"datum", "zone"}.issubset(df.columns) else pd.DataFrame()
        if not first.empty:
            crs = _epsg_from_datum_zone(first.iloc[0]["datum"], first.iloc[0]["zone"])

    gdf = baselode.drill.data.load_collars(df, crs=crs, keep_all=True)
    return _apply_extras(
        gdf, extras,
        BASELODE_DATA_MODEL_DRILL_COLLAR,
        reserved={"geometry"},
    )


# --------------------------------------------------------------------- surveys

def convert_surveys(raw, *, extras="bundle"):
    """Convert raw_gswa survey rows -> baselode surveys.

    Expected input: result of :func:`build_survey_query` (joined back to
    ``dbo_collar`` so ``HoleId`` is present).

    See :func:`convert_collars` for the meaning of ``extras``.
    """
    if raw is None or raw.empty:
        empty = baselode.drill.data.load_surveys(
            pd.DataFrame({HOLE_ID: pd.Series(dtype=str), DEPTH: pd.Series(dtype=float),
                          AZIMUTH: pd.Series(dtype=float), DIP: pd.Series(dtype=float)}),
            keep_all=True,
        )
        return _apply_extras(empty, extras,
                             BASELODE_DATA_MODEL_DRILL_SURVEY)
    df = _rename(raw, GSWA_RAW_TO_BASELODE_SURVEY)
    df[HOLE_ID] = df[HOLE_ID].astype(str).str.strip()
    df = _drop_internal(df)
    out = baselode.drill.data.load_surveys(df, keep_all=True)
    return _apply_extras(out, extras,
                         BASELODE_DATA_MODEL_DRILL_SURVEY)


# --------------------------------------------------------------------- geology

def convert_geology(raw, *, extras="bundle"):
    """Convert raw_gswa geology long-form rows -> baselode geology intervals.

    Expected input: result of :func:`build_geology_query` (one row per
    (interval, attribute) pair). Pivots the EAV attributes onto the
    interval, maps common attribute names (``Lith1`` → ``geology_code``,
    ``GeologyComment`` → ``comments``, etc.), then routes through
    :func:`baselode.drill.data.load_geology` for validation and
    midpoint computation.

    See :func:`convert_collars` for the meaning of ``extras``.
    """
    if raw is None or raw.empty:
        empty = pd.DataFrame({
            HOLE_ID: pd.Series(dtype=str),
            FROM: pd.Series(dtype=float),
            TO: pd.Series(dtype=float),
            "geology_code": pd.Series(dtype=str),
        })
        out = baselode.drill.data.load_geology(empty, keep_all=True)
        return _apply_extras(out, extras,
                             BASELODE_DATA_MODEL_DRILL_GEOLOGY)

    if "DHGeologyId" not in raw.columns:
        raise ValueError(
            "convert_geology expects a 'DHGeologyId' column — use "
            "build_geology_query() to fetch the long-form rows."
        )

    keep = [c for c in ["HoleId", "DHGeologyId", "CollarId", "FromDepth", "ToDepth"]
            if c in raw.columns]
    pivoted = pivot_eav(raw, parent_key="DHGeologyId", keep=keep)

    pivoted = _rename(pivoted, GSWA_RAW_TO_BASELODE_INTERVAL)
    pivoted = _rename(pivoted, GSWA_GEOLOGY_ATTR_TO_BASELODE)
    pivoted = _drop_internal(pivoted)
    pivoted = pivoted.drop(columns=["DHGeologyId"], errors="ignore")
    pivoted[HOLE_ID] = pivoted[HOLE_ID].astype(str).str.strip()

    out = baselode.drill.data.load_geology(pivoted, keep_all=True)
    return _apply_extras(out, extras,
                         BASELODE_DATA_MODEL_DRILL_GEOLOGY)


# ---------------------------------------------------------------------- assays

def convert_assays(raw, *, extras="bundle", value_col="PPMValue"):
    """Convert raw_gswa long-form geochemistry assays -> baselode assays.

    Expected input: result of :func:`build_assay_query`. Pivots the EAV
    attributes (``AttributeColumn`` → column name, ``PPMValue`` → numeric
    value) into a wide assay table.

    Note: with ``extras="bundle"`` (the default) every analyte column also
    ends up in the per-row ``extra`` dict — the canonical assay model only
    declares ``hole_id``/``from``/``to``/``mid`` as fixed columns, so
    analyte values flow into the extras bucket. Use ``extras="spread"`` if
    you want to plot/aggregate analytes as top-level columns.

    Parameters
    ----------
    value_col : str, optional
        Which EAV value column to pivot. Default ``"PPMValue"`` (parsed
        numeric ppm). Use ``"AttributeValue"`` to keep raw text values.
    extras : {"bundle", "spread", "drop"}, optional
        See :func:`convert_collars`. Default ``"bundle"``.
    """
    if raw is None or raw.empty:
        empty = pd.DataFrame({
            HOLE_ID: pd.Series(dtype=str),
            FROM: pd.Series(dtype=float),
            TO: pd.Series(dtype=float),
        })
        out = baselode.drill.data.load_assays(empty, keep_all=True)
        return _apply_extras(out, extras,
                             BASELODE_DATA_MODEL_DRILL_ASSAY)

    if "DHGeochemistryId" not in raw.columns:
        raise ValueError(
            "convert_assays expects a 'DHGeochemistryId' column — use "
            "build_assay_query() to fetch the long-form rows."
        )

    keep_cols = [c for c in ["HoleId", "DHGeochemistryId", "CollarId",
                             "SampleId", "CompanySampleId",
                             "FromDepth", "ToDepth"]
                 if c in raw.columns]

    pivoted = pivot_eav(raw, parent_key="DHGeochemistryId", attr_col="AttributeColumn",
                        value_col=value_col, keep=keep_cols)
    pivoted = _rename(pivoted, GSWA_RAW_TO_BASELODE_INTERVAL)
    pivoted = _drop_internal(pivoted)
    pivoted = pivoted.drop(columns=["DHGeochemistryId"], errors="ignore")
    pivoted[HOLE_ID] = pivoted[HOLE_ID].astype(str).str.strip()

    out = baselode.drill.data.load_assays(pivoted, keep_all=True)
    return _apply_extras(out, extras,
                         BASELODE_DATA_MODEL_DRILL_ASSAY)


def convert_assays_flat(raw, *, extras="bundle"):
    """Convert ``gsd_dhassayflat`` (already-pivoted) -> baselode assays.

    The flat table already has analytes as columns (``Au_PPM``, ``Cu_PPM``,
    ...). We just rename the identity / interval columns and route through
    :func:`baselode.drill.data.load_assays`.

    See :func:`convert_assays` for the meaning of ``extras`` and the
    interaction with analyte columns.
    """
    if raw is None or raw.empty:
        empty = pd.DataFrame({HOLE_ID: pd.Series(dtype=str),
                              FROM: pd.Series(dtype=float),
                              TO: pd.Series(dtype=float)})
        out = baselode.drill.data.load_assays(empty, keep_all=True)
        return _apply_extras(out, extras,
                             BASELODE_DATA_MODEL_DRILL_ASSAY)
    df = _rename(raw, GSWA_RAW_TO_BASELODE_INTERVAL)
    df = _drop_internal(df)
    if HOLE_ID not in df.columns:
        # gsd_dhassayflat has Collarid + CompanyHoleId but not HoleId; the
        # `fetch_assays_flat` helper attaches HoleId via the parent collar
        # before returning. If a caller passes raw rows from /tables/.../rows
        # directly they need to add it themselves.
        raise ValueError(
            "convert_assays_flat input is missing 'HoleId' (the gsd_dhassayflat "
            "table doesn't carry it natively). Either fetch through "
            "raw_gswa.api.fetch_assays_flat, or attach HoleId manually before "
            "calling this converter (e.g. via a Collarid -> HoleId join with "
            "dbo_collar)."
        )
    df[HOLE_ID] = df[HOLE_ID].astype(str).str.strip()
    out = baselode.drill.data.load_assays(df, keep_all=True)
    return _apply_extras(out, extras,
                         BASELODE_DATA_MODEL_DRILL_ASSAY)


# ------------------------------------------------------------------- structure

def convert_structures(raw, *, extras="bundle", interval_position="from"):
    """Convert raw_gswa structure long-form rows -> baselode structural points.

    GSWA stores structural measurements as ``(FromDepth, ToDepth)`` intervals
    with EAV orientation attributes. The baselode structural-point model
    expects a single ``depth`` per measurement, so we collapse each interval
    to a depth using ``interval_position`` (``"from"``, ``"to"`` or
    ``"mid"``). Structural intervals in GSWA are typically thin or
    zero-length, so the choice rarely matters.

    Routes through :func:`baselode.drill.data.load_structures`.

    See :func:`convert_collars` for the meaning of ``extras``.

    Note: when a structure carries multiple raw orientation attributes that
    map to the same baselode column (e.g. both ``Dip`` and ``Dip_Calc``), the
    last rename wins for that row. Restrict the EAV pull via
    ``build_structure_query(attribute_columns=...)`` if the source has both
    measured and computed orientations and you want a specific one.
    """
    if interval_position not in {"from", "to", "mid"}:
        raise ValueError("interval_position must be 'from', 'to' or 'mid'")

    if raw is None or raw.empty:
        empty = pd.DataFrame({HOLE_ID: pd.Series(dtype=str),
                              DEPTH: pd.Series(dtype=float)})
        out = baselode.drill.data.load_structures(empty, keep_all=True)
        return _apply_extras(out, extras,
                             BASELODE_DATA_MODEL_STRUCTURAL_POINT)

    if "DHStructureId" not in raw.columns:
        raise ValueError(
            "convert_structures expects a 'DHStructureId' column — use "
            "build_structure_query() to fetch the long-form rows."
        )

    keep = [c for c in ["HoleId", "DHStructureId", "CollarId", "FromDepth", "ToDepth"]
            if c in raw.columns]
    pivoted = pivot_eav(raw, parent_key="DHStructureId", keep=keep)

    pivoted = _rename(pivoted, GSWA_RAW_TO_BASELODE_INTERVAL)
    pivoted = _rename(pivoted, GSWA_STRUCTURE_ATTR_TO_BASELODE)
    pivoted = _drop_internal(pivoted)
    pivoted = pivoted.drop(columns=["DHStructureId"], errors="ignore")
    pivoted[HOLE_ID] = pivoted[HOLE_ID].astype(str).str.strip()

    # Collapse interval to a single depth.
    frm = pd.to_numeric(pivoted.get(FROM), errors="coerce")
    to = pd.to_numeric(pivoted.get(TO), errors="coerce")
    if interval_position == "from":
        pivoted[DEPTH] = frm
    elif interval_position == "to":
        pivoted[DEPTH] = to.where(to.notna(), frm)
    else:  # mid
        pivoted[DEPTH] = ((frm + to) / 2.0).where(to.notna(), frm)

    pivoted = pivoted.drop(columns=[FROM, TO], errors="ignore")

    out = baselode.drill.data.load_structures(pivoted, keep_all=True)
    return _apply_extras(out, extras,
                         BASELODE_DATA_MODEL_STRUCTURAL_POINT)


# ------------------------------------------------------------- surface samples

def _surface_sample_postprocess(df, *, extras, crs):
    """Common tail for surface-sample converters.

    Coerces the sample identifier, backfills
    ``datasource_surface_sample_id`` from ``sample_id`` when missing,
    resolves CRS from datum/zone when projected coordinates are present,
    then applies the chosen extras mode against
    ``BASELODE_DATA_MODEL_SURFACE_SAMPLE``.

    Returns a plain ``pd.DataFrame``. We do not promote to GeoDataFrame
    here because surface samples don't yet have a top-level baselode loader
    that owns the geometry contract — callers that want geometry can use
    ``geopandas.GeoDataFrame(df, geometry=gpd.points_from_xy(...))``.
    """
    # Backfill ``sample_id`` when the source table had no ``SampleId`` column
    # (e.g. the already-pivoted ``gsd_ssassayflat`` table maps ``Id`` to
    # ``datasource_sample_id`` rather than ``sample_id``). Use the company
    # identifier if available; fall back to the internal datasource id.
    if SAMPLE_ID not in df.columns:
        if DATASOURCE_SURFACE_SAMPLE_ID in df.columns:
            df[SAMPLE_ID] = df[DATASOURCE_SURFACE_SAMPLE_ID]
        elif DATASOURCE_SAMPLE_ID in df.columns:
            df[SAMPLE_ID] = df[DATASOURCE_SAMPLE_ID]
        else:
            raise ValueError(f"Surface sample table missing column: {SAMPLE_ID}")

    df[SAMPLE_ID] = df[SAMPLE_ID].astype(str).str.strip()
    if DATASOURCE_SURFACE_SAMPLE_ID not in df.columns:
        df[DATASOURCE_SURFACE_SAMPLE_ID] = df[SAMPLE_ID]
    else:
        # Backfill rows where the source-side id is null with the public id.
        df[DATASOURCE_SURFACE_SAMPLE_ID] = df[DATASOURCE_SURFACE_SAMPLE_ID].where(
            df[DATASOURCE_SURFACE_SAMPLE_ID].notna(), df[SAMPLE_ID]
        )

    has_xy = EASTING in df.columns and NORTHING in df.columns
    if crs is None and has_xy and {"datum", "zone"}.issubset(df.columns):
        first = df.dropna(subset=["datum", "zone"]).head(1)
        if not first.empty:
            crs = _epsg_from_datum_zone(first.iloc[0]["datum"], first.iloc[0]["zone"])
    if crs is not None:
        df[CRS] = crs

    out = df.reset_index(drop=True)
    return _apply_extras(out, extras, BASELODE_DATA_MODEL_SURFACE_SAMPLE)


def convert_surface_samples(raw, *, extras="bundle", crs=None, value_col="PPMValue"):
    """Convert raw_gswa surface samples (long-form EAV) -> baselode surface samples.

    Expected input: result of :func:`build_surface_sample_query`. Pivots the
    per-analyte EAV rows into wide columns (one column per analyte) and
    renames identity/coord columns to baselode names.

    With ``extras="bundle"`` (the default) every analyte plus the lab /
    metadata columns end up in the per-row ``extra`` dict. The top-level
    columns are exactly the baselode surface-sample model. See
    :func:`convert_collars` for the meaning of ``extras``.
    """
    if raw is None or raw.empty:
        return pd.DataFrame({c: pd.Series(dtype=(object if t is dict else t))
                             for c, t in BASELODE_DATA_MODEL_SURFACE_SAMPLE.items()})

    keep_cols = [c for c in [
        "Id", "SampleId", "CompanySampleId", "Dataset", "Anumber",
        "SurfaceSampleType", "Latitude", "Longitude",
        "Easting", "Northing", "Datum", "Projection", "Zone",
    ] if c in raw.columns]

    # Use the public SampleId as the parent key when present, fall back to Id.
    parent_key = "SampleId" if "SampleId" in raw.columns else "Id"

    if "AttributeColumn" in raw.columns:
        pivoted = pivot_eav(raw, parent_key=parent_key, attr_col="AttributeColumn",
                            value_col=value_col, keep=keep_cols)
    else:
        pivoted = raw[keep_cols].drop_duplicates(subset=[parent_key]).reset_index(drop=True)

    pivoted = _rename(pivoted, GSWA_RAW_TO_BASELODE_SURFACE_SAMPLE)
    pivoted = _drop_internal(pivoted)

    return _surface_sample_postprocess(pivoted, extras=extras, crs=crs)


def convert_surface_samples_flat(raw, *, extras="bundle", crs=None):
    """Convert ``gsd_ssassayflat`` (already-pivoted) -> baselode surface samples.

    The flat surface-sample table already has analytes as wide columns. We
    just rename identity / location columns and apply the standard
    surface-sample post-processing. See :func:`convert_collars` for the
    meaning of ``extras``.
    """
    if raw is None or raw.empty:
        return pd.DataFrame({c: pd.Series(dtype=(object if t is dict else t))
                             for c, t in BASELODE_DATA_MODEL_SURFACE_SAMPLE.items()})

    df = raw
    df = _rename(df, GSWA_RAW_TO_BASELODE_SURFACE_SAMPLE)
    df = _drop_internal(df)
    return _surface_sample_postprocess(df, extras=extras, crs=crs)
