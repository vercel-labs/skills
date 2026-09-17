import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { discoverSkills } from '../src/skills.ts';

const rootDir = join(import.meta.dirname, '..');

describe('bundled find-skills skill', () => {
  it('is present and discoverable as a valid skill', async () => {
    const skills = await discoverSkills(rootDir);
    const skill = skills.find(({ name }) => name === 'find-skills');

    expect(skill).toMatchObject({
      name: 'find-skills',
      path: join(rootDir, 'skills', 'find-skills'),
    });
    expect(skill?.description).toContain('discover and install agent skills');
    expect(skill?.rawContent).toContain('npx skills find [query]');
  });
});
