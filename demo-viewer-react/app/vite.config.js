/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testDataDir = path.resolve(__dirname, '../../test/data');

console.log('[serve-test-data] testDataDir:', testDataDir);
console.log('[serve-test-data] exists:', fs.existsSync(testDataDir));

const baselodeSrc = path.resolve(__dirname, '../../javascript/packages/baselode/src');
const baselodePkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../javascript/packages/baselode/package.json'), 'utf-8'));

function resolveAppVersion() {
  try {
    const tag = execFileSync('git', ['describe', '--tags', '--abbrev=0'], { encoding: 'utf8' }).trim();
    return tag.startsWith('v') ? tag.slice(1) : tag;
  } catch {
    return baselodePkg.version;
  }
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(resolveAppVersion()),
  },
  resolve: {
    // Alias baselode to its source so the demo app works without a prior
    // library build (dist/ is gitignored).  The CSS sub-path needs its own
    // entry so import 'baselode/style.css' resolves to the source CSS file.
    alias: [
      {
        find: /^baselode\/style\.css$/,
        replacement: path.join(baselodeSrc, 'style.css'),
      },
      {
        find: 'baselode',
        replacement: path.join(baselodeSrc, 'index.js'),
      },
    ],
    // Ensure only one instance of shared peer deps regardless of where they
    // are hoisted in the nested node_modules tree.
    dedupe: ['react', 'react-dom', 'three', 'three-viewport-gizmo', 'papaparse', 'plotly.js-dist-min'],
  },
  server: {
    watch: {
      // Vite ignores node_modules by default; un-ignore the baselode source
      // so the dev server hot-reloads when library source files change.
      ignored: (p) => p.includes('node_modules') && !p.startsWith(baselodeSrc),
    },
  },
  plugins: [
    react(),
    {
      name: 'serve-test-data',
      configureServer(server) {
        server.middlewares.use('/data', (req, res, next) => {
          const filePath = path.join(testDataDir, req.url);
          const exists = fs.existsSync(filePath);
          const isFile = exists && fs.statSync(filePath).isFile();
          console.log(`[serve-test-data] ${req.url} -> ${filePath} (exists=${exists}, isFile=${isFile})`);
          if (isFile) {
            const ext = path.extname(filePath).toLowerCase();
            const contentType = ext === '.json'
              ? 'application/json; charset=utf-8'
              : 'text/csv; charset=utf-8';
            res.setHeader('Content-Type', contentType);
            fs.createReadStream(filePath).pipe(res);
          } else {
            next();
          }
        });
      }
    }
  ]
});
