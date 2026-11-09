# Copyright (C) 2026 Darkmine Pty Ltd
# SPDX-License-Identifier: GPL-3.0-or-later
"""Calibrated radiometric stacks, weak-denominator ratios and fixed-stretch RGB."""
import copy
import json
import math
import pathlib

import numpy as np

import baselode.geophysics.colour_scales
import baselode.geophysics.observations
import baselode.geophysics.provenance
import baselode.geophysics.raster

_DESCRIPTOR = json.loads((pathlib.Path(__file__).parent/'geophysics_radiometrics.json').read_text())


class _NeedsInput(ValueError):
    pass


def describe_radiometrics():
    """Return independent concentration, ratio, ternary and resource contracts.

    Returns
    -------
    dict
        Canonical band roles/units, schemas, limits, conventions and assumptions.
    """
    return copy.deepcopy(_DESCRIPTOR)


def _label(value):
    return baselode.geophysics.observations._label(value) and baselode.geophysics.observations._trim(value).lower() not in ('unknown','unspecified')


def _policy(reference_policy, evidence, negative_policy='mask'):
    if reference_policy != 'caller_verified' or not baselode.geophysics.observations._text(evidence) or len(evidence)>4096:
        raise _NeedsInput('declare caller_verified corrected concentrations and bounded supporting evidence')
    if negative_policy != 'mask':
        raise ValueError('negative_policy must be mask; no clipping or pseudocounts')


def _context(raster, stack):
    if not isinstance(raster,baselode.geophysics.raster.GeophysicsRaster):
        raise ValueError('expected GeophysicsRaster')
    if np.iscomplexobj(raster.data):
        raise ValueError('radiometric concentrations must be real values')
    if raster.data.size>1000000:
        raise ValueError('radiometrics accepts at most 1000000 input cell values')
    baselode.geophysics.provenance.encode(raster.metadata,'GeoTIFF','float64')
    transform=raster.transform
    if transform is None or not all(math.isfinite(v) for v in transform) or not math.isfinite(transform[0]*transform[4]-transform[1]*transform[3]) or transform[0]*transform[4]-transform[1]*transform[3]==0:
        raise ValueError('require a finite invertible affine transform')
    corners=[(transform[0]*col+transform[1]*row+transform[2],transform[3]*col+transform[4]*row+transform[5]) for col in (0,raster.width) for row in (0,raster.height)]
    if any(not math.isfinite(v) for corner in corners for v in corner):
        raise ValueError('affine grid coordinates exceed finite range')
    if raster.crs is None and not _label(raster.metadata.get('frame_id')):
        raise _NeedsInput('declare a raster CRS or local metadata.frame_id')
    if raster.crs is not None and (not baselode.geophysics.observations._text(raster.crs) or len(raster.crs)>4096 or baselode.geophysics.observations._trim(raster.crs).lower() in ('unknown','unspecified')):
        raise ValueError('CRS must be a bounded known label')
    if raster.crs is not None:
        raster.crs.encode('utf-8')
    if not _label(raster.metadata.get('crs_units')):
        raise _NeedsInput('declare shared coordinate units; pointwise products allow degrees')
    context=raster.metadata.get('radiometric')
    if raster.metadata.get('field_type')!='radiometric' or type(context) is not dict or context.get('state')!='corrected_concentration':
        raise _NeedsInput('declare field_type radiometric and corrected_concentration context, not raw counts')
    if not baselode.geophysics.observations._number(context.get('reference_height_m')) or not _label(context.get('height_datum')):
        raise _NeedsInput('declare common reference_height_m and height_datum')
    if stack:
        if raster.band_count!=3 or list(raster.band_names)!=['K','eU','eTh'] or raster.metadata.get('units')!=['%','ppm','ppm']:
            raise ValueError('canonical stack must be K(%), eU(ppm), eTh(ppm) in that order')
        ids=context.get('calibration_ids')
        if type(ids) is not list or len(ids)!=3 or not all(_label(v) for v in ids):
            raise _NeedsInput('declare all three calibration_ids in K/eU/eTh order')
    else:
        if raster.band_count!=1 or context.get('element') not in ('K','eU','eTh') or raster.metadata.get('units')!=['%' if context.get('element')=='K' else 'ppm']:
            raise ValueError('single-band source must identify K(%), eU(ppm) or eTh(ppm)')
        if not _label(context.get('calibration_id')):
            raise _NeedsInput('declare each source calibration_id')
    return context


def _metadata(sources, operation, params, units, diagnostics):
    first=sources[0]
    metadata={key:copy.deepcopy(first.metadata[key]) for key in ('crs_units','frame_id') if key in first.metadata}
    metadata.update(field_type='radiometric' if operation=='stack_radiometric_grids' else 'other',units=units,uncertainty_propagated=False,input_lineage=[],processing=[])
    for i,source in enumerate(sources):
        nodes,operand=baselode.geophysics.provenance.append_input(metadata,source.metadata);metadata['input_lineage']=nodes
        metadata['processing'].append({'operation':operation+'_input','version':1,'input_index':i,'operand_lineage':operand})
    metadata['processing'].append({'operation':operation,'version':1,'parameters':copy.deepcopy(params),'diagnostics':copy.deepcopy(diagnostics)})
    if operation!='stack_radiometric_grids':
        metadata['radiometric_product']={'kind':operation,'source_order':['K','eU','eTh'],'version':1}
    baselode.geophysics.provenance.encode(metadata,'GeoTIFF','float64')
    return metadata


