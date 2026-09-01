import { join } from 'path';
import { homedir } from 'os';
import { describe, expect, it } from 'vitest';
import { agents } from '../src/agents.ts';

describe('Plexon agent support', () => {
  it('uses ~/.plexon/skills for global skills', () => {
    expect(agents.plexon.name).toBe('plexon');
    expect(agents.plexon.displayName).toBe('Plexon');
    expect(agents.plexon.skillsDir).toBe('.plexon/skills');
    expect(agents.plexon.globalSkillsDir).toBe(join(homedir(), '.plexon', 'skills'));
  });

  it('detects Plexon from its home directory', async () => {
    expect(typeof agents.plexon.detectInstalled).toBe('function');
    expect(typeof (await agents.plexon.detectInstalled())).toBe('boolean');
  });
});
