# Copyright (C) 2026 Darkmine Pty Ltd
# SPDX-License-Identifier: GPL-3.0-or-later
"""Bounded radial and axial-direction spatial periodogram diagnostics."""
import copy
import json
import math
import pathlib

import numpy as np

import baselode
import baselode.geophysics.alignment
import baselode.geophysics.colour_scales
import baselode.geophysics.observations
import baselode.geophysics.processing
import baselode.geophysics.provenance
import baselode.geophysics.raster

_DESCRIPTOR = json.loads((pathlib.Path(__file__).parent / 'geophysics_spectrum.json').read_text())


class _NeedsInput(ValueError):
    pass


class _BackendError(RuntimeError):
    pass


def describe_spectrum():
    """Return independent spatial spectrum schemas, normalization and limits.

    Returns
    -------
    dict
        Explicit frequency/direction/unit/window conventions and assumptions.
    """
    return copy.deepcopy(_DESCRIPTOR)


def _label(value):
    return baselode.geophysics.observations._label(value) and baselode.geophysics.observations._trim(value).lower() not in ('unknown', 'unspecified')


def _parameters(options):
    schema = _DESCRIPTOR['parameters']
    if type(options) is not dict or options.keys() - schema['properties'].keys():
        raise ValueError('spectrum options must use only registered keys')
    if set(schema['required']) - options.keys():
        raise _NeedsInput('supply band, detrend, window, radial_bins, direction_bins and missing_policy')
    for key, spec in schema['properties'].items():
        value = options[key]
        if spec['type'] == 'integer':
            if type(value) not in (int, float) or not spec['minimum'] <= value <= spec['maximum'] or value != int(value):
                raise ValueError(key + ' violates its bounded integer schema')
        elif not isinstance(value, str) or value not in spec['enum']:
            raise ValueError(key + ' requires an explicit supported policy')
    return copy.deepcopy(options)


def _prepare(raster, options):
    params = _parameters(options)
    if not isinstance(raster, baselode.geophysics.raster.GeophysicsRaster):
        raise ValueError('expected GeophysicsRaster')
    if raster.data.size > 1000000 or raster.height * raster.width > 262144 or min(raster.height, raster.width) < 8:
        raise ValueError('spectrum requires at least 8x8, <=262144 selected cells and <=1000000 total source values')
    if params['band'] > raster.band_count:
        raise ValueError('band exceeds source band count')
    if raster.transform is None:
        raise _NeedsInput('declare affine geometry before spectral analysis')
    baselode.geophysics.alignment._source(raster)
    baselode.geophysics.provenance.encode(raster.metadata, 'GeoTIFF', 'float64')
    if len(json.dumps(raster.metadata, ensure_ascii=False, allow_nan=False).encode('utf-8')) > 524288:
        raise ValueError('source metadata exceeds 512 KiB spectrum budget')
    frame = raster.metadata.get('frame_id')
    if frame is not None and not _label(frame):
        raise ValueError('frame_id must be a known bounded string or null')
    if raster.crs is None and frame is None:
        raise _NeedsInput('declare a projected CRS or known local frame_id')
    if raster.crs is not None:
        if not baselode.geophysics.observations._text(raster.crs) or len(raster.crs) > 4096 or baselode.geophysics.observations._trim(raster.crs).lower() in ('unknown', 'unspecified'):
            raise ValueError('CRS must be a bounded known label')
        raster.crs.encode('utf-8')
    if not _label(raster.metadata.get('crs_units')):
        raise _NeedsInput('declare linear coordinate units')
    unit = baselode.geophysics.processing._coordinate_unit(raster)
    dx, dy = baselode.geophysics.processing._cell_size(raster)
    a, b, _, d, e, _ = raster.transform
    area = abs(a * e - b * d)
    if not all(math.isfinite(v) for v in (a / area, b / area, d / area, e / area, dx, dy)):
        raise ValueError('affine frequency scaling exceeds finite range')
    units = raster.metadata.get('units')
    if type(units) is not list or len(units) != raster.band_count or not _label(units[params['band'] - 1]) or not _label(raster.metadata.get('field_type')):
        raise _NeedsInput('declare a known scalar field_type and selected per-band units')
    band_name = raster.band_names[params['band'] - 1]
    if not _label(band_name):
        raise ValueError('selected band name must be a known bounded string')
    values = raster.data[params['band'] - 1].astype(float)
    valid = baselode.geophysics.colour_scales.valid_mask(raster.data[params['band'] - 1], raster.nodata)
    if not valid.all():
        raise _NeedsInput('selected band has missing cells; crop/select a complete region explicitly, no spectral gap filling')
    shape = [baselode.geophysics.processing._fft_size(raster.height), baselode.geophysics.processing._fft_size(raster.width)]
    size = shape[0] * shape[1]
    if size > 1048576:
        raise ValueError('spectrum FFT exceeds 1048576 cells')
    frequency_area = 1 / (size * area)
    bound = 64 * values.size * float(np.max(np.abs(values))) ** 2 * area
    if not math.isfinite(frequency_area) or frequency_area <= 0 or not math.isfinite(bound):
        raise ValueError('value/cell-area scaling exceeds finite power-density range')
    return params, values, shape, frequency_area, min(1 / (2 * dx), 1 / (2 * dy)), unit


