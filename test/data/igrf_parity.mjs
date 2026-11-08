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
  const inspect = await api.inspectGeophysicsCorrections(item);
  const invalid = [];
  for (const change of ['model', 'parameters', 'drop']) {
    const bad = JSON.parse(JSON.stringify(item));
    if (change === 'model') bad.metadata.correction_ledger.entries.at(-1).model.coefficients_sha256 = '0'.repeat(64);
    if (change === 'parameters') delete bad.metadata.correction_ledger.entries.at(-1).parameters.model;
    if (change === 'drop') delete bad.metadata.correction_ledger;
    invalid.push(await api.inspectGeophysicsCorrections(bad));
  }
  const declared = await api.declareGeophysicsCorrections(item, [{ id: 'js-history', correction: 'magnetic_heading', channels: ['mag'], state: 'unapplied', evidence: 'heading not yet applied' }]);
  fs.writeFileSync(process.argv[3], JSON.stringify({ inspect, declared, invalid }));
} finally { await server.close(); }
