# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Darkmine Pty Ltd

"""JSON Schema generation for the baselode data model.

The canonical ``BASELODE_DATA_MODEL_*`` dicts in :mod:`baselode.datamodel`
describe column conventions as ``{column_name: python_type}``.  This
module turns each such dict into a Draft 2020-12 JSON Schema augmented
with per-field metadata (units, descriptions), per-table primary keys,
inter-table foreign keys, and per-table required-field lists.

The output schemas serve two roles:

1. **Parity contract** — committed to ``test/data/baselode_schemas.json``
   so the Python and JavaScript layers share one source of truth for
   field types / units / relations, beyond the symbol-presence check
   the existing parity tests already enforce.
2. **Downstream consumers** — the future MCP / function-calling tool
   schemas (Anthropic, OpenAI, MCP) all derive from these schemas, so
   the tool surface never drifts from the underlying data model.

Per `AGENTS.md` this module is string/dict-based — no pydantic, no
type annotations outside FastAPI.
"""

from baselode.datamodel import (
    ALPHA,
    AZIMUTH,
    BETA,
    COLLAR_ID,
    COMMENTS,
    CRS,
    DATASOURCE_HOLE_ID,
    DATASOURCE_SURFACE_SAMPLE_ID,
    DATE_END,
    DATE_START,
    DEPTH,
    DIP,
    EASTING,
    ELEVATION,
    EXTRA,
    FROM,
    GEOLOGY_CODE,
    GEOLOGY_DESCRIPTION,
    HOLE_ID,
    HOLE_TYPE,
    LATITUDE,
    LONGITUDE,
    MAX_DEPTH,
    MID,
    NORTHING,
    PROJECT_ID,
    REPORT_NUMBER,
    SAMPLE_ID,
    STRIKE,
    SURFACE_SAMPLE_TYPE,
    SURVEY_TYPE,
    TO,
    BASELODE_DATA_MODEL_DRILL_COLLAR,
    BASELODE_DATA_MODEL_DRILL_SURVEY,
    BASELODE_DATA_MODEL_STRUCTURAL_POINT,
    BASELODE_DATA_MODEL_DRILL_ASSAY,
    BASELODE_DATA_MODEL_DRILL_GEOLOGY,
    BASELODE_DATA_MODEL_GEOPHYSICS,
    BASELODE_DATA_MODEL_SURFACE_SAMPLE,
    BASELODE_DATA_MODEL_BLOCK,
    BLOCK_X, BLOCK_Y, BLOCK_Z, BLOCK_DX, BLOCK_DY, BLOCK_DZ,
    BLOCK_I, BLOCK_J, BLOCK_K, BLOCK_NI, BLOCK_NJ, BLOCK_NK,
)

DRAFT = "https://json-schema.org/draft/2020-12/schema"
SCHEMA_ID_PREFIX = "https://baselode.darkmine.ai/schemas"

