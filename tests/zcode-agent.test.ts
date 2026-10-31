import { join } from 'path';
import { homedir } from 'os';
import { describe, expect, it } from 'vitest';
import { agents, isZCodeInstalled } from '../src/agents.ts';

describe('ZCode agent support', () => {
  it('uses ~/.zcode/skills for global skills', () => {
    expect(agents.zcode.name).toBe('zcode');
    expect(agents.zcode.displayName).toBe('ZCode');
    expect(agents.zcode.skillsDir).toBe('.zcode/skills');
    expect(agents.zcode.globalSkillsDir).toBe(join(homedir(), '.zcode', 'skills'));
  });

  it('detects ZCode from its home directory', () => {
    const home = '/tmp/home';
    const exists = (path: string) => path === join(home, '.zcode');

    expect(isZCodeInstalled(home, exists)).toBe(true);
  });

  it('detects ZCode from the macOS app bundle', () => {
    const home = '/tmp/home';
    const exists = (path: string) => path === '/Applications/ZCode.app';

    expect(isZCodeInstalled(home, exists)).toBe(true);
  });

  it('returns false when no known ZCode path exists', () => {
    expect(isZCodeInstalled('/tmp/home', () => false)).toBe(false);
  });
});
