# Copyright (C) 2026 Darkmine Pty Ltd
# SPDX-License-Identifier: GPL-3.0-or-later
"""Bounded, explicit unrotated block-model adapters to verified prism kernels."""
import copy
import json
import pathlib

import baselode.geophysics.corrections
import baselode.geophysics.forward_common
import baselode.geophysics.gravity_prisms
import baselode.geophysics.magnetic_forward
import baselode.geophysics.magnetic_prisms

_DESCRIPTOR = json.loads((pathlib.Path(__file__).parent/'geophysics_block_forward.json').read_text())
_J = ('magnetization_x_A_m','magnetization_y_A_m','magnetization_z_up_A_m')


def _keys(value,required,optional=()):
    if type(value) is not dict or value.keys()-set(required)-set(optional):raise ValueError('unknown fields or invalid object')
    nullable={'active_column','background_nT','min_distance_m','parent_size'}
    if set(required)-value.keys() or any(value[k] is None for k in required if k not in nullable):raise baselode.geophysics.corrections._NeedsInput('supply every required block forward field')


def describe_block_forward():
    """Return independent shared block request, preparation and result contracts.

    Returns
    -------
    dict
        Explicit property/frame policies, unrotated support and work budgets.
    """
    return copy.deepcopy(_DESCRIPTOR)