def _bin_index(scaled, count, axial=False):
    rounded = np.rint(scaled)
    snapped = np.where(np.abs(scaled - rounded) <= 1e-10, rounded, scaled)
    index = np.floor(snapped).astype(int)
    return index % count if axial else np.clip(index, 0, count - 1)


def _aggregate(index, power, count, frequency_area):
    counts = np.bincount(index, minlength=count)
    sums = np.bincount(index, weights=power, minlength=count)
    return [{'count': int(n), 'power_sum': float(s), 'mean_power_density': float(s / int(n) / frequency_area) if n else None} for n, s in zip(counts, sums)]


def _calculate(raster, params, values, shape, frequency_area, limit, unit):
    if params['detrend'] == 'none':
        trend = 0
    elif params['detrend'] == 'mean':
        trend = float(np.mean(values))
    else:
        trend = baselode.geophysics.processing._plane(values, np.ones(values.shape, dtype=bool))
        if trend is None:
            raise _NeedsInput('selected region does not support a plane')
    residual = values - trend
    window = np.ones(values.shape)
    if params['window'] == 'hann_periodic':
        window = np.outer(.5 - .5 * np.cos(2 * np.pi * np.arange(raster.height) / raster.height), .5 - .5 * np.cos(2 * np.pi * np.arange(raster.width) / raster.width))
    weighted = residual * window
    energy = float(np.sum(window ** 2))
    try:
        transform = np.fft.fft2(weighted, s=shape)
    except (ValueError, RuntimeError, FloatingPointError) as error:
        raise _BackendError(str(error)) from error
    power = (transform.real ** 2 + transform.imag ** 2) / (shape[0] * shape[1] * energy)
    if not np.isfinite(power).all():
        raise _BackendError('nonfinite spectral power')
    east, north = baselode.geophysics.processing._map_wavenumbers(raster, shape)
    radius = np.hypot(east, north)
    inside = (radius > 0) & (radius <= limit * (1 + 1e-12))
    outside = (radius > 0) & ~inside
    radial_index = _bin_index(radius[inside] / limit * params['radial_bins'], params['radial_bins'])
    angle = np.mod(np.degrees(np.arctan2(east[inside], north[inside])), 180)
    direction_index = _bin_index(angle / 180 * params['direction_bins'], params['direction_bins'], True)
    radial = _aggregate(radial_index, power[inside], params['radial_bins'], frequency_area)
    directional = _aggregate(direction_index, power[inside], params['direction_bins'], frequency_area)
    for i, item in enumerate(radial):
        low, high = limit * i / params['radial_bins'], limit * (i + 1) / params['radial_bins']
        item.update(frequency_low=low, frequency_high=high, wavelength_low=1 / high, wavelength_high=1 / low if low else None)
    for i, item in enumerate(directional):
        item.update(azimuth_low=180 * i / params['direction_bins'], azimuth_high=180 * (i + 1) / params['direction_bins'])
    total, spatial = float(np.sum(power)), float(np.sum(weighted ** 2) / energy)
    tolerance = float(64 * np.finfo(float).eps * max(1, float(np.max(np.abs(values)))))
    nodes, operand = baselode.geophysics.provenance.append_input({}, raster.metadata)
    metadata = {'input_lineage': nodes, 'processing': [{'operation': 'analyze_grid_spectrum', 'version': 1, 'parameters': copy.deepcopy(params), 'operand_lineage': operand}], 'uncertainty_propagated': False}
    baselode.geophysics.provenance.encode(metadata, 'GeoTIFF', 'float64')
    source_unit = raster.metadata['units'][params['band'] - 1]
    return {'parameters': params, 'source': {'shape': [raster.height, raster.width], 'band': params['band'], 'band_name': raster.band_names[params['band'] - 1], 'crs': raster.crs, 'transform': list(raster.transform), 'field_type': raster.metadata['field_type']},
            'units': {'source': source_unit, 'power': '(' + source_unit + ')^2', 'density': '(' + source_unit + ')^2*' + unit + '^2', 'frequency': '1/' + unit, 'wavelength': unit},
            'radial': radial, 'directional': directional, 'metadata': metadata,
            'diagnostics': {'fft_shape': shape, 'window_energy': energy, 'frequency_cell_area': frequency_area, 'radial_frequency_limit': limit,
                            'spectral_total_power': total, 'windowed_mean_square': spatial, 'parseval_absolute_error': abs(total - spatial),
                            'dc_power': float(power[0, 0]), 'outside_circle_power': float(np.sum(power[outside])), 'outside_circle_count': int(outside.sum()),
                            'included_power': float(np.sum(power[inside])), 'included_count': int(inside.sum()), 'numerical_amplitude_floor': tolerance,
                            'below_numerical_floor': bool(math.sqrt(total) <= tolerance)}}


