/* Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later */
import descriptor from './geophysics_gravity_prisms.json';
import {boundedJSON,keys,number,label,object,NeedsInput,ResourceError} from './geophysicsForwardCommon.js';
const clone=v=>JSON.parse(JSON.stringify(v)),limits=descriptor.resources,coords=['x_m','y_m','z_m'];
/** Shared prism schemas and explicit Python-backend/native-validation capabilities. */
export function describeGeophysicsGravityPrisms(){return clone(descriptor);}
function prepare(request){
 const p=boundedJSON(request,limits.max_input_bytes);keys(p,['schema','version','coordinate_frame','sources','points','include_sensitivities'],['metadata']);
 if(p.schema!=='baselode.geophysics.gravity_prisms_request'||p.version!==1)throw Error('unsupported prism request schema/version');
 if(typeof p.include_sensitivities!=='boolean')throw Error('include_sensitivities must be boolean');
 const f=p.coordinate_frame;keys(f,['id','kind','axes','units','height_datum']);label(f.id);label(f.height_datum);
 if(f.kind!=='local_cartesian'||f.axes!=='x_y_up'||f.units!=='m')throw Error('declare local_cartesian, x_y_up and metres; transform upstream');
 for(const [key,maximum]of [['sources',64],['points',1024]]){if(!Array.isArray(p[key])||!p[key].length)throw Error(key+' must be a nonempty array');if(p[key].length>maximum)throw new ResourceError(key+' count exceeds budget');}
 const pairs=p.sources.length*p.points.length;if(pairs>limits.max_pairs||(p.include_sensitivities&&pairs>limits.max_sensitivity_pairs))throw new ResourceError('source-point pair budget exceeded');
 if(Object.hasOwn(p,'metadata')){if(!object(p.metadata))throw Error('metadata must be an object');boundedJSON(p.metadata,limits.max_metadata_bytes);}
 const low=[Infinity,Infinity,Infinity],high=[-Infinity,-Infinity,-Infinity],geometries=[],ids=new Set();let maxAspect=0,maxOffset=0;
 for(const row of p.sources){
  keys(row,['id','kind','bounds_m','density_contrast_kg_m3']);label(row.id);if(ids.has(row.id)||row.kind!=='prism')throw Error('sources require unique IDs and kind=prism');ids.add(row.id);number(row.density_contrast_kg_m3,-100000,100000);
  const b=row.bounds_m;if(!Array.isArray(b)||b.length!==6)throw Error('bounds_m requires six xmin,xmax,ymin,ymax,zmin,zmax scalars');for(const v of b)number(v,-1e12,1e12);
  const d=[0,1,2].map(i=>b[2*i+1]-b[2*i]);for(const v of d)number(v,.001,100000);const aspect=Math.max(...d)/Math.min(...d);
  if(aspect>limits.max_aspect_ratio)throw new NeedsInput('prism aspect exceeds supported conditioning domain; use a different discretisation or point/sphere model');maxAspect=Math.max(maxAspect,aspect);
  const origins=[b[0],b[2],b[4]];geometries.push({d,origins});for(let i=0;i<3;i++){low[i]=Math.min(low[i],b[2*i]);high[i]=Math.max(high[i],b[2*i+1]);}
 }
 ids.clear();for(const point of p.points){keys(point,['id',...coords]);label(point.id);if(ids.has(point.id))throw Error('point IDs must be unique');ids.add(point.id);coords.forEach((k,i)=>{number(point[k],-1e12,1e12);low[i]=Math.min(low[i],point[k]);high[i]=Math.max(high[i],point[k]);});}
 if(low.some((v,i)=>high[i]-v>limits.max_axis_span_m))throw new ResourceError('combined geometry span exceeds 200 km per axis');
 for(const {d,origins}of geometries)for(const point of p.points){const ratio=Math.max(...coords.map((k,i)=>Math.abs((point[k]-origins[i])-d[i]/2)))/Math.min(...d);maxOffset=Math.max(maxOffset,ratio);if(ratio>limits.max_point_offset_to_min_dimension)throw new NeedsInput('point offset exceeds supported prism conditioning domain; use a point/sphere model or different discretisation');}
 return {request:p,diagnostics:{source_count:p.sources.length,point_count:p.points.length,pair_count:pairs,max_aspect_ratio:maxAspect,max_point_offset_to_min_dimension:maxOffset}};
}
/** Core-only portable validation. Numerical execution uses Python baselode[potential-fields]. */
export function validateGeophysicsGravityPrisms(request){
 const result={schema:'baselode.geophysics.gravity_prisms_validation',version:1,state:'ok',issues:[],request:null,diagnostics:{},producer:{library:'baselode',version:typeof __BASELODE_VERSION__==='undefined'?'unversioned':__BASELODE_VERSION__,algorithm_version:1}};
 try{Object.assign(result,prepare(request));}catch(error){const context=error instanceof NeedsInput,resource=error instanceof ResourceError;Object.assign(result,{state:context?'needs_input':'rejected',issues:[{code:context?'context':resource?'resource':'contract',message:error.message}],request:null,diagnostics:{}});}
 return result;
}
