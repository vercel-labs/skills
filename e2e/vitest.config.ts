import { defineConfig } from 'vitest/config';

// Production e2e suite: packs the CLI, installs the tarball into an isolated prefix,
// and drives it against live sources (GitHub, skills.sh, vercel.com, npm).
// Kept out of `pnpm test` by the `.e2e.ts` suffix; run with `pnpm test:e2e`.
export default defineConfig({
  test: {
    root: import.meta.dirname,
    include: ['**/*.e2e.ts'],
    globalSetup: ['./setup.ts'],
    testTimeout: 180_000,
    hookTimeout: 300_000,
    // Live network: one retry in CI absorbs transient GitHub/registry hiccups.
    retry: process.env.CI ? 1 : 0,
    // Bound parallel clones so anonymous runs stay under GitHub rate limits.
    maxWorkers: 4,
  },
});
