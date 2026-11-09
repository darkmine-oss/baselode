# Copyright (C) 2026 Darkmine Pty Ltd
# SPDX-License-Identifier: GPL-3.0-or-later
"""Native matched geophysical residuals, coverage and supplied-sigma misfit."""
import copy
import json
import math
import pathlib

import baselode.geophysics.corrections
import baselode.geophysics.forward_common

_DESCRIPTOR=json.loads((pathlib.Path(__file__).parent/'geophysics_misfit.json').read_text())
_COORDS=('x_m','y_m','z_m')


def describe_misfit():
    """Return independent request/result schemas, quantities and statistical rules.

    Returns
    -------
    dict
        Native core-only residual/coverage/diagonal-sigma contract and budgets.
    """
    return copy.deepcopy(_DESCRIPTOR)


def _context(context):
    baselode.geophysics.forward_common._keys(context,('quantity','units','field_type','reference_id','coordinate_frame'))
    if type(context['quantity']) is not str or context['quantity'] not in _DESCRIPTOR['quantities']:
        raise ValueError('unsupported physical quantity')
    spec=_DESCRIPTOR['quantities'][context['quantity']]
    if context['units']!=spec['units'] or context['field_type'] not in spec['field_types']:
        raise ValueError('quantity/units/field_type are incompatible; supply reduced compatible data')
    baselode.geophysics.forward_common._label(context['reference_id']);f=context['coordinate_frame']
    baselode.geophysics.forward_common._keys(f,('id','kind','axes','units','height_datum'))
    baselode.geophysics.forward_common._label(f['id']);baselode.geophysics.forward_common._label(f['height_datum'])
    if (f['kind'],f['axes'],f['units'])!=('local_cartesian','x_y_up','m'):
        raise ValueError('declare shared local Cartesian metre/up geometry')


def _prepare(request):
    p=baselode.geophysics.forward_common._bounded_json(request,_DESCRIPTOR['resources']['max_input_bytes'])
    baselode.geophysics.forward_common._keys(p,('schema','version','observed','predicted','options'),('metadata',))
    if p['schema']!='baselode.geophysics.misfit_request' or type(p['version']) not in (int,float) or p['version']!=1:raise ValueError('unsupported misfit schema/version')
    options=p['options'];baselode.geophysics.forward_common._keys(options,('coverage_policy','weighting','coordinate_tolerance_m','residual_convention'))
    if options['coverage_policy'] not in ('complete','paired_only') or options['weighting'] not in ('none','standard_deviation') or options['residual_convention']!='observed_minus_predicted':raise ValueError('declare supported coverage, weighting and residual sign policies')
    baselode.geophysics.forward_common._number(options['coordinate_tolerance_m'],0,1000)
    if 'metadata' in p:
        if type(p['metadata']) is not dict:raise ValueError('metadata must be an object')
        baselode.geophysics.forward_common._bounded_json(p['metadata'],131072)
    for role in ('observed','predicted'):
        dataset=p[role];baselode.geophysics.forward_common._keys(dataset,('context','records'));_context(dataset['context']);records=dataset['records']
        if type(records) is not list or not records:raise ValueError('records must be nonempty arrays')
        if len(records)>2048:raise baselode.geophysics.corrections._ResourceError('at most 2048 records per dataset')
        ids=set();groups=set()
        for row in records:
            required=('id',*_COORDS,'value')+(('standard_deviation','group_id') if role=='observed' else ())
            # Nullable readings/sigma/group must be declared, not inferred.
            if type(row) is not dict or row.keys()-set(required):raise ValueError('unknown record fields')
            if set(required)-row.keys():raise baselode.geophysics.corrections._NeedsInput('supply every record field, including explicit nullable values')
            baselode.geophysics.forward_common._label(row['id'])
            if row['id'] in ids:raise ValueError('record IDs must be unique in each dataset')
            ids.add(row['id'])
            for k in _COORDS:baselode.geophysics.forward_common._number(row[k],-1e12,1e12)
            if row['value'] is not None:baselode.geophysics.forward_common._number(row['value'],-1e20,1e20)
            if role=='observed':
                if row['standard_deviation'] is not None:baselode.geophysics.forward_common._number(row['standard_deviation'],1e-20,1e20)
                if row['group_id'] is not None:baselode.geophysics.forward_common._label(row['group_id'])
                groups.add(row['group_id'])
        if len(groups)>128:raise baselode.geophysics.corrections._ResourceError('at most 128 observed groups')
    if p['observed']['context']!=p['predicted']['context']:raise baselode.geophysics.corrections._NeedsInput('quantity/units/field type/reference/frame/datum must match; harmonise upstream')
    return p


def _rms(values):
    scale=max(abs(x) for x in values)
    return scale*math.sqrt(math.fsum((x/scale)**2 for x in values)/len(values)) if scale else 0


def _distance(d):
    scale=max(abs(x) for x in d)
    if not scale:return 0
    u=[x/scale for x in d]
    return scale*math.sqrt((u[0]*u[0]+u[1]*u[1])+u[2]*u[2])


