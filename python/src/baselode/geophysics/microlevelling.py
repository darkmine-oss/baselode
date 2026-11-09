# Copyright (C) 2026 Darkmine Pty Ltd
# SPDX-License-Identifier: GPL-3.0-or-later
"""Explicit directional residual-striping estimation for levelled magnetic grids."""
import copy
import json
import math
import pathlib

import numpy as np

import baselode.geophysics.alignment
import baselode.geophysics.colour_scales
import baselode.geophysics.observations
import baselode.geophysics.processing
import baselode.geophysics.provenance
import baselode.geophysics.raster

_DESCRIPTOR = json.loads((pathlib.Path(__file__).parent / 'geophysics_microlevelling.json').read_text())
_OPERATIONS = ('estimate_magnetic_microlevelling', 'microlevel_magnetic_grid')


class _NeedsInput(ValueError):
    pass


def describe_microlevelling():
    """Return an independent copy of the model, parameters and resource limits.

    Returns
    -------
    dict
        Explicit grid-state, direction, protection, spectral and cap contracts.
    """
    return copy.deepcopy(_DESCRIPTOR)


def _number(value):
    # Bound integers before float conversion so oversized JSON integers reject.
    return type(value) in (int, float) and abs(value) <= 1e100 and math.isfinite(value)


def _parameters(options):
    schema = _DESCRIPTOR['parameters']
    if type(options) is not dict or options.keys() - schema['properties'].keys():
        raise ValueError('unknown microlevelling options')
    if any(key not in options for key in schema['required']):
        raise _NeedsInput('supply every explicit microlevelling parameter, including protected_bounds')
    for key, spec in schema['properties'].items():
        value = options[key]
        if spec['type'] in ('number', 'integer'):
            if not _number(value):
                raise ValueError(key + ' must be a finite numeric scalar within +/-1e100')
            if spec['type'] == 'integer' and value != int(value):
                raise ValueError(key + ' must be an integer')
            if ('minimum' in spec and value < spec['minimum']) or ('maximum' in spec and value > spec['maximum']) or ('exclusiveMinimum' in spec and value <= spec['exclusiveMinimum']):
                raise ValueError(key + ' violates its declared range')
        elif spec['type'] == 'string':
            if not isinstance(value, str) or not spec.get('minLength', 0) <= len(value) <= spec.get('maxLength', 4096):
                raise ValueError(key + ' must be a bounded string')
            if 'enum' in spec and value not in spec['enum']:
                raise ValueError(key + ' requires an explicit supported policy')
        else:
            if type(value) is not list or len(value) > 16 or any(type(box) is not list or len(box) != 4 or not all(_number(v) for v in box) or not (box[0] < box[2] and box[1] < box[3]) for box in value):
                raise ValueError('protected_bounds requires at most 16 finite positive-area [xmin,ymin,xmax,ymax] boxes')
    baselode.geophysics.provenance._json_value(options)
    if len(json.dumps(options, ensure_ascii=False, allow_nan=False).encode('utf-8')) > 262144:
        raise ValueError('microlevelling options exceed 256 KiB')
    if not baselode.geophysics.observations._text(options['evidence']):
        raise _NeedsInput('declare supporting survey/levelling/geometry evidence')
    if options['along_line_wavelength'] < 2 * options['across_line_wavelength'] or options['across_line_wavelength'] < 2 * options['line_spacing']:
        raise ValueError('require along wavelength >= 2*across wavelength >= 4*line spacing')
    return copy.deepcopy(options)


