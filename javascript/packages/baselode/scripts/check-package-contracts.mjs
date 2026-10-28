/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const publishedEntries = {
  './extent': ['dist/extent.js', 'types/extent.d.ts'],
  './tool-ui': ['dist/tool-ui.js', 'types/tool-ui.d.ts'],
  './tool-ui/contracts': ['dist/tool-ui-contracts.js', 'types/tool-ui-contracts.d.ts'],
  './assistant-ui': ['dist/assistant-ui.js', 'types/assistant-ui.d.ts'],
};

for (const [entry, [runtime, types]] of Object.entries(publishedEntries)) {
  assert.equal(packageJson.exports[entry].import, `./${runtime}`);
  assert.equal(packageJson.exports[entry].types, `./${types}`);
  readFileSync(resolve(root, runtime));
  readFileSync(resolve(root, types));
}

for (const clientEntry of ['dist/tool-ui.js', 'dist/assistant-ui.js']) {
  assert.match(readFileSync(resolve(root, clientEntry), 'utf8').slice(0, 80), /"use client";/);
}

const contracts = await import(pathToFileURL(resolve(root, 'dist/tool-ui-contracts.js')));
assert.equal(Object.keys(contracts.BASELODE_TOOL_UI_SCHEMA_CONTRACTS).length, 8);

const extentModule = await import(pathToFileURL(resolve(root, 'dist/extent.js')));
const extent = extentModule.Extent.fromBbox([118, -32, 120, -30]);
assert.deepEqual(extent.center(), [119, -31]);
assert.equal(extentModule.DEFAULT_EXTENT_CRS, 'EPSG:4326');

const npmCache = mkdtempSync(join(tmpdir(), 'baselode-pack-'));
let pack;
try {
  pack = JSON.parse(execFileSync(
    'npm',
    ['pack', '--ignore-scripts', '--dry-run', '--json'],
    {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, npm_config_cache: npmCache },
    },
  ));
} finally {
  rmSync(npmCache, { recursive: true, force: true });
}
const files = new Set(pack[0].files.map(({ path }) => path));
for (const [runtime, types] of Object.values(publishedEntries)) {
  assert(files.has(runtime), `${runtime} is missing from npm pack output`);
  assert(files.has(types), `${types} is missing from npm pack output`);
}
assert(files.has('dist/style.css'));
assert(files.has('src/tool-ui/style.css'));
assert(files.has('README.md'));

console.log('Published Extent and Tool UI contracts are present, importable, and typed.');
