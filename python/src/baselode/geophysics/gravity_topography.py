# Copyright (C) 2026 Darkmine Pty Ltd
# SPDX-License-Identifier: GPL-3.0-or-later
"""Explicit land Bouguer plates and bounded finite-zone terrain corrections."""
import copy
import importlib.metadata
import json
import math
import pathlib
import warnings

import numpy as np

import baselode.geophysics.corrections
import baselode.geophysics.observations
import baselode.geophysics.provenance

try:
    import harmonica as _harmonica
except ImportError:
    _harmonica = None

_DESCRIPTOR = json.loads((pathlib.Path(__file__).parent / 'geophysics_gravity_topography.json').read_text())


def describe_gravity_topography():
    """Return independent land plate/terrain schemas and finite-zone assumptions.

    Returns
    -------
    dict
        Parameters, fixed models, limits and Python execution capabilities.
    """
    return copy.deepcopy(_DESCRIPTOR)


def calculate_bouguer_plate(request):
    """Calculate a positive infinite-land-plate attraction and density derivative.

    Parameters
    ----------
    request : dict
        density_kg_m3 in (0,10000] and thicknesses_m, a list of at most 512
        finite land thicknesses in [0,10000]. Thickness is measured above the
        caller's reference level. No default density or datum is inferred.

    Returns
    -------
    dict
        State/issues and ordered fields with effect_mGal and
        density_sensitivity_mGal_per_kg_m3. Subtract effect from a compatible
        gravity disturbance. Any invalid input returns no fields.
    """
    report = {'schema': 'baselode.geophysics.bouguer_plate', 'version': 1, 'state': 'ok', 'issues': [], 'fields': [], 'model': copy.deepcopy(_DESCRIPTOR['models']['gravity_bouguer'])}
    try:
        params = baselode.geophysics.corrections._json(request)
        if type(params) is not dict or set(params) != {'density_kg_m3', 'thicknesses_m'}:
            raise ValueError('supply only density_kg_m3 and thicknesses_m')
        density, heights = params['density_kg_m3'], params['thicknesses_m']
        if not baselode.geophysics.corrections._number(density) or not 0 < density <= 10000 or type(heights) is not list or not heights or len(heights) > 512 or any(not baselode.geophysics.corrections._number(h) or not 0 <= h <= 10000 for h in heights):
            raise ValueError('positive density <=10000 kg/m3 and 1..512 thicknesses in [0,10000] m required')
        constant = 2*math.pi*_DESCRIPTOR['models']['gravity_bouguer']['G_SI']*100000
        report['fields'] = [{'effect_mGal': constant*density*h, 'density_sensitivity_mGal_per_kg_m3': constant*h} for h in heights]
    except (ValueError, TypeError, RecursionError) as error:
        report.update(state='rejected', fields=[], issues=[{'code': 'contract', 'message': str(error)}])
    return report


def _terrain_fields(data, params):
    if _harmonica is None:
        raise ImportError("Terrain correction requires pip install 'baselode[potential-fields]'")
    if importlib.metadata.version('harmonica') != '0.7.0':
        raise RuntimeError('terrain backend must be Harmonica 0.7.0; install the declared potential-fields extra')
    dem = params['dem']
    west, south, east, north = dem['bounds']
    nrows, ncols = len(dem['heights']), len(dem['heights'][0])
    dx, dy = (east-west)/ncols, (north-south)/nrows
    result = []
    for row in data['records']:
        if row['values'][params['channel']] is None:
            continue
        prisms, densities = [], []
        for i, values in enumerate(dem['heights']):
            for j, height in enumerate(values):
                if height == row['z']:
                    continue
                prisms.append([west+j*dx, west+(j+1)*dx, north-(i+1)*dy, north-i*dy, min(height,row['z']), max(height,row['z'])])
                densities.append(params['density_kg_m3'] if height > row['z'] else -params['density_kg_m3'])
        effect = 0.0
        if prisms:
            with warnings.catch_warnings():
                warnings.simplefilter('error')
                value = np.asarray(_harmonica.prism_gravity(([row['x']], [row['y']], [row['z']]), prisms, densities, field='g_z', parallel=False, dtype='float64'))
            if value.shape != (1,) or not np.isfinite(value[0]):
                raise RuntimeError('terrain backend returned a nonfinite or malformed field')
            effect = -float(value[0])
        result.append({'id': row['id'], 'correction_mGal': effect, 'density_sensitivity_mGal_per_kg_m3': effect/params['density_kg_m3'], 'edge_distance_m': min(row['x']-west, east-row['x'], row['y']-south, north-row['y'])})
    return result


