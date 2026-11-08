# Copyright (C) 2026 Darkmine Pty Ltd
# SPDX-License-Identifier: GPL-3.0-or-later
"""Explicit external normal gravity through the optional pinned Boule backend."""
import copy
import importlib.metadata
import json
import pathlib
import warnings

import numpy as np

import baselode
import baselode.geophysics.corrections
import baselode.geophysics.observations
import baselode.geophysics.provenance

try:
    import boule as _boule
except ImportError:
    _boule = None

_DESCRIPTOR = json.loads((pathlib.Path(__file__).parent / 'geophysics_normal_gravity.json').read_text())


class _BackendError(RuntimeError):
    pass


def describe_normal_gravity():
    """Return independent normal-field/removal schemas and model conventions.

    Returns
    -------
    dict
        Request/result contracts, pinned model constants, units, height
        sensitivity convention, resource bounds and optional installation.
    """
    return copy.deepcopy(_DESCRIPTOR)


def _require_backend():
    if _boule is None:
        raise ImportError("Normal gravity requires pip install 'baselode[gravity]'")


def _points(request):
    if type(request) is not dict or request.keys() - {'model', 'points', 'height_policy'}:
        raise ValueError('normal gravity request requires known model/points fields')
    if 'model' not in request or 'points' not in request:
        raise baselode.geophysics.corrections._NeedsInput('supply model and explicit geodetic points')
    if request['model'] not in ('WGS84', 'GRS80'):
        raise ValueError('normal gravity model must be WGS84 or GRS80')
    policy = request.get('height_policy', 'external_only')
    if policy not in ('external_only', 'analytic_continuation'):
        raise ValueError('height_policy must be external_only or analytic_continuation')
    rows = request['points']
    if type(rows) is not list or not rows:
        raise ValueError('points must be a nonempty list')
    if len(rows) > _DESCRIPTOR['resources']['max_points']:
        raise baselode.geophysics.corrections._ResourceError('normal gravity accepts at most 512 points')
    rows = baselode.geophysics.corrections._json(rows)
    ids = set()
    for row in rows:
        required = {'id', 'longitude', 'latitude', 'height_m'}
        if type(row) is not dict or row.keys() - required:
            raise ValueError('points accept only id/longitude/latitude/height_m')
        if required - row.keys() or any(row[k] is None for k in required):
            raise baselode.geophysics.corrections._NeedsInput('every point needs ID, longitude/latitude and ellipsoidal height')
        if not baselode.geophysics.corrections._label(row['id']) or row['id'] in ids:
            raise ValueError('point IDs must be unique bounded labels')
        ids.add(row['id'])
        if not all(baselode.geophysics.corrections._number(row[k]) for k in required - {'id'}):
            raise ValueError('coordinates/heights require finite binary64 values')
        if not -180 <= row['longitude'] <= 180 or not -90 <= row['latitude'] <= 90 or not -1000 <= row['height_m'] <= 100000:
            raise ValueError('longitude [-180,180], latitude [-90,90], ellipsoidal height [-1000,100000] m required')
        if row['height_m'] < 0 and policy != 'analytic_continuation':
            raise baselode.geophysics.corrections._NeedsInput('negative ellipsoidal height requires explicit height_policy=analytic_continuation; external potential continuation is not an interior mass model')
    return rows



def _magnitude(ellipsoid, longitude, latitude, height):
    # Boule 0.6 evaluates -dU/du / h_u. Away from the ellipsoid, dU/dbeta
    # is nonzero too. Differentiate the standard normal potential analytically:
    # U_beta = omega^2 [a^2 q(u)/q(b) - (u^2+E^2)] sin(beta) cos(beta).
    # The fixture independently differentiates U at 80-digit precision.
    radial = np.asarray(ellipsoid.normal_gravity((longitude, latitude, height), coordinate_system='geodetic', si_units=False))
    _, beta, u = ellipsoid.geodetic_to_ellipsoidal_harmonic((longitude, latitude, height))
    beta = np.radians(beta)
    eccentricity = ellipsoid.linear_eccentricity
    def q(value):
        return ((1 + 3 * (value / eccentricity)**2) * np.arctan2(eccentricity, value) - 3 * value / eccentricity) / 2
    scale = np.sqrt(u*u + eccentricity**2 * np.sin(beta)**2)
    tangential = ellipsoid.angular_velocity**2 * (ellipsoid.semimajor_axis**2 * q(u) / q(ellipsoid.semiminor_axis) - (u*u + eccentricity**2)) * np.sin(beta) * np.cos(beta) / scale * 100000
    return np.hypot(radial, tangential), radial, tangential