def _prepare(raster, options):
    params = _parameters(options)
    if not isinstance(raster, baselode.geophysics.raster.GeophysicsRaster):
        raise ValueError('expected GeophysicsRaster')
    if raster.band_count != 1 or min(raster.height, raster.width) < 16 or raster.data.size > 262144:
        raise ValueError('require one band, at least 16x16 and at most 262144 source cells')
    baselode.geophysics.alignment._source(raster)
    baselode.geophysics.provenance.encode(raster.metadata, 'GeoTIFF', 'float64')
    json.dumps(raster.metadata, ensure_ascii=False, allow_nan=False).encode('utf-8')
    frame = raster.metadata.get('frame_id')
    if frame is not None and (not baselode.geophysics.observations._label(frame) or baselode.geophysics.observations._trim(frame).lower() in ('unknown', 'unspecified')):
        raise ValueError('frame_id must be a known bounded string or null')
    if raster.crs is None and frame is None:
        raise _NeedsInput('declare a projected CRS or known local frame_id')
    if raster.crs is not None:
        if not baselode.geophysics.observations._text(raster.crs) or len(raster.crs) > 4096 or baselode.geophysics.observations._trim(raster.crs).lower() in ('unknown', 'unspecified'):
            raise ValueError('declare a bounded known CRS label')
        raster.crs.encode('utf-8')
    if not baselode.geophysics.observations._label(raster.metadata.get('crs_units')):
        raise _NeedsInput('declare linear coordinate units explicitly')
    baselode.geophysics.processing._coordinate_unit(raster)
    cell_x, cell_y = baselode.geophysics.processing._cell_size(raster)
    if not all(math.isfinite(v) and v > 0 for v in (cell_x, cell_y)):
        raise ValueError('require finite positive rectangular cell spacing')
    if max(cell_x, cell_y) > params['line_spacing'] / 2 * (1 + 1e-12):
        raise ValueError('cell spacing must be <= half the measured line spacing')
    if raster.metadata.get('field_type') != 'magnetic_anomaly' or raster.metadata.get('units') != ['nT']:
        raise ValueError('require a one-band magnetic_anomaly grid with units [nT]')
    state = raster.metadata.get('grid_corrections')
    if type(state) is not dict or state.get('magnetic_levelling') != 'applied' or state.get('magnetic_microlevelling') != 'unapplied':
        raise _NeedsInput('verify current metadata.grid_corrections: magnetic_levelling applied, magnetic_microlevelling unapplied')
    if any(type(step) is dict and step.get('operation') == 'microlevel_magnetic_grid' for step in raster.metadata.get('processing', [])):
        raise ValueError('microlevelling already appears in current-grid history; repeated application is unsupported')
    azimuth = math.radians(params['flight_azimuth'])
    along = (math.sin(azimuth), math.cos(azimuth))
    across = (along[1], -along[0])
    a, b, c, d, e, f = raster.transform
    determinant = a * e - b * d
    if not all(math.isfinite(v / determinant) for v in (a, b, d, e)):
        raise ValueError('inverse affine exceeds backend frequency range')
    extent = lambda direction: abs(a * direction[0] + d * direction[1]) * raster.width + abs(b * direction[0] + e * direction[1]) * raster.height
    if extent(along) < params['along_line_wavelength'] * (1 - 1e-12) or extent(across) < 4 * params['line_spacing'] * (1 - 1e-12):
        raise ValueError('grid needs one along cutoff wavelength and at least four measured line spacings across')
    length = params['along_line_wavelength']
    if not all(math.isfinite(length / spacing) for spacing in (cell_x, cell_y)):
        raise ValueError('wavelength/cell ratio exceeds backend range')
    rows = baselode.geophysics.processing._fft_size(raster.height + 2 * baselode.geophysics.processing._pad_cells(length, cell_y, raster.height))
    columns = baselode.geophysics.processing._fft_size(raster.width + 2 * baselode.geophysics.processing._pad_cells(length, cell_x, raster.width))
    if rows * columns > 4194304:
        raise ValueError('padded FFT exceeds 4194304 cells')
    values = raster.data[0].astype(float)
    valid = baselode.geophysics.colour_scales.valid_mask(raster.data[0], raster.nodata)
    row, col = np.indices(values.shape, dtype=float)
    x, y = a * (col + .5) + b * (row + .5) + c, d * (col + .5) + e * (row + .5) + f
    protected = np.zeros(values.shape, dtype=bool)
    for xmin, ymin, xmax, ymax in params['protected_bounds']:
        inside = (x >= xmin) & (x <= xmax) & (y >= ymin) & (y <= ymax) & valid
        if not inside.any():
            raise ValueError('every protection box must contain a valid input cell centre')
        protected |= inside
    training = valid & ~protected
    fraction = int(training.sum()) / values.size
    if training.sum() < 64 or fraction < params['min_training_fraction']:
        raise _NeedsInput('insufficient unprotected training coverage')
    margin = params['edge_margin_cells']
    eligible = training & (row >= margin) & (col >= margin) & (row < raster.height - margin) & (col < raster.width - margin)
    if not eligible.any():
        raise _NeedsInput('no supported unprotected interior application cells')
    diagnostics = {'input_valid_cells': int(valid.sum()), 'training_cells': int(training.sum()), 'training_fraction': fraction,
                   'protected_valid_cells': int(protected.sum()), 'application_cells': int(eligible.sum()),
                   'padded_fft_shape': [rows, columns], 'uncertainty_propagated': False}
    return params, values, valid, training, eligible, along, across, diagnostics


def _preflight(raster, options):
    return _prepare(raster, options)[-1]


