import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { diagnostics } from '../src/diagnostics.ts';

const troubleshooting = readFileSync(
  join(import.meta.dirname, '../docs/troubleshooting.md'),
  'utf-8'
);
const documentedCodes = [...troubleshooting.matchAll(/^#### (SKILLS_\w+)$/gm)].map((m) => m[1]);

describe('diagnostic docs', () => {
  it('documents exactly the codes in the catalog', () => {
    expect(documentedCodes.sort()).toEqual(Object.keys(diagnostics).sort());
  });
});