def _evaluate(model_name, rows, height_policy='external_only'):
    expected = _DESCRIPTOR['models'][model_name]
    try:
        if importlib.metadata.version('boule') != expected['backend_version']:
            raise _BackendError('unsupported Boule version; install the declared gravity extra')
        ellipsoid = _boule.WGS84 if model_name == 'WGS84' else _boule.GRS80
        if any(float(getattr(ellipsoid, key)) != expected[key] for key in ('semimajor_axis', 'flattening', 'geocentric_grav_const', 'angular_velocity')):
            raise _BackendError('changed reference ellipsoid constants')
        longitude = np.array([row['longitude'] for row in rows], dtype=float)
        latitude = np.array([row['latitude'] for row in rows], dtype=float)
        height = np.array([row['height_m'] for row in rows], dtype=float)
        with warnings.catch_warnings():
            warnings.simplefilter('error')
            if height_policy == 'analytic_continuation':
                warnings.filterwarnings('ignore', message=r'Formulas used are valid for points outside the ellipsoid\.Height must be greater than or equal to zero\.', category=UserWarning, module=r'boule\._ellipsoid')
            gravity, radial, tangential = _magnitude(ellipsoid, longitude, latitude, height)
            elevated, _, _ = _magnitude(ellipsoid, longitude, latitude, height + 1)
        if gravity.shape != height.shape or elevated.shape != height.shape or not np.all(np.isfinite(gravity)) or not np.all(np.isfinite(elevated)):
            raise _BackendError('Boule returned incompatible or nonfinite normal gravity')
        return [{'id': row['id'], 'normal_gravity': float(value), 'height_sensitivity_mGal_per_m': float(upper - value), 'ellipsoidal_u_component_mGal': float(gu), 'ellipsoidal_beta_component_mGal': float(gb), 'height_extrapolated': row['height_m'] < 0} for row, value, upper, gu, gb in zip(rows, gravity, elevated, radial, tangential)]
    except _BackendError:
        raise
    except (ValueError, TypeError, AttributeError, RuntimeError, Warning, OSError, importlib.metadata.PackageNotFoundError) as error:
        raise _BackendError('normal gravity backend failed: ' + str(error)) from error


def calculate_normal_gravity(request):
    """Evaluate reference gravity and forward-1-m height sensitivity.

    Parameters
    ----------
    request : dict
        model WGS84/GRS80, points [{id, longitude, latitude, height_m}].
        Geodetic degrees and ellipsoidal metres 0..100000 by default, up to
        512 points. Explicit height_policy='analytic_continuation' allows
        -1000..0 m, flagged per point; the external potential is continued,
        not an interior-density model. Exact poles supported. Inputs unchanged.

    Returns
    -------
    dict
        State/issues, model identity and fields with normal_gravity in mGal,
        height_sensitivity_mGal_per_m = gamma(h+1)-gamma(h). Atomic fields:
        any failure yields an empty list. This is not propagated uncertainty.

    Raises
    ------
    ImportError
        Install baselode[gravity] for the pinned optional numerical backend.
    """
    _require_backend()
    report = {'schema': 'baselode.geophysics.normal_gravity', 'version': 1, 'state': 'ok', 'issues': [], 'model': None, 'fields': [],
              'producer': baselode.geophysics.corrections._producer(), 'assumptions': copy.deepcopy(_DESCRIPTOR['assumptions'])}
    try:
        rows = _points(request)
        report['model'] = copy.deepcopy(_DESCRIPTOR['models'][request['model']])
        report['fields'] = _evaluate(request['model'], rows, request.get('height_policy', 'external_only'))
    except (ValueError, TypeError, RuntimeError, RecursionError) as error:
        report['state'] = 'needs_input' if isinstance(error, baselode.geophysics.corrections._NeedsInput) else ('failed' if isinstance(error, _BackendError) else 'rejected')
        report['issues'].append({'code': 'backend' if isinstance(error, _BackendError) else ('context' if isinstance(error, baselode.geophysics.corrections._NeedsInput) else ('resource' if isinstance(error, baselode.geophysics.corrections._ResourceError) else 'contract')), 'message': str(error)})
        report['fields'] = []
    return report


