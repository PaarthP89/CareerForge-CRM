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
    coverage: {
      // Scoped to files this session actually wrote tests for, not the whole
      // repo — most of workers/shared/lib's classifiers and several UI
      // components have no tests yet (see CLAUDE.md §4), so a repo-wide
      // threshold would either fail immediately or have to be set low enough
      // to be meaningless. Ratchet this list up as more files get covered.
      include: [
        'app/api/**/route.ts',
        'components/dashboard/jobs-table.tsx',
        'components/resume/match-results.tsx',
        'components/resume/job-compare-panel.tsx',
        'workers/scraper/lib/markdown.ts',
        'workers/shared/lib/json-ld.ts',
        'workers/shared/lib/text-classifier.ts',
      ],
      thresholds: {
        statements: 75,
        branches: 55,
        functions: 75,
        lines: 75,
      },
    },
  },
});