def stack_radiometric_grids(potassium, uranium, thorium, reference_policy, evidence):
    """Stack exactly aligned, explicitly corrected single-element grids.

    Parameters
    ----------
    potassium, uranium, thorium : GeophysicsRaster
        One-band K(%), eU(ppm), eTh(ppm) rasters, respectively. Each declares
        metadata.radiometric element/state='corrected_concentration', known
        calibration_id, reference_height_m and height_datum. Shared geometry,
        CRS/coordinate units and reference context required; no resampling.
    reference_policy : str
        Must be 'caller_verified'; the library does not infer calibration.
    evidence : str
        Nonempty bounded source/processing verification evidence.

    Returns
    -------
    GeophysicsRaster
        Canonical K/eU/eTh stack with masked native NoData, source lineage and
        per-band calibration IDs. Source uncertainty is archived, not propagated.
    """
    _policy(reference_policy,evidence)
    sources=[potassium,uranium,thorium];contexts=[_context(s,False) for s in sources]
    if sum(s.data.size for s in sources)>1000000:
        raise ValueError('stack exceeds 1000000 total input cell values')
    for source,context,element in zip(sources,contexts,['K','eU','eTh']):
        if context['element']!=element:
            raise ValueError('source roles must be potassium, uranium, thorium')
        if source.data.shape!=potassium.data.shape or source.transform!=potassium.transform or source.crs!=potassium.crs or source.metadata.get('crs_units')!=potassium.metadata.get('crs_units') or source.metadata.get('frame_id')!=potassium.metadata.get('frame_id'):
            raise ValueError('source grids require exactly matching geometry/CRS/frame/coordinate units; align explicitly first')
        if any(context[k]!=contexts[0][k] for k in ('reference_height_m','height_datum')):
            raise ValueError('source concentration reference height/datum must match')
    data=np.concatenate([np.where(baselode.geophysics.colour_scales.valid_mask(s.data,s.nodata),s.data.astype(float),np.nan) for s in sources])
    params={'reference_policy':reference_policy,'evidence':evidence}
    metadata=_metadata(sources,'stack_radiometric_grids',params,['%','ppm','ppm'],{})
    metadata['radiometric']={k:copy.deepcopy(contexts[0][k]) for k in ('state','reference_height_m','height_datum')};metadata['radiometric']['calibration_ids']=[c['calibration_id'] for c in contexts]
    baselode.geophysics.provenance.encode(metadata,'GeoTIFF','float64')
    return potassium.copy_with(data,metadata=metadata,band_names=['K','eU','eTh'],nodata=None)


def _parameters(operation, supplied):
    schema=_DESCRIPTOR['ratio_parameters' if operation=='radiometric_ratios' else 'ternary_parameters']
    if type(supplied) is not dict or supplied.keys()-schema['properties'].keys():
        raise ValueError('unknown radiometric parameter')
    params=copy.deepcopy(supplied);params.setdefault('negative_policy','mask')
    if any(k not in params for k in schema['required']):
        raise _NeedsInput('supply every explicit floor/stretch/gamma/reference/evidence parameter')
    baselode.geophysics.provenance._json_value(params)
    if len(json.dumps(params,ensure_ascii=False).encode('utf-8'))>262144:
        raise ValueError('radiometric parameters exceed 256 KiB')
    _policy(params['reference_policy'],params['evidence'],params['negative_policy'])
    for key in (['potassium_floor','thorium_floor'] if operation=='radiometric_ratios' else ['k_min','k_max','u_min','u_max','th_min','th_max','gamma']):
        if not baselode.geophysics.observations._number(params[key]):
            raise ValueError('radiometric parameters require finite numeric values')
    if operation=='radiometric_ratios':
        if any(not 0<params[k]<=1000000 for k in ['potassium_floor','thorium_floor']):
            raise ValueError('explicit positive concentration floors <=1000000 required')
    else:
        if not .1<=params['gamma']<=10 or any(not 0<=params[lo]<params[hi]<=1e100 for lo,hi in [('k_min','k_max'),('u_min','u_max'),('th_min','th_max')]):
            raise ValueError('require finite nonnegative low < high stretches and gamma in [0.1,10]')
    return params


