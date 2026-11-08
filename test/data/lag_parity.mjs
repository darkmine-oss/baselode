/* Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const require = createRequire(path.join(process.cwd(), 'package.json'));
const metadataPath = require.resolve('vite/package.json');
const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
const { createServer } = await import(pathToFileURL(path.resolve(path.dirname(metadataPath), metadata.exports['.'].import.default)));
const server = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true } });
try {
  const api = await server.ssrLoadModule('/src/data/geophysicsCorrections.js');
  const item = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const inspected = await api.inspectGeophysicsCorrections(item.python_output);
  const second = await api.correctGeophysicsMagneticLag(item.python_output, { ...item.options, channel: 'other', lag_seconds: -.5, event_id: 'js-other' });
  const first = await api.correctGeophysicsMagneticLag(item.survey, item.options);
  fs.writeFileSync(process.argv[3], JSON.stringify({ inspected, first, second }));
} finally { await server.close(); }
