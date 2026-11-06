import { posix } from 'path';
import { describe, expect, it } from 'vitest';
import { fallbackMatchesGlob } from '../src/glob.ts';

const cases: [path: string, pattern: string][] = [
  ['pkg', 'pkg'],
  ['pkg', 'pk'],
  ['pkg-a', 'pkg-*'],
  ['pkg.a', 'pkg?a'],
  ['pkg+a', 'pkg+a'],
  ['@acme/docs', '@acme/*'],
  ['@acme/docs', '@acme/**'],
  ['@acme/docs', '@other/*'],
  ['@acme/docs', '*'],
  ['@acme/docs', '**'],
  ['packages/a/b', 'packages/*'],
  ['packages/a/b', 'packages/**'],
  ['packages/a', 'packages/**/a'],
  ['packages/x/y/a', 'packages/**/a'],
  ['docs-b', '*-b'],
  ['docs-a', '*-b'],
  ['docs-a', 'docs-[ab]'],
  ['docs-c', 'docs-[ab]'],
  ['docs-c', 'docs-[!ab]'],
  ['docs-a', 'docs-[!ab]'],
  ['docs-a', 'docs-{a,b}'],
  ['docs-c', 'docs-{a,b}'],
  ['packages/internal', 'packages/{internal,private}'],
];

describe('fallbackMatchesGlob', () => {
  it.each(cases)('%s vs %s agrees with path.matchesGlob', (path, pattern) => {
    expect(fallbackMatchesGlob(path, pattern)).toBe(posix.matchesGlob(path, pattern));
  });
});
