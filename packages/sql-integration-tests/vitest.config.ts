import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    cache: false,
    fileParallelism: false,
    hookTimeout: 60_000,
    include: ['src/**/*.test.ts'],
    maxWorkers: 1,
    testTimeout: 60_000,
  },
});
