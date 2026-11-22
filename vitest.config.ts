import { defineConfig } from 'vitest/config';

// Windows CI runners are much slower at process spawns and filesystem work (git clones,
// symlinks, temp dirs), so tests that finish in ~1s on Linux regularly brush the default
// 5s limit there. Give them more headroom instead of flaking.
const isWindows = process.platform === 'win32';

export default defineConfig({
  test: {
    testTimeout: isWindows ? 30_000 : 5_000,
    hookTimeout: isWindows ? 60_000 : 10_000,
  },
});
