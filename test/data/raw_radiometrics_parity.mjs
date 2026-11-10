/* Copyright (C) 2026 Darkmine Pty Ltd; SPDX-License-Identifier: GPL-3.0-or-later */
import {createServer} from '../../javascript/packages/baselode/node_modules/vite/dist/node/index.js';import {readFileSync,writeFileSync} from 'node:fs';
const server=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom'});
try{const api=await server.ssrLoadModule('/src/data/geophysicsRawRadiometrics.js'),requests=JSON.parse(readFileSync(process.argv[2],'utf8'));writeFileSync(process.argv[3],JSON.stringify({descriptor:api.describeGeophysicsRawRadiometrics(),reports:requests.map(p=>api.processGeophysicsRawRadiometrics(p)),validations:requests.map(p=>api.validateGeophysicsRawRadiometrics(p))}));}finally{await server.close();}