def _calculate(raster, operation, params, preflight=False):
    _context(raster,True);params=_parameters(operation,params)
    valid=baselode.geophysics.colour_scales.valid_mask(raster.data,raster.nodata)&(raster.data>=0)
    values=raster.data.astype(float)
    diagnostics={'input_missing_or_negative':[int(np.count_nonzero(~v)) for v in valid]}
    if operation=='radiometric_ratios':
        out=np.full(values.shape,np.nan);counts=[];overflow=[]
        for i,(numerator,denominator,floor) in enumerate([(2,0,params['potassium_floor']),(1,0,params['potassium_floor']),(1,2,params['thorium_floor'])]):
            mask=valid[numerator]&valid[denominator]&(values[denominator]>=floor)
            with np.errstate(over='ignore',invalid='ignore',divide='ignore'):
                np.divide(values[numerator],values[denominator],out=out[i],where=mask)
            finite=np.isfinite(out[i]);overflow.append(int(np.count_nonzero(mask&~finite)));out[i][~finite]=np.nan;counts.append(int(np.count_nonzero(finite)))
        diagnostics.update(valid_counts=counts,unsupported_counts=[raster.height*raster.width-v for v in counts],nonfinite_result_counts=overflow)
        bands,units=_DESCRIPTOR['ratio_outputs']['bands'],_DESCRIPTOR['ratio_outputs']['units']
        supported=any(counts)
    else:
        mask=np.all(valid,axis=0);out=np.full(values.shape,np.nan);clipped=[]
        for i,(source,lo,hi) in enumerate([(0,'k_min','k_max'),(2,'th_min','th_max'),(1,'u_min','u_max')]):
            clipped.append({'below':int(np.count_nonzero(mask&(values[source]<params[lo]))),'above':int(np.count_nonzero(mask&(values[source]>params[hi])))})
            bounded=np.clip(np.where(mask,values[source],params[lo]),params[lo],params[hi])
            scaled=np.clip((bounded-params[lo])/(params[hi]-params[lo]),0,1)
            out[i][mask]=np.power(scaled[mask],1/params['gamma'])
        count=int(np.count_nonzero(mask));diagnostics.update(valid_count=count,unsupported_count=raster.height*raster.width-count,clipped=clipped)
        bands,units=_DESCRIPTOR['ternary_outputs']['bands'],_DESCRIPTOR['ternary_outputs']['units'];supported=count>0
    if not supported:
        raise _NeedsInput('no supported radiometric product cells; review data, masks and explicit thresholds')
    if preflight:
        return diagnostics
    metadata=_metadata([raster],operation,params,units,diagnostics)
    return raster.copy_with(out,band_names=bands,metadata=metadata,nodata=None)


def radiometric_ratios(raster, potassium_floor, thorium_floor, reference_policy, evidence, negative_policy='mask'):
    """Compute eTh/K, eU/K (ppm/%) and eU/eTh (1) with independent masks.

    Parameters
    ----------
    raster : GeophysicsRaster
        Canonical corrected K/eU/eTh stack; see stack_radiometric_grids.
    potassium_floor, thorium_floor : float
        Explicit positive denominator floors in %K and ppm eTh, respectively.
        Denominators equal to the floor are accepted; no pseudocounts.
    reference_policy, evidence : str
        'caller_verified' and bounded supporting concentration evidence.
    negative_policy : str, optional
        Fixed 'mask'. Missing/negative dependencies mask each ratio separately.

    Returns
    -------
    GeophysicsRaster
        Three quantitative ratio bands, field_type='other', per-ratio support
        counts and source uncertainty/calibration lineage. No input mutation.

    Raises
    ------
    ValueError
        Invalid/missing context or parameters, resources, or no supported cells.
    """
    return _calculate(raster,'radiometric_ratios',{'potassium_floor':potassium_floor,'thorium_floor':thorium_floor,'reference_policy':reference_policy,'evidence':evidence,'negative_policy':negative_policy})


def radiometric_ternary(raster, k_min, k_max, u_min, u_max, th_min, th_max, gamma, reference_policy, evidence, negative_policy='mask'):
    """Produce fixed-stretch normalized RGB, K red/eTh green/eU blue.

    Parameters
    ----------
    raster : GeophysicsRaster
        Canonical corrected concentration stack K(%), eU(ppm), eTh(ppm).
    k_min, k_max, u_min, u_max, th_min, th_max : float
        Explicit nonnegative low < high stretches in each element's units.
        No automatic histogram fit. Outside endpoints clip to display 0/1.
    gamma : float
        Explicit exponent convention scaled**(1/gamma), in [0.1,10].
    reference_policy, evidence : str
        'caller_verified' and bounded supporting concentration evidence.
    negative_policy : str, optional
        Fixed 'mask'; any missing/negative component masks all RGB bands.

    Returns
    -------
    GeophysicsRaster
        Three fraction RGB bands, field_type='other', common missing mask,
        support/clipping diagnostics and archived quantitative source lineage.
        This is a display transform, not compositional closure or uncertainty.

    Raises
    ------
    ValueError
        Invalid/missing context or stretches, resources, or no supported cells.
    """
    return _calculate(raster,'radiometric_ternary',{'k_min':k_min,'k_max':k_max,'u_min':u_min,'u_max':u_max,'th_min':th_min,'th_max':th_max,'gamma':gamma,'reference_policy':reference_policy,'evidence':evidence,'negative_policy':negative_policy})
