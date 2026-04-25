# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Darkmine Pty Ltd
"""HTTP client for the Darkmine Raw GSWA Data API.

The same GSWA tables that the ``queries`` module targets via SQL are also
exposed by Darkmine as a read-only HTTP API under ``/v1/raw/gswa``. This
module wraps that API and produces pandas DataFrames in the same shape the
SQL builders produce, so the existing ``convert_*`` functions consume API
results unchanged.

Two layers:

1. :class:`RawGswaApiClient` — thin HTTP wrapper. One method per documented
   endpoint (``list_tables``, ``get_schema``, ``fetch_table_rows``,
   ``iter_table_rows``, ``fetch_collar_family``,
   ``fetch_surface_sample_family``).

2. ``fetch_*`` module-level helpers — mirror the ``build_*_query`` interfaces
   from ``queries`` (``hole_ids``, ``extent``, ``analytes``, ...) and stitch
   the API responses (which return one table at a time) into the long-form
   DataFrames the converters expect.

Spatial filtering takes :class:`baselode.extent.Extent` instances on the
``extent=`` keyword of every fetcher. The Extent is reprojected to
EPSG:4326 lon/lat via :meth:`baselode.extent.Extent.to_crs` before the
request is sent (``pyproj`` does the transform when needed). Bare 4-tuples
are not accepted — wrap them in an Extent so the CRS is explicit.

Typical use::

    from baselode.adaptors import raw_gswa

    client = raw_gswa.RawGswaApiClient(
        "https://api.darkmine.ai", auth_token="...",
    )
    raw = raw_gswa.fetch_collars(client, hole_ids=["DD123456"])
    collars = raw_gswa.convert_collars(raw)

The HTTP client requires the optional ``requests`` dependency
(``pip install baselode[api]`` or ``pip install requests``). Callers can also
pass any ``requests``-compatible session (e.g. for retry / auth plumbing
they already have) via the ``session=`` argument.
"""

import pandas as pd

import baselode.extent

try:
    import requests as _requests
except ImportError:
    _requests = None


GSWA_API_PATH = "/v1/raw/gswa"
DEFAULT_TIMEOUT = 60.0
DEFAULT_PAGE_SIZE = 1000
MAX_PAGE_SIZE = 10000


