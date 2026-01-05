import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

// Standalone build with all dependencies bundled
// Used for Dash app and other non-npm environments
export default defineConfig({
  plugins: [react()],
  define: {
    // Define Node.js globals for browser compatibility
    'process.env.NODE_ENV': JSON.stringify('production'),
    'process.env': '{}',
    global: 'globalThis'
  },
  build: {
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, 'src/index.js'),
      formats: ['es'],
      fileName: 'baselode-standalone'
    },
    rollupOptions: {
      // Don't externalize anything - bundle all dependencies
      external: [],
      output: {
        preserveModules: false,
        inlineDynamicImports: true,
        format: 'es'
      }
    },
    cssCodeSplit: false,
    sourcemap: true,
    outDir: 'dist',
    minify: false  // Disable minification for easier debugging
  }
});
