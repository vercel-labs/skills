import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

const rootDir = join(import.meta.dirname, '..');

describe('dist build', () => {
  it('builds and runs without errors', { timeout: 30000 }, () => {
    // Build the project
    execSync('pnpm build', { cwd: rootDir, stdio: 'pipe' });

    // Run the CLI - should exit cleanly with help output
    const result = execSync('node bin/cli.mjs --help', {
      cwd: rootDir,
      stdio: 'pipe',
      encoding: 'utf-8',
    });

    expect(result).toContain('skills');

    // The library entry imports without output or exiting, and exports exactly the public API
    const api = execSync(
      `node --input-type=module -e "const m = await import('./dist/index.mjs'); await new Promise((r) => setTimeout(r, 50)); console.log(JSON.stringify(Object.keys(m).sort()))"`,
      { cwd: rootDir, stdio: 'pipe', encoding: 'utf-8' }
    );
    expect(JSON.parse(api)).toEqual([
      'detectAgents',
      'diagnostics',
      'getSupportedAgents',
      'installSkills',
      'isDiagnostic',
      'listSkills',
      'removeSkills',
      'resolveSource',
      'version',
    ]);
  });
});