# Per-field metadata.  Anything not listed here just gets its type from
# the model dict — `description` and `unit` are optional augmentations.
_FIELD_METADATA = {
    # Identifiers
    HOLE_ID: {"description": "Unique hole identifier (string), joins every drillhole table"},
    DATASOURCE_HOLE_ID: {"description": "Hole identifier from the original source dataset"},
    COLLAR_ID: {"description": "Internal collar identifier; sometimes used as a foreign key in upstream schemas"},
    PROJECT_ID: {"description": "Project / programme code"},
    REPORT_NUMBER: {"description": "Source report identifier (WAMEX / DIGS / etc.)"},
    HOLE_TYPE: {"description": "Drilling method (RC, Diamond, RAB, trench, …)"},
    SAMPLE_ID: {"description": "Unique sample identifier (surface samples)"},
    DATASOURCE_SURFACE_SAMPLE_ID: {"description": "Surface-sample identifier from the source dataset"},
    SURFACE_SAMPLE_TYPE: {"description": "rock_chip / stream_sediment / soil / outcrop / …"},

    # Spatial — collar / surface coordinates
    LATITUDE: {"description": "Latitude (WGS84)", "unit": "deg"},
    LONGITUDE: {"description": "Longitude (WGS84)", "unit": "deg"},
    ELEVATION: {"description": "Elevation above sea level (WGS84)", "unit": "m"},
    EASTING: {"description": "Projected easting", "unit": "m"},
    NORTHING: {"description": "Projected northing", "unit": "m"},
    CRS: {"description": "Coordinate reference system as EPSG code or proj string"},

    # Drilling depths
    MAX_DEPTH: {"description": "Total drilled depth of the hole", "unit": "m"},
    DEPTH: {"description": "Depth along the hole (md, measured depth)", "unit": "m"},
    FROM: {"description": "Interval start depth (md)", "unit": "m"},
    TO: {"description": "Interval end depth (md)", "unit": "m"},
    MID: {"description": "Interval midpoint depth (md, computed)", "unit": "m"},

    # Survey
    AZIMUTH: {"description": "Hole azimuth, clockwise from grid north", "unit": "deg"},
    DIP: {"description": "Hole dip below horizontal (negative = inclined downward)", "unit": "deg"},
    SURVEY_TYPE: {"description": "Survey method (gyro, magnetic, …) when known"},

    # Structural
    ALPHA: {"description": "Acute angle between the structure and the core axis", "unit": "deg"},
    BETA: {"description": "Rotation about the core axis to the long axis of the structure", "unit": "deg"},
    STRIKE: {"description": "Strike of the structural plane", "unit": "deg"},

    # Dates
    DATE_START: {"description": "ISO-8601 start date"},
    DATE_END: {"description": "ISO-8601 end date"},

    # Block model
    BLOCK_I: {"description": "Base-grid index (x axis) of the block's minimum corner"},
    BLOCK_J: {"description": "Base-grid index (y axis) of the block's minimum corner"},
    BLOCK_K: {"description": "Base-grid index (z axis) of the block's minimum corner"},
    BLOCK_NI: {"description": "Block extent along the grid x axis, in base blocks"},
    BLOCK_NJ: {"description": "Block extent along the grid y axis, in base blocks"},
    BLOCK_NK: {"description": "Block extent along the grid z axis, in base blocks"},
    BLOCK_X: {"description": "World x of the block centroid", "unit": "m"},
    BLOCK_Y: {"description": "World y of the block centroid", "unit": "m"},
    BLOCK_Z: {"description": "World z of the block centroid", "unit": "m"},
    BLOCK_DX: {"description": "Block size along the grid x axis", "unit": "m"},
    BLOCK_DY: {"description": "Block size along the grid y axis", "unit": "m"},
    BLOCK_DZ: {"description": "Block size along the grid z axis", "unit": "m"},

    # Misc
    GEOLOGY_CODE: {"description": "Standardised lithology / geology code for strip-log colouring"},
    GEOLOGY_DESCRIPTION: {"description": "Free-text geology description"},
    COMMENTS: {"description": "Per-row free-text comments"},
    EXTRA: {
        "description": "Per-row dict of source-specific fields outside the canonical schema; empty dict when the source had nothing extra.",
    },
}

# Per-table primary keys (composite where appropriate).
_PRIMARY_KEYS = {
    "drill_collar": [HOLE_ID],
    "drill_survey": [HOLE_ID, DEPTH],
    "structural_point": [HOLE_ID, DEPTH],
    "drill_assay": [HOLE_ID, FROM, TO],
    "drill_geology": [HOLE_ID, FROM, TO],
    "geophysics": [HOLE_ID, FROM, TO],
    "surface_sample": [SAMPLE_ID],
    "block": [BLOCK_I, BLOCK_J, BLOCK_K],
}

# Per-table foreign-key relations.  Every drillhole-keyed table refers
# back to drill_collar.hole_id.  Surface samples are independent.
_FOREIGN_KEYS = {
    "drill_survey": {HOLE_ID: ("drill_collar", HOLE_ID)},
    "structural_point": {HOLE_ID: ("drill_collar", HOLE_ID)},
    "drill_assay": {HOLE_ID: ("drill_collar", HOLE_ID)},
    "drill_geology": {HOLE_ID: ("drill_collar", HOLE_ID)},
    "geophysics": {HOLE_ID: ("drill_collar", HOLE_ID)},
}

# Per-table required fields.  Other columns are optional / nullable.
_REQUIRED_FIELDS = {
    "drill_collar": [HOLE_ID],
    "drill_survey": [HOLE_ID, DEPTH, AZIMUTH, DIP],
    "structural_point": [HOLE_ID, DEPTH],
    "drill_assay": [HOLE_ID, FROM, TO],
    "drill_geology": [HOLE_ID, FROM, TO],
    "geophysics": [HOLE_ID, FROM, TO],
    "surface_sample": [SAMPLE_ID, SURFACE_SAMPLE_TYPE],
    "block": [BLOCK_I, BLOCK_J, BLOCK_K, BLOCK_NI, BLOCK_NJ, BLOCK_NK],
}

