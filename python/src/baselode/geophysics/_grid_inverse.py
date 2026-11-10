# Copyright (C) 2026 Darkmine Pty Ltd
# SPDX-License-Identifier: GPL-3.0-or-later
"""Shared arrays for bounded matrix-free grid objectives; no public execution."""
import copy
import math
import numpy as np
try:
    import scipy.sparse as _sparse
except ImportError:
    _sparse = None
import baselode.geophysics.potential_field_operator


def _arrays(p, template, diag):
    parameters = p['parameters']
    n = len(parameters)
    reference = np.array([row['reference'] for row in parameters], dtype=float)
    scale = np.array([row['scale'] for row in parameters], dtype=float)
    lower = (np.array([row['lower'] for row in parameters])-reference)/scale
    upper = (np.array([row['upper'] for row in parameters])-reference)/scale
    lookup = {point['id']: i for i, point in enumerate(template['points'])}
    order, data, sigma = [], [], []
    for j, dataset in enumerate(p['observed']):
        for row in dataset['records']:
            order.append(j*diag['points']+lookup[row['id']])
            data.append(float(row['value']))
            sigma.append(float(row['standard_deviation']))
    order = np.array(order)
    indices = {(row['cell_id'], row['parameter']): i for i, row in enumerate(parameters)}
    names = baselode.geophysics.potential_field_operator._config(template['model_kind'])[0]
    ri, ci, values = [], [], []
    count = 0
    for edge in p['regularization']['edges']:
        for name in names:
            ri.extend([count, count])
            ci.extend([indices[(edge['cell_a'], name)], indices[(edge['cell_b'], name)]])
            values.extend([math.sqrt(edge['weight']), -math.sqrt(edge['weight'])])
            count += 1
    difference = _sparse.csr_matrix((values, (ri, ci)), shape=(count, n))
    return {'reference': reference, 'scale': scale, 'lower': lower, 'upper': upper,
            'order': order, 'inverse_order': np.argsort(order), 'data': np.array(data),
            'sigma': np.array(sigma), 'difference': difference}


def _fitted(template, indices, values):
    fitted = copy.deepcopy(template)
    names = baselode.geophysics.potential_field_operator._config(template['model_kind'])[0]
    for position, index in enumerate(indices):
        for j in range(len(names)):
            fitted['values'][index*len(names)+j] = float(values[position*len(names)+j])
    return fitted