def _prepare(request):
    p = baselode.geophysics.forward_common._bounded_json(request,2097152)
    _keys(p,('schema','version','coordinate_frame','model','physics','cell_id_column','active_column','properties','points','batch_size','include_sensitivities','background_nT','min_distance_m'),('metadata',))
    if p['schema']!='baselode.geophysics.block_forward_request' or type(p['version']) not in (int,float) or p['version']!=1 or p['physics'] not in ('gravity','magnetic'):
        raise ValueError('unsupported block forward schema/version/physics')
    baselode.geophysics.forward_common._number(p['batch_size'],1,64)
    if int(p['batch_size'])!=p['batch_size']:raise ValueError('batch_size must be integer')
    baselode.geophysics.forward_common._label(p['cell_id_column'])
    if p['active_column'] is not None:baselode.geophysics.forward_common._label(p['active_column'])
    if 'metadata' in p:
        if type(p['metadata']) is not dict:raise ValueError('metadata must be object')
        baselode.geophysics.forward_common._bounded_json(p['metadata'],131072)
    model=p['model'];_keys(model,('definition','blocks'))
    d=model['definition'];_keys(d,('name','description','crs','origin','block_size','n_blocks','parent_size','rotation','extra'))
    if not isinstance(d['name'],str) or not isinstance(d['description'],str) or type(d['extra']) is not dict:raise ValueError('invalid definition metadata')
    baselode.geophysics.forward_common._label(d['crs'])
    if type(p['coordinate_frame']) is not dict or p['coordinate_frame'].get('id')!=d['crs']:raise baselode.geophysics.corrections._NeedsInput('coordinate_frame.id must equal definition.crs')
    values=[]
    for key,axes,lo,hi,integer in (('origin',('x','y','z'),-1e12,1e12,False),('block_size',('dx','dy','dz'),.001,100000,False),('n_blocks',('nx','ny','nz'),1,1000000,True),('rotation',('azimuth','dip','plunge'),-360,360,False)):
        _keys(d[key],axes);v=[d[key][axis] for axis in axes]
        for item in v:
            baselode.geophysics.forward_common._number(item,lo,hi)
            if integer and int(item)!=item:raise ValueError('grid counts must be integer')
        values.append(v)
    origin,size,counts,rotation=values
    if any(rotation):raise baselode.geophysics.corrections._NeedsInput('rotated block models are unsupported in block forward v1; do not substitute bounding boxes')
    if d['parent_size'] is not None:
        _keys(d['parent_size'],('nx','ny','nz'))
        for v in d['parent_size'].values():
            baselode.geophysics.forward_common._number(v,1,1000000)
            if int(v)!=v:raise ValueError('parent counts must be integer')
    props=p['properties'];parameters=('density_contrast_kg_m3',) if p['physics']=='gravity' else _J
    _keys(props,parameters)
    for spec in props.values():
        _keys(spec,('column','units'));baselode.geophysics.forward_common._label(spec['column'])
        if spec['units']!=('kg/m^3' if p['physics']=='gravity' else 'A/m'):raise ValueError('explicit density contrast kg/m^3 or world Cartesian magnetisation A/m required')
    rows=model['blocks']
    if type(rows) is not list or not rows:raise ValueError('blocks must be nonempty array')
    if len(rows)>512:raise baselode.geophysics.corrections._ResourceError('block count exceeds512')
    sources=[];inactive=[];ids=set();geometries=[]
    for row in rows:
        if type(row) is not dict:raise ValueError('block row must be object')
        identity=row.get(p['cell_id_column']);baselode.geophysics.forward_common._label(identity)
        if identity in ids:raise ValueError('cell IDs must be unique')
        ids.add(identity);idx=[];extent=[]
        for i,(k,nk) in enumerate(zip(('i','j','k'),('ni','nj','nk'))):
            a=row.get(k);n=row.get(nk);baselode.geophysics.forward_common._number(a,0,1000000);baselode.geophysics.forward_common._number(n,1,1000000)
            if int(a)!=a or int(n)!=n or a+n>counts[i]:raise ValueError('integer block geometry must lie within grid')
            idx.append(a);extent.append(n)
        bounds=[float(origin[i])+float(v)*float(size[i]) for i in range(3) for v in (idx[i],idx[i]+extent[i])]
        geometric=('x','y','z','dx','dy','dz')
        if any(k in row for k in geometric):
            if not all(k in row for k in geometric):raise ValueError('supply all centroid/size columns or none')
            expected=[float(origin[i])+(float(idx[i])+float(extent[i])/2)*float(size[i]) for i in range(3)]+[float(extent[i])*float(size[i]) for i in range(3)]
            for k,v in zip(geometric,expected):
                baselode.geophysics.forward_common._number(row[k],-1e12,1e12)
                if abs(float(row[k])-v)>1e-6:raise ValueError('centroid/size disagrees with authoritative grid indices')
        active=True if p['active_column'] is None else row.get(p['active_column'])
        if type(active) is not bool:raise ValueError('active column requires explicit boolean for every cell')
        if not active:inactive.append(identity);continue
        if 'fill_fraction' in row and (type(row['fill_fraction']) not in (int,float) or row['fill_fraction']!=1):raise baselode.geophysics.corrections._NeedsInput('partial fill_fraction requires an explicit resolved geometry/model')
        for previous in geometries:
            if all(max(bounds[2*i],previous[2*i])<min(bounds[2*i+1],previous[2*i+1]) for i in range(3)):raise ValueError('active cells overlap')
        geometries.append(bounds)
        source={'id':identity,'kind':'prism','bounds_m':bounds}
        for parameter in parameters:
            value=row.get(props[parameter]['column']);baselode.geophysics.forward_common._number(value,-100000 if p['physics']=='gravity' else -1000,100000 if p['physics']=='gravity' else 1000);source[parameter]=value
        sources.append(source)
    if not sources:raise baselode.geophysics.corrections._NeedsInput('at least one active cell required')
    if type(p['points']) is not list or not p['points']:raise ValueError('points must be nonempty array')
    pairs=len(sources)*len(p['points']);maximum=4096 if p['physics']=='gravity' else 2048
    if pairs>32768 or (p['include_sensitivities'] and pairs>maximum):raise baselode.geophysics.corrections._ResourceError('global active cell-point budget exceeded')
    if p['physics']=='gravity' and (p['background_nT'] is not None or p['min_distance_m'] is not None):raise ValueError('gravity requires explicit null magnetic settings')
    batches=[];step=int(p['batch_size'])
    for offset in range(0,len(sources),step):
        child={'schema':'baselode.geophysics.'+p['physics']+'_prisms_request','version':1,'coordinate_frame':p['coordinate_frame'],'sources':sources[offset:offset+step],'points':p['points'],'include_sensitivities':p['include_sensitivities']}
        if p['physics']=='magnetic':child.update(background_nT=p['background_nT'],min_distance_m=p['min_distance_m'])
        validation=baselode.geophysics.gravity_prisms.validate_gravity_prisms(child) if p['physics']=='gravity' else baselode.geophysics.magnetic_prisms.validate_magnetic_prisms(child)
        if validation['state']!='ok':
            message=validation['issues'][0]['message'];code=validation['issues'][0]['code']
            if code=='context':raise baselode.geophysics.corrections._NeedsInput(message)
            if code=='resource':raise baselode.geophysics.corrections._ResourceError(message)
            raise ValueError(message)
        batches.append(child)
    for i,k in enumerate(('x_m','y_m','z_m')):
        values=[s['bounds_m'][2*i+j] for s in sources for j in (0,1)]+[point[k] for point in p['points']]
        if max(values)-min(values)>200000:raise baselode.geophysics.corrections._ResourceError('global span exceeds200km')
    return p,batches,[s['id'] for s in sources],inactive,{'cell_count':len(rows),'active_count':len(sources),'point_count':len(p['points']),'pair_count':pairs,'batch_count':len(batches)}


