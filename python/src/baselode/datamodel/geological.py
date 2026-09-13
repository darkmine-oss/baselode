# Copyright (C) 2026 Darkmine Pty Ltd.

"""Versioned geological storage schema and scientific field meanings."""

import importlib.resources
import json


def get_geological_schema():
    """Return an independent copy of the packaged geological schema.

    Returns
    -------
    dict
        Version, spatial profile, scientific semantics and table definitions.
        Table names use ``drill.`` and ``surface.`` namespaces. Storage types
        describe columns, rather than a JSON transport representation.
    """
    resource = importlib.resources.files("baselode.datamodel").joinpath(
        "resources/geological_schema.json"
    )
    return json.loads(resource.read_text(encoding="utf-8"))


def get_geological_table(name):
    """Return a table definition, raising KeyError for an unknown name.

    Parameters
    ----------
    name : str
        Qualified table name, such as ``drill.petrophysics``.

    Returns
    -------
    dict
        Description, primary key and column definitions.
    """
    return get_geological_schema()["tables"][name]