def _calculate(raster, options, apply):
    params, values, valid, training, eligible, along, across, diagnostics = _prepare(raster, options)
    source = raster.copy_with(np.where(training, values, np.nan), nodata=None)

    def response(east, north):
        # Saturation avoids squared-frequency overflow without altering any
        # representable response at scientific precision.
        low = np.minimum(np.abs((east * along[0] + north * along[1]) * params['along_line_wavelength']), 32)
        high = np.minimum(np.abs((east * across[0] + north * across[1]) * params['across_line_wavelength']), 32)
        return np.exp(-math.log(2) * low ** 2) * -np.expm1(-math.log(2) * high ** 2)

    candidate = baselode.geophysics.processing._fourier_bands(source, response, keep_trend=False, pad_length=params['along_line_wavelength'])[0]
    if not np.all(np.isfinite(candidate[eligible])):
        raise ValueError('nonfinite FFT correction; no product returned')
    # Preserve constant/plane grids exactly at double precision.
    tolerance = float(64 * np.finfo(float).eps * max(1, float(np.max(np.abs(values[training])))))
    correction = np.where(valid, 0., np.nan)
    correction[eligible] = np.where(np.abs(candidate[eligible]) <= tolerance, 0., candidate[eligible])
    peak = float(np.max(np.abs(correction[eligible])))
    diagnostics.update(max_abs_correction=peak, correction_rms=float(np.sqrt(np.mean(correction[eligible] ** 2))),
                       application_supported=peak <= params['max_abs_correction'], numerical_zero_tolerance=tolerance,
                       response_at_line_spacing=1 - 2 ** (-min(32, params['across_line_wavelength'] / params['line_spacing']) ** 2))
    if apply and not diagnostics['application_supported']:
        raise ValueError('estimated correction exceeds max_abs_correction; inspect candidate and geology, no clipping/application')
    operation = 'microlevel_magnetic_grid' if apply else 'estimate_magnetic_microlevelling'
    metadata = {key: copy.deepcopy(raster.metadata[key]) for key in ('crs_units', 'frame_id') if key in raster.metadata}
    nodes, operand = baselode.geophysics.provenance.append_input({}, raster.metadata)
    metadata.update(field_type='magnetic_anomaly' if apply else 'other', units=['nT'], uncertainty_propagated=False, input_lineage=nodes,
                    processing=[{'operation': operation, 'version': 1, 'parameters': copy.deepcopy(params), 'operand_lineage': operand}],
                    microlevelling={'kind': 'applied' if apply else 'estimated_correction', 'model': copy.deepcopy(_DESCRIPTOR['model']),
                                    'parameters': copy.deepcopy(params), 'diagnostics': diagnostics})
    if apply:
        metadata['grid_corrections'] = {**copy.deepcopy(raster.metadata['grid_corrections']), 'magnetic_microlevelling': 'applied'}
    baselode.geophysics.provenance.encode(metadata, 'GeoTIFF', 'float64')
    output = np.where(valid, values - correction if apply else correction, np.nan)
    return raster.copy_with(output, nodata=None, band_names=raster.band_names if apply else ['microlevelling_correction'], metadata=metadata)


def estimate_magnetic_microlevelling(raster, options):
    """Estimate bounded-domain directional striping without applying it.

    Parameters
    ----------
    raster : GeophysicsRaster
        One-band magnetic_anomaly/nT, rectangular projected/local Cartesian
        geometry, explicit linear crs_units and current grid_corrections states
        magnetic_levelling='applied', magnetic_microlevelling='unapplied'.
    options : dict
        All parameters in describe_microlevelling()['parameters'] are required:
        flight_azimuth clockwise from CRS north, line_spacing, along/across_line
        wavelengths in CRS units, max_abs_correction in nT, protected_bounds
        (cell-centre map boxes), unchanged edge_margin_cells,
        min_training_fraction, reference_policy='caller_verified', evidence and
        geology_policy='directional_overlap_acknowledged'. No defaults/inference.

    Returns
    -------
    GeophysicsRaster
        Candidate subtraction grid (other/nT), zero at protected/edge cells,
        original missing mask, source lineage and support/cap diagnostics.
        An exceeded cap sets application_supported=False; inspect before applying.
        Real geology with the same directional spectrum is indistinguishable.
    """
    return _calculate(raster, options, False)


def microlevel_magnetic_grid(raster, options):
    """Subtract a candidate correction from the original verified anomaly grid.

    Parameters
    ----------
    raster : GeophysicsRaster
        Original grid, not the estimated correction. See estimation contract.
    options : dict
        Explicit portable parameters; see estimate_magnetic_microlevelling.
        Application rejects an exceeded correction cap atomically, never clips.

    Returns
    -------
    GeophysicsRaster
        Magnetic anomaly/nT with original geometry/mask, unchanged protected
        and edge cells, applied current-grid history and archived source
        uncertainty (not propagated). Repeated application is unsupported.
    """
    return _calculate(raster, options, True)
