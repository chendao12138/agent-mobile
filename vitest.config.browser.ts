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
    name: 'browser',
    include: ['src/mobile/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    setupFiles: ['./src/mobile/test-setup.ts'],
    globals: true,
  },
});
