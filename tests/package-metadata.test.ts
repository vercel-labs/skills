import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const packageJsonPath = join(import.meta.dirname, '..', 'package.json');

describe('package metadata', () => {
  it('declares the supported Node.js floor explicitly', () => {
    const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
    // Intentionally mirror package.json so this test fails if the declared floor drifts.
    expect(pkg.engines?.node).toBe('>=22.18.0');
  });
});