class RawGswaApiClient:
    """Thin HTTP wrapper around the Darkmine Raw GSWA Data API.

    Parameters
    ----------
    base_url : str
        Host (and optional prefix) the API is reachable at — e.g.
        ``"https://api.darkmine.ai"``. The standard ``/v1/raw/gswa`` path
        is appended by default; override with ``api_path=`` if your
        deployment differs.
    auth_token : str, optional
        Bearer token to send as ``Authorization: Bearer <token>``.
    headers : dict, optional
        Extra HTTP headers to merge onto every request.
    session : requests.Session, optional
        Pre-configured ``requests`` session. Lets the caller bring their
        own retry adapter, auth, proxy, etc. When omitted a fresh
        ``requests.Session`` is created.
    timeout : float, optional
        Per-request timeout in seconds (default ``60``).
    api_path : str, optional
        Path prefix appended to ``base_url`` (default ``"/v1/raw/gswa"``).
    """

    def __init__(self, base_url, *, auth_token=None, headers=None,
                 session=None, timeout=DEFAULT_TIMEOUT, api_path=GSWA_API_PATH):
        if _requests is None and session is None:
            raise ImportError(
                "RawGswaApiClient requires the 'requests' package. Install "
                "it with `pip install requests` (or `pip install baselode[api]`), "
                "or pass an explicit `session=` of your own."
            )
        self.base_url = base_url.rstrip("/") + (api_path or "")
        self.timeout = timeout
        self._session = session if session is not None else _requests.Session()
        if auth_token:
            self._session.headers["Authorization"] = f"Bearer {auth_token}"
        if headers:
            self._session.headers.update(headers)

    # --------------------------------------------------------------- internal

    def _get(self, path, params=None):
        url = f"{self.base_url}{path}"
        clean = {k: v for k, v in (params or {}).items() if v is not None}
        response = self._session.get(url, params=clean, timeout=self.timeout)
        response.raise_for_status()
        return response.json()

    # --------------------------------------------------------------- /tables

    def list_tables(self):
        """``GET /tables`` — list available raw GSWA tables.

        Returns the ``tables`` array as a list of metadata dicts (each
        with ``name``, ``schema``, ``description``, ``query_methods``,
        ``family``, ``role``).
        """
        return self._get("/tables").get("tables", [])

    def get_schema(self, table_name):
        """``GET /tables/{table}/schema`` — full schema for one table.

        Returns the response dict (``name``, ``schema``, ``description``,
        ``query_methods``, ``relationships``, ``columns``).
        """
        return self._get(f"/tables/{table_name}/schema")

    def fetch_table_rows(self, table_name, *,
                         collar_id=None, hole_id=None,
                         company_hole_id=None, dataset=None,
                         surface_sample_id=None, sample_id=None,
                         sample_identifier=None, company_sample_id=None,
                         sample_dataset=None,
                         anumber=None, parent_id=None,
                         extent=None, limit=None, offset=None,
                         output=None):
        """``GET /tables/{table}/rows`` — one page of rows from one table.

        Returns a ``pandas.DataFrame`` whose columns match the API's
        ``columns`` array.

        ``extent`` requires a :class:`baselode.extent.Extent` instance
        (any CRS — corners are reprojected to WGS 84 via ``pyproj`` when
        needed). Bare 4-tuples are not accepted; wrap them in an Extent
        so the CRS is explicit.

        Special case: when ``output="geojson"`` (only valid for
        ``dbo_collar``), returns the raw GeoJSON ``FeatureCollection``
        dict instead of a DataFrame.

        Selectors not supported by the chosen table are silently ignored
        by the API. Inspect ``query_methods`` from :meth:`get_schema`
        first when in doubt.
        """
        params = {
            "collar_id": collar_id, "hole_id": hole_id,
            "company_hole_id": company_hole_id, "dataset": dataset,
            "surface_sample_id": surface_sample_id,
            "sample_id": sample_id,
            "sample_identifier": sample_identifier,
            "company_sample_id": company_sample_id,
            "sample_dataset": sample_dataset,
            "anumber": anumber, "parent_id": parent_id,
            "limit": limit, "offset": offset, "output": output,
        }
        if extent is not None:
            if not isinstance(extent, baselode.extent.Extent):
                raise TypeError(
                    f"extent must be a baselode.extent.Extent, got "
                    f"{type(extent).__name__}."
                )
            wgs84 = extent.to_crs("EPSG:4326")
            params["min_lon"] = wgs84.xmin
            params["min_lat"] = wgs84.ymin
            params["max_lon"] = wgs84.xmax
            params["max_lat"] = wgs84.ymax
        body = self._get(f"/tables/{table_name}/rows", params=params)
        if output == "geojson":
            return body
        return _rows_to_df(body)

    def iter_table_rows(self, table_name, *, page_size=DEFAULT_PAGE_SIZE, **selectors):
        """Generator yielding successive pages of rows as DataFrames.

        Walks ``offset`` until the API returns fewer rows than the page
        size. Useful for tables that exceed the per-request ``limit``
        cap (10 000 rows).

        ``limit`` and ``offset`` cannot be passed via ``selectors`` —
        this method controls them itself via ``page_size``. Use
        :meth:`fetch_table_rows` directly for a single bounded request.
        """
        for reserved in ("limit", "offset"):
            if reserved in selectors:
                raise TypeError(
                    f"iter_table_rows manages {reserved!r} via page_size — "
                    "remove it from your selectors, or call fetch_table_rows "
                    "for a single bounded request."
                )
        if page_size > MAX_PAGE_SIZE:
            page_size = MAX_PAGE_SIZE
        offset = 0
        while True:
            page = self.fetch_table_rows(
                table_name, limit=page_size, offset=offset, **selectors,
            )
            if not isinstance(page, pd.DataFrame):
                # output=geojson — yield once and stop.
                yield page
                return
            if page.empty:
                return
            yield page
            if len(page) < page_size:
                return
            offset += len(page)

    def fetch_all_table_rows(self, table_name, *, page_size=DEFAULT_PAGE_SIZE, **selectors):
        """Convenience: paginate all rows and return a single DataFrame."""
        frames = list(self.iter_table_rows(table_name, page_size=page_size, **selectors))
        if not frames:
            return pd.DataFrame()
        return pd.concat(frames, ignore_index=True)

    # ----------------------------------------------------------- /family

    def fetch_collar_family(self, *, collar_id=None, hole_id=None,
                            company_hole_id=None, dataset=None, anumber=None,
                            include_mrt=False, limit_per_table=None):
        """``GET /collar-family`` — collar root + every related child table.

        Returns a dict with ``query``, ``include_mrt``, ``matched_collars``,
        ``matched_collar_count`` and ``tables`` (a dict keyed by table name,
        each value being a ``pandas.DataFrame``).
        """
        params = {
            "collar_id": collar_id, "hole_id": hole_id,
            "company_hole_id": company_hole_id, "dataset": dataset,
            "anumber": anumber,
            "include_mrt": _bool_param(include_mrt),
            "limit_per_table": limit_per_table,
        }
        body = self._get("/collar-family", params=params)
        return _wrap_family(body, "matched_collars", "matched_collar_count")

    def fetch_surface_sample_family(self, *, surface_sample_id=None,
                                    sample_identifier=None, company_sample_id=None,
                                    sample_dataset=None, anumber=None,
                                    include_mrt=False, limit_per_table=None):
        """``GET /surface-sample-family`` — surface sample + every related table."""
        params = {
            "surface_sample_id": surface_sample_id,
            "sample_identifier": sample_identifier,
            "company_sample_id": company_sample_id,
            "sample_dataset": sample_dataset,
            "anumber": anumber,
            "include_mrt": _bool_param(include_mrt),
            "limit_per_table": limit_per_table,
        }
        body = self._get("/surface-sample-family", params=params)
        return _wrap_family(body, "matched_surface_samples", "matched_surface_sample_count")


