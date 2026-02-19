import { join } from 'path';
import { describe, it, expect } from 'vitest';
import { getOpenClawGlobalSkillsDir } from '../src/agents.ts';

describe('openclaw global path resolution', () => {
  const home = '/tmp/home';

  it('prefers ~/.openclaw when present', () => {
    const exists = (path: string) =>
      path === join(home, '.openclaw') ||
      path === join(home, '.clawdbot') ||
      path === join(home, '.moltbot');
    expect(getOpenClawGlobalSkillsDir(home, exists)).toBe(join(home, '.openclaw/skills'));
  });

  it('falls back to ~/.clawdbot when ~/.openclaw is missing', () => {
    const exists = (path: string) =>
      path === join(home, '.clawdbot') || path === join(home, '.moltbot');
    expect(getOpenClawGlobalSkillsDir(home, exists)).toBe(join(home, '.clawdbot/skills'));
  });

  it('falls back to ~/.moltbot when only legacy path exists', () => {
    const exists = (path: string) => path === join(home, '.moltbot');
    expect(getOpenClawGlobalSkillsDir(home, exists)).toBe(join(home, '.moltbot/skills'));
  });

  it('defaults to ~/.openclaw when no known path exists', () => {
    expect(getOpenClawGlobalSkillsDir(home, () => false)).toBe(join(home, '.openclaw/skills'));
  });
});
