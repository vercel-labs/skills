import { join } from 'path';
import { homedir } from 'os';
import { describe, expect, it } from 'vitest';
import { agents } from '../src/agents.ts';

describe('Jcode agent support', () => {
  it('uses ~/.jcode/skills for global skills', () => {
    expect(agents.jcode.name).toBe('jcode');
    expect(agents.jcode.displayName).toBe('Jcode');
    expect(agents.jcode.skillsDir).toBe('.jcode/skills');
    expect(agents.jcode.globalSkillsDir).toBe(join(homedir(), '.jcode', 'skills'));
  });
});
