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
        'tool-ui': resolve(__dirname, 'src/tool-ui/index.js'),
      },
      formats: ['es'],
      fileName: (_format, entryName) => `${entryName}.js`
    },
    rollupOptions: {
      external: [
        'react',
        'react-dom',
        'react/jsx-runtime',
        'three',
        /^three\//,
        'three-viewport-gizmo',
        'papaparse',
        'plotly.js-dist-min',
        'zod'
      ],
      output: {
        preserveModules: false,
        assetFileNames: 'style[extname]'
      }
    },
    cssCodeSplit: false,
    sourcemap: true,
    outDir: 'dist'
  }
});
