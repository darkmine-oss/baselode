/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testDataDir = path.resolve(__dirname, '../../test/data');

console.log('[serve-test-data] testDataDir:', testDataDir);
console.log('[serve-test-data] exists:', fs.existsSync(testDataDir));

const baselodeDist = path.resolve(__dirname, '../../javascript/packages/baselode/dist');

export default defineConfig({
  server: {
    watch: {
      // Vite ignores node_modules by default; un-ignore the symlinked baselode dist
      // so the dev server hot-reloads when the library is rebuilt.
      ignored: (p) => p.includes('node_modules') && !p.startsWith(baselodeDist)
    }
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
            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            fs.createReadStream(filePath).pipe(res);
          } else {
            next();
          }
        });
      }
    }
  ]
});
