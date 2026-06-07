# Copyright (C) 2026 Darkmine Pty Ltd
# SPDX-License-Identifier: GPL-3.0-or-later

"""DrillholeSet — composition root for the drilling tables of a project.

Bundles a collar + survey table plus an arbitrary number of named interval
tables (assay, geology, structural, geotech, ...) and exposes the
existing function-based API as methods.  No new algorithmic logic: every
method delegates to ``baselode.drill.validate`` / ``desurvey`` /
``composite`` / ``omf``.  The bare-DataFrame functions remain importable
and unchanged.

State is restricted to derived data: the desurveyed trace is cached on
the instance so downstream methods (``to_omf``, future block-model fits)
don't repeatedly re-run desurvey.

Mirrors PyGSLIB's ``Drillhole(collar, survey)`` + ``addtable(...)``
ergonomics, which is the established mental model in the
geology/geometallurgy community.
"""

from baselode.datamodel import HOLE_ID


def _desurvey_methods():
    """Lazy registry of method-name → desurvey function.

    Lazy so the import doesn't trigger while ``baselode.drill`` itself
    is still loading (this module is re-exported from
    ``baselode.drill.__init__``).
    """
    import baselode.drill.desurvey as desurvey
    return {
        "minimum_curvature": desurvey.minimum_curvature_desurvey,
        "tangential": desurvey.tangential_desurvey,
        "balanced_tangential": desurvey.balanced_tangential_desurvey,
    }


