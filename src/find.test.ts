import { afterEach, describe, expect, it, vi } from 'vitest';
import { searchSkillsAPI } from './find.ts';

describe('searchSkillsAPI', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('prioritizes exact skill name matches over higher install counts', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          skills: [
            {
              id: 'example/refactoring/dry-refactoring',
              name: 'dry-refactoring',
              installs: 1000,
              source: 'example/refactoring',
            },
            {
              id: 'kucherenko/jscpd/jscpd',
              name: 'jscpd',
              installs: 10,
              source: 'kucherenko/jscpd',
            },
          ],
        }),
      }))
    );

    const results = await searchSkillsAPI('jscpd');

    expect(results.map((skill) => skill.name)).toEqual(['jscpd', 'dry-refactoring']);
  });
});
