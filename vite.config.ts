import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  root: '.',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    // Frontend dev server proxies API/WS to backend
    proxy: {
      '/api': 'http://localhost:3009',
      '/ws': {
        target: 'ws://localhost:3009',
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist/mobile',
  },
});