def _apply(payload, options, terrain):
    operation = 'correct_gravity_terrain' if terrain else 'apply_bouguer_plate'
    correction = 'gravity_terrain' if terrain else 'gravity_bouguer'
    report = baselode.geophysics.corrections._report(operation)
    report['assumptions'] = copy.deepcopy(_DESCRIPTOR['assumptions'])
    try:
        params = baselode.geophysics.corrections._gravity_topography_options(options, terrain)
        report['parameters'] = params
        data = baselode.geophysics.observations.create_observations(payload)
        baselode.geophysics.corrections._gravity_topography_context(data, params)
        ledger = baselode.geophysics.corrections._load(data)
        states = baselode.geophysics.corrections._states(data, ledger)
        baselode.geophysics.corrections._gravity_topography_history(states, params['channel'], terrain)
        if terrain:
            baselode.geophysics.corrections._matching_gravity_plate(ledger['entries'], params)
        if len(ledger['entries']) >= baselode.geophysics.corrections._LIMITS['max_events']:
            raise baselode.geophysics.corrections._ResourceError('gravity topography ledger event limit exceeded')
        if any(e['id'] == params['event_id'] for e in ledger['entries']):
            raise ValueError('event_id already exists')
        readings = [row for row in data['records'] if row['values'][params['channel']] is not None]
        if terrain:
            fields = _terrain_fields(data, params)
        else:
            calculation = calculate_bouguer_plate({'density_kg_m3': params['density_kg_m3'], 'thicknesses_m': [row['z']-params['reference_height_m'] for row in readings]})
            if calculation['state'] != 'ok':
                raise ValueError(calculation['issues'][0]['message'])
            fields = [{'id': row['id'], 'correction_mGal': -field['effect_mGal'], 'density_sensitivity_mGal_per_kg_m3': -field['density_sensitivity_mGal_per_kg_m3']} for row, field in zip(readings, calculation['fields'])]
        for row, field in zip(readings, fields):
            corrected = row['values'][params['channel']] + field['correction_mGal']
            report['proposals'].append({**field, 'original': row['values'][params['channel']], 'corrected': corrected})
        if any(abs(p['correction_mGal']) > params['max_abs_correction_mGal'] for p in report['proposals']):
            raise ValueError('topography correction exceeds the explicit per-record cap')
        if any(not baselode.geophysics.corrections._number(p['corrected']) for p in report['proposals']):
            raise ValueError('topography-corrected value exceeds finite portable range')
        before = ledger['current_binding']
        model = copy.deepcopy(_DESCRIPTOR['models'][correction])
        bound = baselode.geophysics.corrections._gravity_topography_binding(data, params, model)
        nodes, operand = baselode.geophysics.provenance.append_input(data['metadata'], data['metadata'])
        for row, proposal in zip(readings, report['proposals']):
            row['values'][params['channel']] = proposal['corrected']
        after = baselode.geophysics.corrections._binding(data)
        ledger['entries'].append({'id': params['event_id'], 'kind': 'application', 'correction': correction, 'channels': [params['channel']], 'state': 'applied', 'evidence': params['evidence'], 'producer': baselode.geophysics.corrections._producer(), 'input_binding': before, 'output_binding': after, 'parameters': params, 'model': model, 'topography_binding': bound, 'affected_records': len(readings)})
        ledger['current_binding'] = after
        metadata = data['metadata'];metadata['input_lineage'] = nodes
        for key in ('uncertainty', 'variance', 'standard_deviation'):
            metadata.pop(key, None)
        metadata['uncertainty_propagated'] = False
        metadata['processing'] = list(metadata.get('processing', [])) + [{'operation': operation, 'version': 1, 'parameters': params, 'input_binding': before, 'output_binding': after, 'operand_lineage': operand}]
        output = baselode.geophysics.corrections._save(data, ledger)
        baselode.geophysics.corrections._validate(output, ledger, after)
        report.update(observations=output, ledger=copy.deepcopy(ledger), states=baselode.geophysics.corrections._states(output, ledger), diagnostics={'affected_records': len(readings), 'density_inferred': False, 'uncertainty_propagated': False, 'finite_zone': terrain})
        return report
    except (ValueError, TypeError, RecursionError) as error:
        return baselode.geophysics.corrections._error(report, error)
    except (RuntimeError, Warning, OSError) as error:
        report = baselode.geophysics.corrections._error(report, error)
        report['state'] = 'failed';report['issues'][-1]['code'] = 'backend'
        return report


def apply_bouguer_plate(payload, options):
    """Subtract an explicit land plate from a gravity disturbance, atomically.

    Parameters
    ----------
    payload : dict
        V1 mGal gravity_disturbance with applied normal/drift/tide and unapplied
        free-air/Bouguer/terrain history. Height datum/metres/up and selected
        gravity datum/tide system must be explicit. Inputs are copied.
    options : dict
        channel, density_kg_m3, reference_height_m, height_datum,
        reference_policy='caller_verified', max_abs_correction_mGal,
        event_id and evidence. Nonnull heights must lie 0..10000 m above
        reference; density in (0,10000] kg/m3. At most 512 records.

    Returns
    -------
    dict
        Native correction report, proposals/density sensitivity and bound
        output only on success. Gravity disturbance semantics retained; no
        classical free-air anomaly or propagated uncertainty is claimed.
    """
    return _apply(payload, options, False)


def correct_gravity_terrain(payload, options):
    """Add bounded finite-zone signed-prism terrain correction after native plate.

    Parameters
    ----------
    payload : dict
        Native plate-reduced gravity_disturbance observations in a projected
        or declared local metre frame; all nonnull stations must be ground
        observations matching their containing DEM cell within tolerance.
    options : dict
        All plate options with matching density/reference/height datum; dem
        with id/crs/crs_units='m'/frame_id/height_datum/bounds [W,S,E,N] and a
        rectangular north-up heights matrix. Up to 1024 finite cells, 100 km
        per axis; no holes. Explicit min_edge_distance_m >0,
        ground_tolerance_m in [0,1], outside_dem_policy='flat_at_station_height'.
        Model assumes flat station-level terrain outside this finite zone.

    Returns
    -------
    dict
        Atomic native correction report, per-record effects, density
        derivatives and edge support distances. This is not global terrain
        removal, an airborne/marine correction, or inferred reduction density.

    Raises
    ------
    ImportError
        Install baselode[potential-fields] for optional Harmonica execution.
    """
    return _apply(payload, options, True)
