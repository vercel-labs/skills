import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { isAstrBotInstalled } from '../src/agents.ts';

describe('AstrBot agent detection', () => {
  it('does not treat a bare project data/ directory as AstrBot', () => {
    const cwd = '/tmp/project';
    const exists = (path: string) =>
      path === join(cwd, 'data') || path === join(cwd, 'data', '.gitkeep');

    expect(isAstrBotInstalled(cwd, '/tmp/home', exists)).toBe(false);
  });

  it('detects AstrBot from ~/.astrbot', () => {
    const home = '/tmp/home';
    const exists = (path: string) => path === join(home, '.astrbot');

    expect(isAstrBotInstalled('/tmp/project', home, exists)).toBe(true);
  });

  it('detects AstrBot from data/plugins', () => {
    const cwd = '/tmp/astrbot-project';
    const exists = (path: string) => path === join(cwd, 'data', 'plugins');

    expect(isAstrBotInstalled(cwd, '/tmp/home', exists)).toBe(true);
  });
});
