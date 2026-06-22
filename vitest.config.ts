import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    // Server-side tests: Node environment by default
    include: ['src/**/*.test.ts'],
    exclude: ['src/mobile/**'],
    globals: true,
  },
});
