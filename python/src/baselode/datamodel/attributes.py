# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Darkmine Pty Ltd

"""Promote explicit long-form attributes while retaining source evidence."""
import base64
import datetime
import decimal
import json
import math
import numbers
import re

import pandas as pd


def normalize_attribute_name(value):
    """Normalize camel boundaries and punctuation to lowercase snake_case."""
    if pd.isna(value):
        return ''
    value = re.sub(r'(?<=[a-z0-9])(?=[A-Z])', '_', str(value).strip())
    return re.sub(r'[^A-Za-z0-9]+', '_', value).strip('_').lower()


def json_scalar(value):
    """Encode scalar evidence; dates use ISO text and non-JSON types use tags.

    Missing values become null. Decimal, bytes and infinite floats retain
    their exact representation in objects with __type__ and value keys.
    Unsupported scalar types are rejected instead of silently stringified.
    """
    if hasattr(value, 'item'):
        value = value.item()
    if pd.isna(value):
        return None
    if isinstance(value, (datetime.date, datetime.datetime, pd.Timestamp)):
        return value.isoformat()
    if isinstance(value, decimal.Decimal):
        return {'__type__': 'decimal', 'value': str(value)}
    if isinstance(value, bytes):
        return {'__type__': 'bytes', 'value': base64.b64encode(value).decode('ascii')}
    if isinstance(value, float) and math.isinf(value):
        return {'__type__': 'float', 'value': str(value)}
    if isinstance(value, (str, int, float, bool)):
        return value
    raise ValueError(f'Unsupported scalar metadata type: {type(value).__name__}')


def _attribute_id_key(value):
    if isinstance(value, bool):
        raise ValueError('Attribute IDs must be integer or text identifiers')
    if isinstance(value, numbers.Integral):
        return (0, int(value))
    if isinstance(value, str):
        segments = tuple((1,int(v)) if v.isdecimal() else (0,v) for v in re.split(r'(\d+)', value))
        return (1, segments, value)
    raise ValueError('Attribute IDs must be integer or text identifiers')


