/* Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later */
import {readFileSync,writeFileSync} from 'node:fs';
import {createServer} from '../../javascript/packages/baselode/node_modules/vite/dist/node/index.js';
const server=await createServer({server:{middlewareMode:true}});
try{const api=await server.ssrLoadModule('/src/data/geophysicsMisfit.js'),input=JSON.parse(readFileSync(process.argv[2],'utf8'));writeFileSync(process.argv[3],JSON.stringify({result:api.calculateGeophysicsMisfit(input.request),descriptor:api.describeGeophysicsMisfit(),negative:input.negative.map(x=>{const r=api.calculateGeophysicsMisfit(x);return {state:r.state,code:r.issues[0]?.code,rows:r.rows};})}));}finally{await server.close();}
