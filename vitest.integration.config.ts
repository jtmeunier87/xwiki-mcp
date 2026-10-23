import { defineConfig } from 'vitest/config';

// Live-wiki tests only; see src/integration/live.itest.ts.
export default defineConfig({
  test: {
    include: ['src/integration/**/*.itest.ts'],
    testTimeout: 120_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