# --------------------------------------------------------------------- helpers

def _bool_param(v):
    return "true" if v else "false"


def _rows_to_df(body):
    """Build a DataFrame from a ``{"columns": [...], "rows": [...]}`` body.

    The API may emit ``rows`` as an empty list when no records match. In
    that case we still return a DataFrame with the documented columns so
    downstream merges/concats stay well-behaved.
    """
    rows = body.get("rows") or []
    columns = body.get("columns") or []
    if not rows:
        return pd.DataFrame(columns=columns)
    df = pd.DataFrame(rows)
    if columns:
        present = [c for c in columns if c in df.columns]
        if present:
            df = df[present]
    return df


def _wrap_family(body, matched_key, count_key):
    tables_in = body.get("tables") or {}
    return {
        "query": body.get("query"),
        "include_mrt": body.get("include_mrt", False),
        matched_key: body.get(matched_key, []),
        count_key: body.get(count_key, 0),
        "tables": {name: _rows_to_df(t) for name, t in tables_in.items()},
    }


def _ensure_iter(values):
    """Coerce to a list. ``None`` -> ``[]``; a bare string -> ``[string]``."""
    if values is None:
        return []
    if isinstance(values, (str, bytes)):
        return [values]
    return list(values)


def _attach_hole_id(df, collar_df, fk="CollarId"):
    """Add a ``HoleId`` column to ``df`` by joining on ``CollarId``.

    The API row endpoints for child tables return only the table's own
    columns — they don't include the ``HoleId`` from the parent collar.
    This helper reproduces the join the SQL builders do in-database.
    """
    if collar_df.empty or fk not in df.columns or "Id" not in collar_df.columns:
        return df
    id_to_hole = dict(zip(collar_df["Id"], collar_df.get("HoleId", pd.Series(dtype=object))))
    out = df.copy()
    out["HoleId"] = out[fk].map(id_to_hole)
    return out


