import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: [
      'workers/**/__tests__/**/*.test.ts',
      'tests/unit/**/*.test.{ts,tsx}',
    ],
    setupFiles: ['tests/unit/setup.ts'],
  },
});