def _statistics(rows,weighted):
    if not rows:return None
    n=len(rows);r=[row['residual'] for row in rows];sse=math.fsum(x*x for x in r)
    chi=math.fsum(row['normalized_residual']**2 for row in rows) if weighted else None
    return {'count':n,'bias':math.fsum(r)/n,'mae':math.fsum(abs(x) for x in r)/n,'rmse':_rms(r),'max_abs':max(abs(x) for x in r),'sse':sse,'chi_squared':chi,'normalized_rmse':_rms([row['normalized_residual'] for row in rows]) if weighted else None}


def calculate_misfit(request):
    """Compare explicitly compatible observed and predicted geophysical values.

    Parameters
    ----------
    request : dict
        Strict v1 request from describe_misfit(). Observed/predicted datasets
        have explicit matching context and ID/XYZ/value records. Observed
        standard_deviation and group_id are required nullable fields. Options
        explicitly select complete/paired_only coverage, none/supplied-sigma
        weighting, coordinate tolerance in metres and observed-minus-predicted
        residual sign. No interpolation, unit/reference/datum conversion.

    Returns
    -------
    dict
        Immutable input snapshot, residual/exception rows, coverage/group and
        bias/MAE/RMSE/SSE reports. Optional chi-squared and normalized RMSE use
        independent supplied standard deviations; no reduced chi-square or
        probability claim. All failures withhold rows/groups/summary/request.
    """
    report={'schema':'baselode.geophysics.misfit_result','version':1,'state':'ok','issues':[],'request':None,'rows':[],'groups':[],'summary':None,'unmatched_predicted_ids':[],'units':None,'producer':baselode.geophysics.corrections._producer(),'assumptions':copy.deepcopy(_DESCRIPTOR['assumptions'])}
    try:
        p=_prepare(request);observed=p['observed']['records'];predicted=p['predicted']['records'];lookup={r['id']:r for r in predicted};obs_ids={r['id'] for r in observed};options=p['options'];weighted=options['weighting']=='standard_deviation'
        unmatched=[r['id'] for r in predicted if r['id'] not in obs_ids]
        if options['coverage_policy']=='complete' and (unmatched or any(r['id'] not in lookup for r in observed)):raise baselode.geophysics.corrections._NeedsInput('complete coverage requires identical ID sets')
        rows=[];pairs=[];groups={}
        for row in observed:
            pred=lookup.get(row['id']);distance=None
            if pred is not None:
                d=[row[k]-pred[k] for k in _COORDS];distance=_distance(d)
                if distance>options['coordinate_tolerance_m']:raise baselode.geophysics.corrections._NeedsInput('matching ID coordinates exceed tolerance: '+row['id'])
            value=None if pred is None else pred['value'];reason='unmatched_observed' if pred is None else ('missing_both' if row['value'] is None and value is None else ('missing_observed' if row['value'] is None else ('missing_prediction' if value is None else 'paired')))
            if reason!='paired' and options['coverage_policy']=='complete':raise baselode.geophysics.corrections._NeedsInput('complete coverage requires nonmissing values: '+row['id'])
            if reason=='paired' and weighted and row['standard_deviation'] is None:raise baselode.geophysics.corrections._NeedsInput('supply standard deviation for paired record: '+row['id'])
            residual=row['value']-value if reason=='paired' else None
            if residual==0:residual=0
            result={'id':row['id'],'group_id':row['group_id'],'observed':row['value'],'predicted':value,'standard_deviation':row['standard_deviation'],'residual':residual,'normalized_residual':residual/row['standard_deviation'] if weighted and reason=='paired' else None,'coordinate_distance_m':distance,'reason':reason}
            if result['normalized_residual']==0:result['normalized_residual']=0
            rows.append(result);group=groups.setdefault(row['group_id'],{'count':0,'pairs':[]});group['count']+=1
            if reason=='paired':pairs.append(result);group['pairs'].append(result)
        if not pairs:raise baselode.geophysics.corrections._NeedsInput('at least one matched nonmissing pair is required')
        report.update(request=p,rows=rows,unmatched_predicted_ids=unmatched,summary={'observed_count':len(observed),'predicted_count':len(predicted),'paired_count':len(pairs),'observed_coverage':len(pairs)/len(observed),'predicted_coverage':len(pairs)/len(predicted),'statistics':_statistics(pairs,weighted),'uncertainty_assumption':'independent_standard_deviations' if weighted else 'not_used'},groups=[{'group_id':k,'observed_count':v['count'],'paired_count':len(v['pairs']),'coverage':len(v['pairs'])/v['count'],'statistics':_statistics(v['pairs'],weighted)} for k,v in groups.items()],units={'value':p['observed']['context']['units'],'residual':p['observed']['context']['units'],'normalized_residual':'dimensionless' if weighted else None})
        baselode.geophysics.forward_common._bounded_json(report,_DESCRIPTOR['resources']['max_result_bytes'],result=True)
    except (ValueError,TypeError,RecursionError,ArithmeticError,RuntimeError) as error:
        context=isinstance(error,baselode.geophysics.corrections._NeedsInput);resource=isinstance(error,baselode.geophysics.corrections._ResourceError);failed=isinstance(error,(ArithmeticError,RuntimeError)) and not(context or resource)
        report.update(state='needs_input' if context else ('failed' if failed else 'rejected'),request=None,rows=[],groups=[],summary=None,units=None,unmatched_predicted_ids=[],issues=[{'code':'context' if context else ('resource' if resource else ('backend' if failed else 'contract')),'message':str(error)}])
    return report
