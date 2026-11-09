/* Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later */
import descriptor from './geophysics_block_forward.json';
import {boundedJSON,number,label,object,NeedsInput,ResourceError} from './geophysicsForwardCommon.js';
import {validateGeophysicsGravityPrisms} from './geophysicsGravityPrisms.js';
import {validateGeophysicsMagneticPrisms} from './geophysicsMagneticPrisms.js';
function keys(value,required,optional=[]){if(!object(value)||Object.keys(value).some(k=>!required.includes(k)&&!optional.includes(k)))throw Error('unknown fields or invalid object');const nullable=['active_column','background_nT','min_distance_m','parent_size'];if(required.some(k=>!Object.hasOwn(value,k)||(value[k]===null&&!nullable.includes(k))))throw new NeedsInput('supply every required block forward field');}
const J=['magnetization_x_A_m','magnetization_y_A_m','magnetization_z_up_A_m'];
export function describeGeophysicsBlockForward(){return JSON.parse(JSON.stringify(descriptor));}
function prepare(request){
 const p=boundedJSON(request,2097152);keys(p,['schema','version','coordinate_frame','model','physics','cell_id_column','active_column','properties','points','batch_size','include_sensitivities','background_nT','min_distance_m'],['metadata']);
 if(p.schema!=='baselode.geophysics.block_forward_request'||p.version!==1||!['gravity','magnetic'].includes(p.physics))throw Error('unsupported block forward schema/version/physics');
 number(p.batch_size,1,64);if(!Number.isInteger(p.batch_size))throw Error('batch_size must be integer');label(p.cell_id_column);if(p.active_column!==null)label(p.active_column);
 if(Object.hasOwn(p,'metadata')){if(!object(p.metadata))throw Error('metadata must be object');boundedJSON(p.metadata,131072);}
 keys(p.model,['definition','blocks']);const d=p.model.definition;keys(d,['name','description','crs','origin','block_size','n_blocks','parent_size','rotation','extra']);
 if(typeof d.name!=='string'||typeof d.description!=='string'||!object(d.extra))throw Error('invalid definition metadata');label(d.crs);
 if(!object(p.coordinate_frame)||p.coordinate_frame.id!==d.crs)throw new NeedsInput('coordinate_frame.id must equal definition.crs');
 const values=[];for(const [key,axes,lo,hi,integer]of [['origin',['x','y','z'],-1e12,1e12,false],['block_size',['dx','dy','dz'],.001,100000,false],['n_blocks',['nx','ny','nz'],1,1000000,true],['rotation',['azimuth','dip','plunge'],-360,360,false]]){keys(d[key],axes);const v=axes.map(axis=>d[key][axis]);for(const item of v){number(item,lo,hi);if(integer&&!Number.isInteger(item))throw Error('grid counts must be integer');}values.push(v);}
 const [origin,size,counts,rotation]=values;if(rotation.some(v=>v!==0))throw new NeedsInput('rotated block models are unsupported in block forward v1; do not substitute bounding boxes');
 if(d.parent_size!==null){keys(d.parent_size,['nx','ny','nz']);for(const v of Object.values(d.parent_size)){number(v,1,1000000);if(!Number.isInteger(v))throw Error('parent counts must be integer');}}
 const parameters=p.physics==='gravity'?['density_contrast_kg_m3']:J;keys(p.properties,parameters);for(const spec of Object.values(p.properties)){keys(spec,['column','units']);label(spec.column);if(spec.units!==(p.physics==='gravity'?'kg/m^3':'A/m'))throw Error('explicit density contrast kg/m^3 or world Cartesian magnetisation A/m required');}
 const rows=p.model.blocks;if(!Array.isArray(rows)||!rows.length)throw Error('blocks must be nonempty array');if(rows.length>512)throw new ResourceError('block count exceeds512');
 const sources=[],inactive=[],ids=new Set(),geometries=[];
 for(const row of rows){
  if(!object(row))throw Error('block row must be object');const identity=row[p.cell_id_column];label(identity);if(ids.has(identity))throw Error('cell IDs must be unique');ids.add(identity);
  const idx=[],extent=[];for(let i=0;i<3;i++){const a=row[['i','j','k'][i]],n=row[['ni','nj','nk'][i]];number(a,0,1000000);number(n,1,1000000);if(!Number.isInteger(a)||!Number.isInteger(n)||a+n>counts[i])throw Error('integer block geometry must lie within grid');idx.push(a);extent.push(n);}
  const bounds=origin.flatMap((v,i)=>[v+idx[i]*size[i],v+(idx[i]+extent[i])*size[i]]),geometric=['x','y','z','dx','dy','dz'];
  if(geometric.some(k=>Object.hasOwn(row,k))){if(!geometric.every(k=>Object.hasOwn(row,k)))throw Error('supply all centroid/size columns or none');const expected=[...origin.map((v,i)=>v+(idx[i]+extent[i]/2)*size[i]),...extent.map((v,i)=>v*size[i])];geometric.forEach((k,i)=>{number(row[k],-1e12,1e12);if(Math.abs(row[k]-expected[i])>1e-6)throw Error('centroid/size disagrees with authoritative grid indices');});}
  const active=p.active_column===null?true:row[p.active_column];if(typeof active!=='boolean')throw Error('active column requires explicit boolean for every cell');if(!active){inactive.push(identity);continue;}
  if(Object.hasOwn(row,'fill_fraction')&&(typeof row.fill_fraction!=='number'||row.fill_fraction!==1))throw new NeedsInput('partial fill_fraction requires an explicit resolved geometry/model');
  for(const previous of geometries)if([0,1,2].every(i=>Math.max(bounds[2*i],previous[2*i])<Math.min(bounds[2*i+1],previous[2*i+1])))throw Error('active cells overlap');geometries.push(bounds);
  const source={id:identity,kind:'prism',bounds_m:bounds};for(const parameter of parameters){const value=row[p.properties[parameter].column];number(value,p.physics==='gravity'?-100000:-1000,p.physics==='gravity'?100000:1000);source[parameter]=value;}sources.push(source);
 }
 if(!sources.length)throw new NeedsInput('at least one active cell required');if(!Array.isArray(p.points)||!p.points.length)throw Error('points must be nonempty array');
 const pairs=sources.length*p.points.length,maximum=p.physics==='gravity'?4096:2048;if(pairs>32768||(p.include_sensitivities&&pairs>maximum))throw new ResourceError('global active cell-point budget exceeded');
 if(p.physics==='gravity'&&(p.background_nT!==null||p.min_distance_m!==null))throw Error('gravity requires explicit null magnetic settings');
 const batches=[];for(let offset=0;offset<sources.length;offset+=p.batch_size){const child={schema:'baselode.geophysics.'+p.physics+'_prisms_request',version:1,coordinate_frame:p.coordinate_frame,sources:sources.slice(offset,offset+p.batch_size),points:p.points,include_sensitivities:p.include_sensitivities};if(p.physics==='magnetic')Object.assign(child,{background_nT:p.background_nT,min_distance_m:p.min_distance_m});const validation=(p.physics==='gravity'?validateGeophysicsGravityPrisms:validateGeophysicsMagneticPrisms)(child);if(validation.state!=='ok'){const {message,code}=validation.issues[0];if(code==='context')throw new NeedsInput(message);if(code==='resource')throw new ResourceError(message);throw Error(message);}batches.push(JSON.parse(JSON.stringify(child)));}
 ['x_m','y_m','z_m'].forEach((k,i)=>{const values=[...sources.flatMap(s=>[s.bounds_m[2*i],s.bounds_m[2*i+1]]),...p.points.map(point=>point[k])];if(Math.max(...values)-Math.min(...values)>200000)throw new ResourceError('global span exceeds200km');});
 return {request:p,batches,cell_ids:sources.map(s=>s.id),inactive_ids:inactive,diagnostics:{cell_count:rows.length,active_count:sources.length,point_count:p.points.length,pair_count:pairs,batch_count:batches.length}};
}
/** Native core preparation; numerical execution uses Python baselode[potential-fields]. */
export function prepareGeophysicsBlockForward(request){
 const report={schema:'baselode.geophysics.block_forward_preparation',version:1,state:'ok',issues:[],request:null,batches:[],cell_ids:[],inactive_ids:[],diagnostics:{},producer:{library:'baselode',version:typeof __BASELODE_VERSION__==='undefined'?'unversioned':__BASELODE_VERSION__,algorithm_version:1}};
 try{Object.assign(report,prepare(request));boundedJSON(report,8388608,true);}catch(error){const context=error instanceof NeedsInput,resource=error instanceof ResourceError;Object.assign(report,{state:context?'needs_input':'rejected',issues:[{code:context?'context':resource?'resource':'contract',message:error.message}],request:null,batches:[],cell_ids:[],inactive_ids:[],diagnostics:{}});}return report;
}