def promote_attributes(parents, attributes, mapping, fields, parent_key='parent_id'):
    """Return one unchanged parent row with mapped columns and JSON evidence.

    Parameters
    ----------
    parents : pandas.DataFrame
        Unique, non-null parent keys. Existing columns are preserved.
    attributes : pandas.DataFrame
        Long-form records with parent_id, attribute_id, name, value and
        optional modified_date. Mapped values must be text or null: numeric columns
        must be converted explicitly before DataFrame coercion can erase
        source formatting. Additional supported scalar metadata is retained.
    mapping : list of dict
        Explicit name, target and integer priority entries. Lower priority
        wins, followed by newest modification and lowest attribute ID.
        Null/blank values cannot win promotion; their records remain intact.
    fields : list of str
        Supported output columns. Unknown targets or normalized map clashes
        are rejected. No mapping is inferred from frequency.
    parent_key : str
        Column identifying parents, independent of display identifiers.

    Returns
    -------
    pandas.DataFrame
        Mapped text fields, attribute_clash_count and attributes_extra JSON
        text. Extras use normalized names with scalar or distinct-value array
        entries. _attribute_records preserves every original attribute record;
        _conflicts preserves ranked mapped candidates when names or usable
        values disagree. An alias clash is reported even for equal values.
        Null parents, duplicate record IDs and orphan records are rejected.
    """
    if parents[parent_key].isna().any() or parents[parent_key].duplicated().any():
        raise ValueError('Parent keys must be unique and non-null')
    required = {'parent_id', 'attribute_id', 'name', 'value'}
    if not required.issubset(attributes.columns):
        raise ValueError(f'Missing attribute columns: {sorted(required - set(attributes.columns))}')
    if attributes['attribute_id'].isna().any() or attributes['attribute_id'].duplicated().any():
        raise ValueError('Attribute IDs must be unique and non-null')
    if attributes['parent_id'].isna().any() or not attributes['parent_id'].isin(parents[parent_key]).all():
        raise ValueError('Attributes contain null or orphan parent keys')
    if len(fields) != len(set(fields)):
        raise ValueError('Output fields must be unique')
    reserved = {'attributes_extra', 'attribute_clash_count'}
    if set(fields) & reserved:
        raise ValueError('Output fields contain reserved expansion columns')
    added = set(fields) | reserved
    if added & set(parents.columns):
        raise ValueError('Attribute expansion would overwrite parent columns')
    mappings = {}
    for item in mapping:
        key = normalize_attribute_name(item['name'])
        if not key or key in mappings:
            raise ValueError(f'Ambiguous or blank mapping name: {item["name"]}')
        if item['target'] not in fields:
            raise ValueError(f'Mapping target has no output column: {item["target"]}')
        priority = item['priority']
        if isinstance(priority, bool) or not isinstance(priority, numbers.Integral):
            raise ValueError('Mapping priority must be an integer')
        mappings[key] = (item['target'], int(priority))
    mapped_values = attributes.loc[attributes['name'].map(normalize_attribute_name).isin(mappings), 'value']
    if not mapped_values.map(lambda v: pd.isna(v) or isinstance(v, str)).all():
        raise ValueError('Mapped attribute values must be text or null; preserve numeric source formatting explicitly')
    output = parents.copy()
    for field in fields:
        output[field] = pd.Series([None] * len(output), index=output.index, dtype='string')
    summaries = {}
    groups = {}
    original_records = attributes.to_dict('records')
    id_families = {_attribute_id_key(r['attribute_id'])[0] for r in original_records}
    if len(id_families) > 1:
        raise ValueError('Mixed numeric and text attribute IDs are not supported')
    for record in sorted(original_records, key=lambda r:_attribute_id_key(r['attribute_id'])):
        groups.setdefault(record['parent_id'], []).append(record)
    for parent_id, source_records in groups.items():
        extras, candidates, records = {}, {}, []
        for original in source_records:
            record = {k: json_scalar(v) for k, v in original.items()}
            records.append(record)
            name = normalize_attribute_name(record['name'])
            raw_value = record['value']
            value = str(raw_value).strip() if raw_value is not None else None
            value = value or None
            if name in mappings:
                target, priority = mappings[name]
                modified = record.get('modified_date')
                if modified is None:
                    timestamp = pd.NaT
                else:
                    try:
                        if not isinstance(modified, str):
                            raise ValueError('Expected ISO date/time text')
                        modified = modified.strip()
                        if not re.match(r'^\d{4}(?:-\d{2}-\d{2}|\d{4})(?:$|[T ])', modified):
                            raise ValueError('Expected an explicit ISO calendar date')
                        timestamp = pd.to_datetime(modified, utc=True)
                        timestamp.value  # Validate the ranking range inside this record's error context.
                    except (ValueError, TypeError, OverflowError) as exc:
                        raise ValueError(f'Invalid modified_date for attribute {record["attribute_id"]}; use ISO date/time or null') from exc
                candidates.setdefault(target, []).append({'source_record': record, 'attribute_value': value,
                    'priority': priority, '_time': timestamp, '_id_key': _attribute_id_key(original['attribute_id'])})
            else:
                extras.setdefault(name, []).append(raw_value)
        extra = {}
        for name, values in sorted(extras.items()):
            unique = {json.dumps(v, ensure_ascii=False, allow_nan=False, sort_keys=True): v for v in values}
            vals = [unique[k] for k in sorted(unique)]
            extra[name] = vals[0] if len(vals) == 1 else vals
        promoted, conflicts = {}, {}
        for field, choices in candidates.items():
            choices.sort(key=lambda c: (c['priority'], pd.isna(c['_time']),
                         -c['_time'].value if pd.notna(c['_time']) else 0, c['_id_key']))
            usable = [c for c in choices if c['attribute_value'] is not None]
            winner = usable[0] if usable else None
            promoted[field] = winner['attribute_value'] if winner else None
            different_names = len({c['source_record']['name'] for c in choices}) > 1
            different_values = len({c['attribute_value'] for c in choices if c['attribute_value'] is not None}) > 1
            if len(choices) > 1 and (different_names or different_values):
                conflicts[field] = [{k:v for k,v in c.items() if k not in ('_time', '_id_key')} |
                    {'candidate_rank': i+1, 'selected': c is winner} for i,c in enumerate(choices)]
        extra['_attribute_records'] = records
        if conflicts:
            extra['_conflicts'] = conflicts
        summaries[parent_id] = (promoted, extra, len(conflicts))
    payloads, counts = [], []
    for parent_id in output[parent_key]:
        promoted, extra, count = summaries.get(parent_id, ({}, {}, 0))
        payloads.append(json.dumps(extra, ensure_ascii=False, allow_nan=False, sort_keys=True, separators=(',', ':')))
        counts.append(count)
    for field in fields:
        output[field] = pd.array([summaries.get(pid, ({}, {}, 0))[0].get(field)
                                 for pid in output[parent_key]], dtype='string')
    output['attributes_extra'] = pd.array(payloads, dtype='string')
    output['attribute_clash_count'] = counts
    return output