def remove_normal_gravity(payload, options):
    """Subtract the selected normal field at each observation's actual height.

    Parameters
    ----------
    payload : dict
        V1 gravity_observed/mGal observations. Matching WGS84/GRS80 geographic
        CRS and ellipsoidal height context; declared gravity datum/tide system.
        Known unapplied normal/free-air/Bouguer/terrain history required.
    options : dict
        channel, model, reference_policy='caller_verified', event_id, evidence,
        optional height_policy='external_only' or 'analytic_continuation'.
        Caller verifies reference compatibility; no datum/tide conversion.

    Returns
    -------
    dict
        Correction report with independent gravity_disturbance observations
        and bound ledger only on complete success. Missing readings and all
        other fields/channels survive. Drift/tide history remains unchanged;
        no fully reduced anomaly or propagated uncertainty is claimed.

    Raises
    ------
    ImportError
        Install baselode[gravity] to execute the optional backend.
    """
    _require_backend()
    report = baselode.geophysics.corrections._report('remove_normal_gravity')
    report['assumptions'] = copy.deepcopy(_DESCRIPTOR['assumptions'])
    try:
        params = baselode.geophysics.corrections._normal_options(options)
        report['parameters'] = params
        data = baselode.geophysics.observations.create_observations(payload)
        channel = params['channel']
        if channel not in data['channels'] or data['channels'][channel]['field_type'] != 'gravity_observed' or data['channels'][channel]['units'] != 'mGal':
            raise ValueError('normal removal requires gravity_observed in mGal')
        baselode.geophysics.corrections._gravity_context(data, params)
        ledger = baselode.geophysics.corrections._load(data)
        states = baselode.geophysics.corrections._states(data, ledger)
        for correction in ('gravity_normal', 'gravity_free_air', 'gravity_bouguer', 'gravity_terrain'):
            state = states[correction][channel]
            if state == 'unknown':
                raise baselode.geophysics.corrections._NeedsInput('declare evidence-backed unapplied ' + correction + ' history')
            if state != 'unapplied':
                raise ValueError('normal-at-height removal conflicts with already applied ' + correction)
        if any(entry['id'] == params['event_id'] for entry in ledger['entries']):
            raise ValueError('event_id already exists')
        readings = [row for row in data['records'] if row['values'][channel] is not None]
        if not readings:
            raise baselode.geophysics.corrections._NeedsInput('selected channel needs at least one nonnull reading')
        if any(row['values'][channel] <= 0 for row in readings):
            raise ValueError('gravity_observed requires positive calibrated absolute magnitude in mGal; calibrate/tie relative or dial readings first')
        points = _points({'model': params['model'], 'height_policy': params['height_policy'], 'points': [{'id': row['id'], 'longitude': row['x'], 'latitude': row['y'], 'height_m': row['z']} for row in readings]})
        if len(ledger['entries']) >= baselode.geophysics.corrections._LIMITS['max_events']:
            raise baselode.geophysics.corrections._ResourceError('correction ledger exceeds event limit')
        fields = _evaluate(params['model'], points, params['height_policy'])
        before = ledger['current_binding']
        normal_binding = baselode.geophysics.corrections._normal_binding(data, params)
        metadata = data['metadata']
        nodes, operand = baselode.geophysics.provenance.append_input(metadata, metadata)
        for row, field in zip(readings, fields):
            corrected = row['values'][channel] - field['normal_gravity']
            if not baselode.geophysics.corrections._number(corrected):
                raise ValueError('disturbance exceeds finite portable numeric range')
            row['values'][channel] = corrected
            report['proposals'].append({'id': row['id'], 'normal_gravity': field['normal_gravity'], 'corrected_value': corrected, 'height_sensitivity_mGal_per_m': field['height_sensitivity_mGal_per_m'], 'height_extrapolated': field['height_extrapolated']})
        data['channels'][channel]['field_type'] = 'gravity_disturbance'
        after = baselode.geophysics.corrections._binding(data)
        model = copy.deepcopy(_DESCRIPTOR['models'][params['model']])
        ledger['entries'].append({'id': params['event_id'], 'kind': 'application', 'correction': 'gravity_normal', 'channels': [channel], 'state': 'applied', 'evidence': params['evidence'], 'producer': baselode.geophysics.corrections._producer(), 'input_binding': before, 'output_binding': after, 'parameters': params, 'model': model, 'normal_binding': normal_binding, 'affected_records': len(readings)})
        ledger['current_binding'] = after
        metadata['input_lineage'] = nodes
        for key in ('uncertainty', 'variance', 'standard_deviation'):
            metadata.pop(key, None)
        metadata['uncertainty_propagated'] = False
        metadata['processing'] = list(metadata.get('processing', [])) + [{'operation': 'remove_normal_gravity', 'version': 1, 'parameters': params, 'model': model, 'normal_binding': normal_binding, 'input_binding': before, 'output_binding': after, 'operand_lineage': operand}]
        output = baselode.geophysics.corrections._save(data, ledger)
        report.update(observations=output, ledger=copy.deepcopy(ledger), states=baselode.geophysics.corrections._states(output, ledger), diagnostics={'affected_records': len(readings), 'missing_readings': len(data['records']) - len(readings), 'continued_height_records': sum(p['height_extrapolated'] for p in report['proposals']), 'uncertainty_propagated': False})
    except (ValueError, TypeError, RuntimeError, RecursionError) as error:
        baselode.geophysics.corrections._error(report, error)
        if isinstance(error, _BackendError):
            report['state'] = 'failed'
            report['issues'][-1]['code'] = 'backend'
    return report