def _report(schema):
    return {'schema':'baselode.geophysics.block_forward_'+schema,'version':1,'state':'ok','issues':[],'request':None,'batches':[],'cell_ids':[],'inactive_ids':[],'diagnostics':{},'producer':baselode.geophysics.corrections._producer()}


def _error(report,error):
    baselode.geophysics.gravity_prisms._error(report,error)
    report.update(batches=[],cell_ids=[],inactive_ids=[])


def prepare_block_forward(request):
    """Prepare validated prism batches from a portable Baselode block model.

    Parameters
    ----------
    request : dict
        V1 block_forward_request. Serialize definition.to_dict() and block
        records, declare ID/active/property columns and world metre/up frame.
        Unrotated grids only; no snapping, unit conversion or partial-fill guess.

    Returns
    -------
    dict
        Atomic state/issues, immutable input, child requests, active/inactive IDs
        and global work diagnostics. Core-only; no optional numerical imports.
    """
    report=_report('preparation')
    try:
        p,batches,ids,inactive,diagnostics=_prepare(request);report.update(request=p,batches=batches,cell_ids=ids,inactive_ids=inactive,diagnostics=diagnostics)
        baselode.geophysics.forward_common._bounded_json(report,8388608,result=True)
    except (ValueError,TypeError,RecursionError,ArithmeticError,RuntimeError) as error:_error(report,error)
    return report


def calculate_block_forward(request):
    """Calculate complete block gravity/magnetic fields through pinned prisms.

    Parameters
    ----------
    request : dict
        Same portable contract as prepare_block_forward. Revalidated on every
        execution. Sources/batches accumulate in input order; exact TMI follows
        the global vector sum, never the sum of per-batch exact TMI.

    Returns
    -------
    dict
        Preparation evidence plus fields, fixed-property sensitivities and units.
        All numerical failures withhold all outputs. No induced magnetisation,
        inversion, rotation support or uncertainty propagation is inferred.

    Raises
    ------
    ImportError
        Requires baselode[potential-fields] for numerical execution.
    """
    baselode.geophysics.gravity_prisms._require_backend()
    report=_report('result');report.update(fields=[],sensitivities=[],field_units={})
    try:
        p,batches,ids,inactive,diagnostics=_prepare(request);magnetic=p['physics']=='magnetic'
        components=('bx','by','bz_up') if magnetic else ('gx','gy','gz_up','potential')
        totals=[[0.]*len(components) for _ in p['points']];corrections=copy.deepcopy(totals);sensitivities=[];units={}
        for batch in batches:
            child=baselode.geophysics.magnetic_prisms.calculate_magnetic_prisms(batch) if magnetic else baselode.geophysics.gravity_prisms.calculate_gravity_prisms(batch)
            if child['state']!='ok':raise RuntimeError('child prism calculation '+child['state']+': '+child['issues'][0]['message'])
            units=child['field_units'];sensitivities.extend(child['sensitivities'])
            for i,row in enumerate(child['fields']):
                for j,key in enumerate(components):baselode.geophysics.forward_common._add(totals[i],corrections[i],j,row[key])
        fields=[];background=None if p['background_nT'] is None else [p['background_nT'][k] for k in ('x','y','z_up')]
        for point,total,correction in zip(p['points'],totals,corrections):
            vector=[a+b for a,b in zip(total,correction)]
            if magnetic:
                row=baselode.geophysics.magnetic_forward._field(point['id'],vector,background);exact=None if background is None else baselode.geophysics.magnetic_forward._total_field(vector,background)
                row.update(tmi_exact=exact,linearization_difference=None if exact is None else exact-row['tmi_linear'])
            else:row=baselode.geophysics.gravity_prisms._field(point['id'],vector)
            fields.append(row)
        report.update(request=p,batches=batches,cell_ids=ids,inactive_ids=inactive,diagnostics=diagnostics,fields=fields,sensitivities=sensitivities,field_units=units)
        baselode.geophysics.forward_common._bounded_json(report,8388608,result=True)
    except (ValueError,TypeError,RecursionError,ArithmeticError,RuntimeError) as error:
        _error(report,error);report['field_units']={}
    return report