def _merge_collar_family(tables):
    """Merge dbo_collar + dbo_collarcoordinate + dbo_collarelevation.

    Reproduces the column shape ``build_collar_query`` returns.
    """
    collar = tables.get("dbo_collar", pd.DataFrame()).copy()
    if collar.empty:
        return collar
    if "Id" in collar.columns:
        collar = collar.rename(columns={"Id": "CollarId"})

    out = collar
    coord = tables.get("dbo_collarcoordinate", pd.DataFrame())
    if not coord.empty:
        cols = [c for c in coord.columns if c != "Id"]
        out = out.merge(coord[cols], on="CollarId", how="left",
                        suffixes=("", "__coord"))

    elev = tables.get("dbo_collarelevation", pd.DataFrame())
    if not elev.empty:
        elev_renamed = elev.rename(columns={"CollarID": "CollarId"})
        cols = [c for c in elev_renamed.columns if c != "Id"]
        out = out.merge(elev_renamed[cols], on="CollarId", how="left",
                        suffixes=("", "__elev"))
    return out


def _merge_eav(parent_table, attr_table, parent_alias, fk_col,
               collar_table=None, attr_filter=None):
    """Merge a parent interval table with its EAV ``*attr`` child.

    Reproduces the long-form shape ``build_geology_query`` /
    ``build_assay_query`` / ``build_structure_query`` return: one row per
    (interval, attribute) pair, with ``HoleId`` attached from
    ``dbo_collar`` and the parent's ``Id`` exposed as ``parent_alias``
    (e.g. ``"DHGeologyId"``).
    """
    if parent_table.empty:
        return parent_table.copy()
    parent = parent_table.copy()
    if collar_table is not None:
        parent = _attach_hole_id(parent, collar_table)
    if "Id" in parent.columns:
        parent = parent.rename(columns={"Id": parent_alias})
    if attr_table is None or attr_table.empty:
        return parent
    attrs = attr_table
    if attr_filter and "AttributeColumn" in attrs.columns:
        attrs = attrs[attrs["AttributeColumn"].isin(set(attr_filter))]
    drop_id = [c for c in ["Id"] if c in attrs.columns]
    return parent.merge(
        attrs.drop(columns=drop_id),
        left_on=parent_alias, right_on=fk_col, how="left",
        suffixes=("", "__attr"),
    )


# ------------------------------------------------------- high-level fetchers

def fetch_collars(client, *, hole_ids=None, extent=None, limit=None):
    """Fetch collars in the same shape :func:`build_collar_query` returns.

    Two paths:

    - ``extent=`` — uses ``GET /tables/dbo_collar/rows`` (single request
      when ``limit`` is supplied, otherwise paginated via
      ``fetch_all_table_rows``). ``extent`` is a
      :class:`baselode.extent.Extent`. Projected coordinates / elevation
      are NOT included because the table endpoint doesn't join them;
      downstream ``convert_collars`` will fall back to lat/lon.
    - ``hole_ids=`` — issues one ``/collar-family`` request per hole and
      merges in ``dbo_collarcoordinate`` + ``dbo_collarelevation``.
      Result matches the SQL builder exactly.
    """
    if extent is not None:
        if limit is None:
            return client.fetch_all_table_rows("dbo_collar", extent=extent)
        # ``fetch_all_table_rows`` controls pagination via its own ``limit``,
        # so we can't forward a caller-supplied limit through it. Use the
        # single-page endpoint instead.
        return client.fetch_table_rows("dbo_collar", extent=extent, limit=limit)
    holes = _ensure_iter(hole_ids)
    if not holes:
        raise ValueError("fetch_collars requires hole_ids or extent")
    frames = []
    for hid in holes:
        fam = client.fetch_collar_family(hole_id=hid)
        merged = _merge_collar_family(fam["tables"])
        if not merged.empty:
            frames.append(merged)
    return pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()


def fetch_surveys(client, *, hole_ids=None):
    """Fetch surveys with ``HoleId`` attached, ready for :func:`convert_surveys`."""
    holes = _ensure_iter(hole_ids)
    if not holes:
        raise ValueError("fetch_surveys requires hole_ids")
    frames = []
    for hid in holes:
        fam = client.fetch_collar_family(hole_id=hid)
        survey = fam["tables"].get("dbo_dhsurvey", pd.DataFrame())
        if survey.empty:
            continue
        frames.append(_attach_hole_id(survey, fam["tables"].get("dbo_collar", pd.DataFrame())))
    return pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()