# Registry of every emitted schema, keyed by the table name used in
# foreign keys / $id paths.  Stable ordering — committed JSON should
# diff cleanly if a table is added.
ALL_MODELS = (
    ("drill_collar", BASELODE_DATA_MODEL_DRILL_COLLAR, "Drillhole collar locations + metadata"),
    ("drill_survey", BASELODE_DATA_MODEL_DRILL_SURVEY, "Downhole survey stations (azimuth + dip per depth)"),
    ("structural_point", BASELODE_DATA_MODEL_STRUCTURAL_POINT, "Per-depth structural measurements (alpha/beta/strike/dip)"),
    ("drill_assay", BASELODE_DATA_MODEL_DRILL_ASSAY, "Drillhole assay intervals (analyte columns are flexible)"),
    ("drill_geology", BASELODE_DATA_MODEL_DRILL_GEOLOGY, "Drillhole geology / lithology intervals"),
    ("geophysics", BASELODE_DATA_MODEL_GEOPHYSICS, "Downhole geophysics interval measurements"),
    ("surface_sample", BASELODE_DATA_MODEL_SURFACE_SAMPLE, "Out-of-hole sample points (rock chip / stream / soil / outcrop)"),
    ("block", BASELODE_DATA_MODEL_BLOCK, "Blocks of a (sub-blocked) block model on a BlockModelDefinition base grid"),
)


def _python_type_to_json(py_type):
    if py_type is str:
        return "string"
    if py_type is float:
        return "number"
    if py_type is int:
        return "integer"
    if py_type is bool:
        return "boolean"
    if py_type is dict:
        return "object"
    if py_type is list:
        return "array"
    return "string"


def _property_schema(field_name, py_type, required):
    """Build the JSON Schema fragment for a single field.

    Required fields get a single ``type`` string; optional fields are
    typed as ``[type, "null"]`` because pandas / CSV-loaded tables
    routinely carry NaN / missing values in non-key columns.
    """
    base = _python_type_to_json(py_type)
    prop = {}
    if field_name in required:
        prop["type"] = base
    else:
        prop["type"] = [base, "null"]
    meta = _FIELD_METADATA.get(field_name, {})
    if meta.get("description"):
        prop["description"] = meta["description"]
    if meta.get("unit"):
        # `unit` isn't a JSON Schema keyword; it's a baselode extension.
        # Consumers that don't recognise it should ignore it harmlessly.
        prop["unit"] = meta["unit"]
    return prop


def to_json_schema(name, model_dict, description=None):
    """Return a Draft 2020-12 JSON Schema for a single baselode model dict.

    Parameters
    ----------
    name : str
        Table identifier — used in ``$id`` and in foreign-key targets
        (e.g. ``"drill_collar"``, ``"surface_sample"``).
    model_dict : dict
        One of the ``BASELODE_DATA_MODEL_*`` dicts.
    description : str, optional
        Human-readable description for the schema's ``description``
        field.  Ignored when omitted.

    Returns
    -------
    dict
        A Draft 2020-12 JSON Schema document.  Extra (non-standard)
        keys: ``primaryKey`` (list of column names) and per-field
        ``foreignKey`` / ``unit`` annotations.
    """
    required = list(_REQUIRED_FIELDS.get(name, []))
    properties = {}
    for col, py_type in model_dict.items():
        prop = _property_schema(col, py_type, required)
        fk = _FOREIGN_KEYS.get(name, {}).get(col)
        if fk:
            target_table, target_col = fk
            prop["foreignKey"] = {"table": target_table, "column": target_col}
        properties[col] = prop

    schema = {
        "$schema": DRAFT,
        "$id": f"{SCHEMA_ID_PREFIX}/{name}.json",
        "title": name,
        "type": "object",
        "properties": properties,
        "required": required,
        "additionalProperties": True,
    }
    if description:
        schema["description"] = description
    pk = _PRIMARY_KEYS.get(name)
    if pk:
        schema["primaryKey"] = list(pk)
    return schema


def to_json_schema_all():
    """Return a combined document containing every baselode model schema.

    Output shape::

        {
            "$schema": "...",
            "title": "baselode data model",
            "schemas": {
                "drill_collar": {...},
                "drill_survey": {...},
                ...
            }
        }

    The order of keys in ``schemas`` matches :data:`ALL_MODELS`, which
    is the stable, version-controlled order for the committed JSON
    file.  Field ordering inside each schema follows the source
    ``BASELODE_DATA_MODEL_*`` dict's insertion order (Python 3.7+
    dicts preserve insertion order).
    """
    schemas = {}
    for name, model_dict, description in ALL_MODELS:
        schemas[name] = to_json_schema(name, model_dict, description=description)
    return {
        "$schema": DRAFT,
        "title": "baselode data model",
        "description": (
            "Combined JSON Schema document for every baselode canonical "
            "table.  Generated from the BASELODE_DATA_MODEL_* dicts in "
            "baselode.datamodel; regenerate via "
            "`python -m baselode.datamodel.regen_schemas`."
        ),
        "schemas": schemas,
    }
