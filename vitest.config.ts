import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 30000,
    hookTimeout: 30000,
    teardownTimeout: 30000,
    // Use forks pool for better Windows compatibility
    pool: 'forks',
    singleFork: true,
  },
});
