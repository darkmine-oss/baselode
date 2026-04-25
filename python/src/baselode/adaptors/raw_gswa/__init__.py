# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Darkmine Pty Ltd
"""Adaptor: GSWA raw schema -> baselode canonical model.

The GSWA dataset (Geological Survey of Western Australia) is published as a
Postgres schema (commonly ``raw_gswa`` or ``postgres_gswa``) and as a
read-only HTTP API under ``/v1/raw/gswa``. Tables are case-sensitive
PascalCase and many fields are stored EAV-style (``AttributeColumn`` /
``AttributeValue``).

This adaptor is split into focused submodules; this package intentionally
re-exports nothing. Import from the submodule that owns the symbol:

- ``baselode.adaptors.raw_gswa.queries`` — SQL string builders
  (``build_*_query``) and the ``DEFAULT_SCHEMA`` / ``set_default_schema``
  hooks. Returns ``(sql, params)`` ready for ``pandas.read_sql_query``.
- ``baselode.adaptors.raw_gswa.api`` — ``RawGswaApiClient`` HTTP wrapper
  plus high-level ``fetch_*`` helpers that hit the Darkmine Raw GSWA
  Data API and return DataFrames in the same shape the SQL builders
  produce.
- ``baselode.adaptors.raw_gswa.convert`` — pandas DataFrame transforms
  (``convert_*``, ``pivot_eav``) that take raw rows from either layer
  above and return DataFrames in the baselode canonical shape (matching
  ``baselode.datamodel.BASELODE_DATA_MODEL_*``). Converters do no I/O.
- ``baselode.adaptors.raw_gswa.columns`` — raw → baselode column-name
  maps used by the converters; useful to inspect or extend.

Typical SQL use::

    import baselode.adaptors.raw_gswa.queries
    import baselode.adaptors.raw_gswa.convert

    sql, params = baselode.adaptors.raw_gswa.queries.build_collar_query(
        hole_ids=["DD123456"],
    )
    raw = pd.read_sql_query(sql, conn, params=params)
    collars = baselode.adaptors.raw_gswa.convert.convert_collars(raw)

Typical API use::

    import baselode.adaptors.raw_gswa.api
    import baselode.adaptors.raw_gswa.convert

    client = baselode.adaptors.raw_gswa.api.RawGswaApiClient(
        base_url, auth_token=...,
    )
    raw = baselode.adaptors.raw_gswa.api.fetch_collars(
        client, hole_ids=["DD123456"],
    )
    collars = baselode.adaptors.raw_gswa.convert.convert_collars(raw)
"""