def analyze_grid_spectrum(raster, options):
    """Calculate an explicit, bounded spatial periodogram report.

    Parameters
    ----------
    raster : GeophysicsRaster
        Rectangular projected/local raster with explicit affine/frame/linear
        units, known field_type and per-band units. The selected band must be
        complete; gaps are never filled. Other bands are not analysed.
    options : dict
        Required band (1-based), detrend ('none', 'mean', 'plane'), window
        ('boxcar', 'hann_periodic'), radial_bins (4..128), direction_bins
        (4..36) and missing_policy='reject'. See describe_spectrum().

    Returns
    -------
    dict
        Versioned state/issues, geometry/units, radial and axial wavevector
        direction bins, Parseval/DC/outside-support diagnostics, source
        lineage and algorithm/backend. Failed/invalid reports have no
        scientific arrays. Zero padding adds no independent resolution;
        power does not identify noise, geology, mineralisation or source depth.
    """
    result = {'schema': 'baselode.geophysics.spectrum_result', 'version': 1, 'state': 'ok', 'issues': [], 'radial': [], 'directional': [],
              'producer': {'library': 'baselode', 'version': baselode.__version__, 'algorithm_version': 1, 'backend': 'numpy', 'backend_version': np.__version__}, 'assumptions': copy.deepcopy(_DESCRIPTOR['assumptions'])}
    try:
        prepared = _prepare(raster, options)
        content = _calculate(raster, *prepared)
        if len(json.dumps({**result, **content}, ensure_ascii=False, allow_nan=False).encode('utf-8')) > 2097152:
            raise ValueError('spectrum report exceeds 2 MiB')
        result.update(content)
    except (_BackendError, np.linalg.LinAlgError) as error:
        result['state'] = 'failed'; result['issues'] = [{'code': 'backend', 'message': str(error)}]
    except (ValueError, TypeError, RecursionError, OverflowError) as error:
        result['state'] = 'needs_input' if isinstance(error, _NeedsInput) else 'rejected'
        result['issues'] = [{'code': 'spectrum', 'message': str(error)}]
    return result
