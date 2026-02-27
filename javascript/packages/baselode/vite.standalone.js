/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { defineConfig } from 'vite';
import { resolve } from 'path';

// Standalone build: bundles three.js + three-viewport-gizmo.
// Excludes React, Plotly, and PapaParse (not needed for the 3D scene class).
// Output goes to dist/baselode-module.js; the build:module script copies it to
// demo-viewer-dash/assets/.
export default defineConfig({
  build: {
    emptyOutDir: false, // share dist/ with the main library build
    lib: {
      entry: resolve(__dirname, 'src/standalone.js'),
      formats: ['es'],
      fileName: () => 'baselode-module',
    },
    rollupOptions: {
      external: [
        'react',
        'react-dom',
        'react/jsx-runtime',
        'papaparse',
        'plotly.js-dist-min',
      ],
      output: {
        entryFileNames: 'baselode-module.js',
      },
    },
    sourcemap: false,
    outDir: 'dist',
  },
});