def fetch_geology(client, *, hole_ids=None, attribute_columns=None):
    """Fetch geology long-form rows ready for :func:`convert_geology`."""
    return _fetch_collar_eav(
        client, hole_ids,
        parent_table="dbo_dhgeology", attr_table="dbo_dhgeologyattr",
        parent_alias="DHGeologyId", fk_col="DHGeologyId",
        attr_filter=attribute_columns,
    )


def fetch_structures(client, *, hole_ids=None, attribute_columns=None):
    """Fetch structure long-form rows ready for :func:`convert_structures`."""
    return _fetch_collar_eav(
        client, hole_ids,
        parent_table="dbo_dhstructure", attr_table="dbo_dhstructureattr",
        parent_alias="DHStructureId", fk_col="DHStructureId",
        attr_filter=attribute_columns,
    )


def fetch_assays(client, *, hole_ids=None, analytes=None, only_with_value=True):
    """Fetch geochemistry long-form rows ready for :func:`convert_assays`."""
    df = _fetch_collar_eav(
        client, hole_ids,
        parent_table="dbo_dhgeochemistry", attr_table="dbo_dhgeochemistryattr",
        parent_alias="DHGeochemistryId", fk_col="DHGeochemistryId",
        attr_filter=analytes,
    )
    if only_with_value and "PPMValue" in df.columns:
        df = df[df["PPMValue"].notna()].reset_index(drop=True)
    return df


def _fetch_collar_eav(client, hole_ids, *, parent_table, attr_table,
                      parent_alias, fk_col, attr_filter=None):
    holes = _ensure_iter(hole_ids)
    if not holes:
        raise ValueError("Provide at least one hole_id")
    frames = []
    for hid in holes:
        fam = client.fetch_collar_family(hole_id=hid)
        parent = fam["tables"].get(parent_table, pd.DataFrame())
        attrs = fam["tables"].get(attr_table, pd.DataFrame())
        collar = fam["tables"].get("dbo_collar", pd.DataFrame())
        merged = _merge_eav(parent, attrs, parent_alias=parent_alias,
                            fk_col=fk_col, collar_table=collar,
                            attr_filter=attr_filter)
        if not merged.empty:
            frames.append(merged)
    return pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()


def fetch_assays_flat(client, *, hole_ids=None, extent=None):
    """Fetch the GSWA flat downhole-assay table ``gsd_dhassayflat``.

    Result is ready for :func:`convert_assays_flat`. ``extent=`` issues one
    request (a :class:`baselode.extent.Extent`); ``hole_ids=`` issues one
    request per hole.

    Note: ``gsd_dhassayflat`` does not carry a ``HoleId`` column natively
    (only ``Collarid`` + ``CompanyHoleId``), so this fetcher attaches
    ``HoleId`` to every returned row before handing back the DataFrame:

    - ``hole_ids=`` path — the value is known (we filtered by it), so we
      stamp it onto each row directly.
    - ``extent=`` path — we issue a parallel ``dbo_collar`` lookup over
      the same extent to build a ``Collarid -> HoleId`` map, then merge.
    """
    if extent is not None:
        df = client.fetch_all_table_rows("gsd_dhassayflat", extent=extent)
        return _attach_hole_id_via_collar_lookup(client, df, extent=extent)
    holes = _ensure_iter(hole_ids)
    if not holes:
        raise ValueError("fetch_assays_flat requires hole_ids or extent")
    frames = []
    for hid in holes:
        df = client.fetch_all_table_rows("gsd_dhassayflat", hole_id=hid)
        if df.empty:
            continue
        df = df.copy()
        df["HoleId"] = hid
        frames.append(df)
    return pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()


