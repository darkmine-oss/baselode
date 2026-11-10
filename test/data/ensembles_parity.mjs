/* Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later */
import {readFileSync,writeFileSync} from 'node:fs';
import {createServer} from '../../javascript/packages/baselode/node_modules/vite/dist/node/index.js';
const processing=process.argv[4]==='processing',server=await createServer({server:{middlewareMode:true,hmr:false}});
try{const api=await server.ssrLoadModule('/src/data/geophysics'+(processing?'Processing':'Model')+'Ensembles.js'),p=JSON.parse(readFileSync(process.argv[2],'utf8')),suffix=processing?'ProcessingEnsemble':'PotentialFieldEnsemble';writeFileSync(process.argv[3],JSON.stringify({descriptor:api['describeGeophysics'+suffix](),reports:p.map(api['validateGeophysics'+suffix])}));}finally{await server.close();}
