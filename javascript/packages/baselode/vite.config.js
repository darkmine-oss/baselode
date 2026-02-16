import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  build: {
    emptyOutDir: true,
    lib: {
      entry: resolve(__dirname, 'src/index.js'),
      formats: ['es'],
      fileName: 'baselode'
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
        'plotly.js-dist-min'
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