class DrillholeSet:
    """A collection of related drilling tables for one project / dataset.

    Parameters
    ----------
    collar : pd.DataFrame
        Collar table — must carry ``hole_id``, ideally with the projected
        ``easting`` / ``northing`` / ``elevation`` and any metadata
        columns (max_depth, hole_type, project_id, ...).
    survey : pd.DataFrame
        Directional survey table with ``hole_id``, ``depth``,
        ``azimuth``, ``dip``.
    crs : str or None
        Optional EPSG code / proj string travelling with the set.
    project : str or None
        Optional project identifier.

    Attributes
    ----------
    collar, survey : pd.DataFrame
        The source tables.
    tables : dict[str, pd.DataFrame]
        Interval tables registered via :meth:`add_table`.
    table_kinds : dict[str, str]
        Per-table kind tag (e.g. ``"assay"``, ``"litho"``, ``"structural"``).
    crs, project : str or None
        Metadata passed at construction.
    holes : list
        Distinct hole IDs from the collar table (property).
    traces : pd.DataFrame or None
        Cached desurvey output.  ``None`` until :meth:`desurvey` runs.
    """

    def __init__(self, collar, survey, crs=None, project=None, hole_col=HOLE_ID):
        self.collar = collar
        self.survey = survey
        self.crs = crs
        self.project = project
        self.hole_col = hole_col
        self.tables = {}
        self.table_kinds = {}
        self._traces = None
        self._desurvey_args = None

    def add_table(self, name, df, kind="assay"):
        """Register an interval table.  Chainable.

        Parameters
        ----------
        name : str
            Unique key; existing entries are overwritten.  ``"collars"``
            and ``"traces"`` are reserved for the built-in OMF elements
            in :meth:`to_omf` and raise :class:`ValueError`.
        df : pd.DataFrame
        kind : str
            Free-form tag describing the table (default ``"assay"``).
            Stored alongside the table for downstream consumers; not
            consulted by the methods on this class.
        """
        if not isinstance(name, str) or not name:
            raise ValueError("Table name must be a non-empty string")
        if name in ("collars", "traces"):
            raise ValueError(
                f"Table name '{name}' is reserved for built-in OMF elements"
            )
        self.tables[name] = df
        self.table_kinds[name] = kind
        return self

    @property
    def holes(self):
        """Distinct hole IDs from the collar table, NaN dropped."""
        if self.hole_col not in self.collar.columns:
            return []
        return self.collar[self.hole_col].dropna().unique().tolist()

    @property
    def traces(self):
        """Cached desurveyed trace; computes on first access using defaults."""
        if self._traces is None:
            return self.desurvey()
        return self._traces

    def desurvey(self, method="minimum_curvature", step=1.0, force=False):
        """Desurvey the holes (cached after first call).

        Parameters
        ----------
        method : str
            One of ``"minimum_curvature"``, ``"tangential"``,
            ``"balanced_tangential"``.
        step : float
            Output sample spacing (metres).
        force : bool
            Re-run even when a cached result with matching args exists.

        Returns
        -------
        pd.DataFrame
            Trace table with ``hole_id``, ``md``, ``easting``,
            ``northing``, ``elevation``, ``azimuth``, ``dip``.
        """
        args = (method, step)
        if self._traces is not None and self._desurvey_args == args and not force:
            return self._traces
        methods = _desurvey_methods()
        method_fn = methods.get(method)
        if method_fn is None:
            available = ", ".join(sorted(methods))
            raise ValueError(f"Unknown desurvey method '{method}'. Available: {available}")
        self._traces = method_fn(self.collar, self.survey, step=step)
        self._desurvey_args = args
        return self._traces

    def validate(self, **kwargs):
        """Run :func:`baselode.drill.validate.validate_drillhole_db` over the set.

        All keyword arguments are forwarded to the underlying function
        (e.g. ``allow_full_circle=True``).
        """
        import baselode.drill.validate as validate_module
        return validate_module.validate_drillhole_db(
            self.collar,
            self.survey,
            interval_tables=self.tables or None,
            **kwargs,
        )

    def composite(self, table_name, value_col, length=1.0, method="average", from_col="from", to_col="to"):
        """Composite an interval table to a fixed downhole length.

        Thin wrapper around
        :func:`baselode.drill.composite.composite_intervals`.
        """
        if table_name not in self.tables:
            raise KeyError(
                f"No table '{table_name}'; registered: {list(self.tables)}"
            )
        import baselode.drill.composite as composite_module
        return composite_module.composite_intervals(
            self.tables[table_name],
            value_col,
            from_col=from_col,
            to_col=to_col,
            length=length,
            method=method,
        )

    def to_omf(
        self,
        path,
        include=None,
        value_cols=None,
        name=None,
        author="baselode",
        description="",
    ):
        """Serialise the set to an OMF v1 file.

        Parameters
        ----------
        path : str or pathlib.Path
        include : iterable of str, optional
            Element keys to include — any of ``"collars"``, ``"traces"``,
            or a name from :attr:`tables`.  Defaults to everything that
            has been registered.
        value_cols : dict[str, list[str]], optional
            Per-table value columns to attach as OMF segment data, e.g.
            ``{"assay": ["au_ppm", "cu_pct"]}``.  Tables absent from this
            mapping get no value columns (just per-segment ``hole_id``).
        name : str, optional
            OMF project name; defaults to :attr:`project` or
            ``"baselode"``.
        author, description : str
            OMF project metadata.

        Returns
        -------
        pathlib.Path
            The path written.
        """
        if include is None:
            include = ["collars", "traces"] + list(self.tables)
        else:
            include = list(include)
        value_cols = dict(value_cols or {})

        import baselode.drill.omf as omf_module
        elements = []
        if "collars" in include:
            elements.append(omf_module.collars_to_omf_points(self.collar))
        if "traces" in include:
            elements.append(omf_module.traces_to_omf_lines(self.traces))
        for table_name in include:
            if table_name in ("collars", "traces"):
                continue
            if table_name not in self.tables:
                raise KeyError(
                    f"No table '{table_name}'; registered: {list(self.tables)}"
                )
            elements.append(omf_module.intervals_to_omf_lines(
                self.tables[table_name],
                self.traces,
                name=table_name,
                value_cols=value_cols.get(table_name),
            ))

        from pathlib import Path
        path = Path(path)
        omf_module.write_omf(
            elements,
            path,
            name=name or self.project or "baselode",
            author=author,
            description=description,
        )
        return path

    def __getitem__(self, table_name):
        return self.tables[table_name]

    def __contains__(self, table_name):
        return table_name in self.tables

    def __repr__(self):
        return (
            f"<DrillholeSet holes={len(self.holes)} "
            f"survey_rows={len(self.survey)} "
            f"tables={list(self.tables)}>"
        )
