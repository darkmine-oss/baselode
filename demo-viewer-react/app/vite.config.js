import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  publicDir: '../../test',
  server: {
    port: 3000,
    open: true
  },
  optimizeDeps: {
    exclude: ['baselode']
  }
});
