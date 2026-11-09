/* Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later */
import {isObservationLabel,trimObservationText,unicodeStrings} from './geophysicsObservations.js';
export const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&(Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null);
export class NeedsInput extends Error{}
export class ResourceError extends Error{}
export class BackendError extends Error{}
const limits={max_json_nodes:100000,max_result_json_nodes:500000,max_json_depth:32,max_result_json_depth:33};
export function boundedJSON(value,limit,result=false){
  const active=new Set();let count=0,textBytes=0;const encoder=new TextEncoder();
  function visit(v,depth){
    if(++count>(result?limits.max_result_json_nodes:limits.max_json_nodes)||depth>(result?limits.max_result_json_depth:limits.max_json_depth))throw new ResourceError('JSON node/depth budget exceeded');
    if(v===null||typeof v==='boolean')return;
    if(typeof v==='number'){if(!Number.isFinite(v)||Math.abs(v)>1e100)throw Error('require finite portable binary64 JSON numbers within +/-1e100');return;}
    if(typeof v==='string'){unicodeStrings(v);textBytes+=encoder.encode(v).length;if(textBytes>limit)throw new ResourceError('JSON string byte budget exceeded');return;}
    if(!Array.isArray(v)&&!object(v))throw Error('require plain scalar JSON objects/arrays');
    if(active.has(v))throw Error('cyclic JSON is invalid');active.add(v);
    if(Array.isArray(v)){
      if(Object.keys(v).length!==v.length)throw Error('JSON arrays must be dense without extra properties');
      for(let i=0;i<v.length;i++)visit(v[i],depth+1);
    }else{
      if(Reflect.ownKeys(v).some(k=>typeof k!=='string'))throw Error('JSON object keys must be strings');
      for(const [k,d] of Object.entries(Object.getOwnPropertyDescriptors(v))){if(!d.enumerable||!Object.hasOwn(d,'value'))throw Error('JSON objects require enumerable data fields');visit(k,depth+1);visit(d.value,depth+1);}
    }
    active.delete(v);
  }
  visit(value,0);const encoded=JSON.stringify(value);if(encoder.encode(encoded).length>limit)throw new ResourceError('JSON byte budget exceeded');return JSON.parse(encoded);
}
export function keys(value,required,optional=[]){
  if(!object(value)||Object.keys(value).some(k=>!required.includes(k)&&!optional.includes(k)))throw Error('unknown fields or invalid object');
  if(required.some(k=>!Object.hasOwn(value,k)||value[k]===null))throw new NeedsInput('supply every required request/frame/source/point field');
}
export function number(v,low,high){if(typeof v!=='number'||!Number.isFinite(v)||v<low||v>high)throw Error('numeric value violates explicit finite range');}
export function label(v){if(!isObservationLabel(v)||['unknown','unspecified'].includes(trimObservationText(v).toLowerCase()))throw Error('IDs and height datum must be known nonblank labels of <=128 characters');}
export function add(total,correction,i,value){const next=total[i]+value;correction[i]+=Math.abs(total[i])>=Math.abs(value)?(total[i]-next)+value:(value-next)+total[i];total[i]=next;}
