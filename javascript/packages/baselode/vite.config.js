import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  build: {
    emptyOutDir: true,
    lib: {
      entry: {
        baselode: resolve(__dirname, 'src/index.js'),
        extent: resolve(__dirname, 'src/extent/Extent.js'),
        'tool-ui': resolve(__dirname, 'src/tool-ui/index.js'),
        'tool-ui-contracts': resolve(__dirname, 'src/tool-ui/contracts-entry.js'),
        'assistant-ui': resolve(__dirname, 'src/assistant-ui/index.jsx'),
      },
      formats: ['es'],
      fileName: (_format, entryName) => `${entryName}.js`
    },
    rollupOptions: {
      external: [
        'react',
        'react-dom',
        'react/jsx-runtime',
        '@assistant-ui/react',
        'proj4',
        'geotiff',
        'three',
        /^three\//,
        'three-viewport-gizmo',
        'papaparse',
        'plotly.js-dist-min',
        'zod'
      ],
      output: {
        preserveModules: false,
        assetFileNames: 'style[extname]',
        banner: (chunk) => (
          ['tool-ui', 'assistant-ui'].includes(chunk.name) ? '"use client";' : ''
        )
      }
    },
    cssCodeSplit: false,
    sourcemap: true,
    outDir: 'dist'
  }
});
