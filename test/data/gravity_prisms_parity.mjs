/* Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later */
import {readFileSync,writeFileSync} from 'node:fs';
import {createServer} from '../../javascript/packages/baselode/node_modules/vite/dist/node/index.js';
const server=await createServer({server:{middlewareMode:true}});
try{
 const api=await server.ssrLoadModule('/src/data/geophysicsGravityPrisms.js'),input=JSON.parse(readFileSync(process.argv[2],'utf8'));
 const result=api.validateGeophysicsGravityPrisms(input.request),negative=input.negative.map(v=>{const r=api.validateGeophysicsGravityPrisms(v);return {state:r.state,code:r.issues[0]?.code,request:r.request};});
 writeFileSync(process.argv[3],JSON.stringify({result,negative,descriptor:api.describeGeophysicsGravityPrisms()}));
}finally{await server.close();}