def _attach_hole_id_via_collar_lookup(client, df, *, extent):
    """Add a ``HoleId`` column to a flat-assay DataFrame via collar lookup.

    Used by the bbox path of :func:`fetch_assays_flat` and similar
    flat-table fetchers where the response carries ``Collarid`` but not
    ``HoleId``. Issues one ``GET /tables/dbo_collar/rows`` over the same
    extent, builds an ``Id -> HoleId`` map, and merges. Existing
    ``HoleId`` values (if any) are kept.
    """
    if df.empty:
        return df
    if "HoleId" in df.columns and df["HoleId"].notna().all():
        return df
    if "Collarid" not in df.columns and "CollarId" not in df.columns:
        return df
    fk = "Collarid" if "Collarid" in df.columns else "CollarId"

    collars = client.fetch_all_table_rows("dbo_collar", extent=extent)
    if collars.empty or "Id" not in collars.columns or "HoleId" not in collars.columns:
        return df
    id_to_hole = dict(zip(collars["Id"], collars["HoleId"]))
    out = df.copy()
    if "HoleId" not in out.columns:
        out["HoleId"] = out[fk].map(id_to_hole)
    else:
        out["HoleId"] = out["HoleId"].where(out["HoleId"].notna(),
                                             out[fk].map(id_to_hole))
    return out


def fetch_surface_samples(client, *, sample_identifiers=None,
                          surface_sample_ids=None, anumber=None,
                          attribute_filter=None, only_with_value=True):
    """Fetch surface samples + coordinates + EAV attrs for :func:`convert_surface_samples`.

    Provide one or more of ``sample_identifiers``, ``surface_sample_ids``,
    or ``anumber``. Each value triggers one ``/surface-sample-family``
    request; results are concatenated.
    """
    selectors = []
    for sid in _ensure_iter(surface_sample_ids):
        selectors.append({"surface_sample_id": sid})
    for ident in _ensure_iter(sample_identifiers):
        selectors.append({"sample_identifier": ident})
    if anumber is not None:
        selectors.append({"anumber": anumber})
    if not selectors:
        raise ValueError(
            "fetch_surface_samples requires sample_identifiers, "
            "surface_sample_ids, or anumber"
        )

    frames = []
    for sel in selectors:
        fam = client.fetch_surface_sample_family(**sel)
        merged = _merge_surface_sample_family(
            fam["tables"], attr_filter=attribute_filter,
            only_with_value=only_with_value,
        )
        if not merged.empty:
            frames.append(merged)
    return pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()


def _merge_surface_sample_family(tables, *, attr_filter=None, only_with_value=True):
    sample = tables.get("dbo_surfacesample", pd.DataFrame())
    if sample.empty:
        return sample
    out = sample.copy()

    # Drop child tables' own primary keys before joining so they don't collide
    # with sample."Id"; rename their FK back to "Id" so the merge key matches.
    coord = tables.get("dbo_surfacesamplecoordinate", pd.DataFrame())
    if not coord.empty:
        keep = [c for c in coord.columns if c != "Id"]
        coord = coord[keep].rename(columns={"SurfaceSampleId": "Id"})
        out = out.merge(coord, on="Id", how="left", suffixes=("", "__coord"))

    attrs = tables.get("dbo_surfacesampleattr", pd.DataFrame())
    if not attrs.empty:
        if attr_filter and "AttributeColumn" in attrs.columns:
            attrs = attrs[attrs["AttributeColumn"].isin(set(attr_filter))]
        if only_with_value and "PPMValue" in attrs.columns:
            attrs = attrs[attrs["PPMValue"].notna()]
        keep = [c for c in attrs.columns if c != "Id"]
        attrs = attrs[keep].rename(columns={"SurfaceSampleId": "Id"})
        out = out.merge(attrs, on="Id", how="left", suffixes=("", "__attr"))
    return out


def fetch_surface_samples_flat(client, *, sample_ids=None, extent=None):
    """Fetch ``gsd_ssassayflat`` for :func:`convert_surface_samples_flat`.

    ``extent=`` requires a :class:`baselode.extent.Extent`.
    """
    if extent is not None:
        return client.fetch_all_table_rows("gsd_ssassayflat", extent=extent)
    samples = _ensure_iter(sample_ids)
    if not samples:
        raise ValueError("fetch_surface_samples_flat requires sample_ids or extent")
    frames = []
    for sid in samples:
        # The flat table is keyed by company sample id in the docs.
        df = client.fetch_all_table_rows("gsd_ssassayflat", company_sample_id=sid)
        if not df.empty:
            frames.append(df)
    return pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()
