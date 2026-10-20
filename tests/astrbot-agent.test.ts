import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { isAstrBotInstalled, isAstrBotProjectInstalled } from '../src/agents.ts';

describe('AstrBot agent detection', () => {
  it('does not treat a bare project data/ directory as AstrBot', () => {
    const cwd = '/tmp/project';
    const exists = (path: string) =>
      path === join(cwd, 'data') || path === join(cwd, 'data', '.gitkeep');

    expect(isAstrBotInstalled(cwd, '/tmp/home', exists)).toBe(false);
  });

  it('does not treat data/skills alone as AstrBot', () => {
    const cwd = '/tmp/project';
    const exists = (path: string) => path === join(cwd, 'data', 'skills');

    expect(isAstrBotInstalled(cwd, '/tmp/home', exists)).toBe(false);
  });

  it('detects AstrBot from ASTRBOT_ROOT', () => {
    const prev = process.env.ASTRBOT_ROOT;
    process.env.ASTRBOT_ROOT = '/opt/astrbot';
    try {
      expect(isAstrBotInstalled('/tmp/project', '/tmp/home', () => false)).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.ASTRBOT_ROOT;
      else process.env.ASTRBOT_ROOT = prev;
    }
  });

  it('detects AstrBot from ~/.astrbot', () => {
    const home = '/tmp/home';
    const exists = (path: string) => path === join(home, '.astrbot');

    expect(isAstrBotInstalled('/tmp/project', home, exists)).toBe(true);
  });

  it('detects AstrBot from cwd/astrbot', () => {
    const cwd = '/tmp/astrbot-project';
    const exists = (path: string) => path === join(cwd, 'astrbot');

    expect(isAstrBotInstalled(cwd, '/tmp/home', exists)).toBe(true);
  });

  it('detects AstrBot from data/plugins', () => {
    const cwd = '/tmp/astrbot-project';
    const exists = (path: string) => path === join(cwd, 'data', 'plugins');

    expect(isAstrBotInstalled(cwd, '/tmp/home', exists)).toBe(true);
  });
});

describe('AstrBot project-local markers', () => {
  it('does not treat bare data/ as a project marker', () => {
    const cwd = '/tmp/project';
    const exists = (path: string) => path === join(cwd, 'data');

    expect(isAstrBotProjectInstalled(cwd, exists)).toBe(false);
  });

  it('does not treat ASTRBOT_ROOT as a project marker', () => {
    const prev = process.env.ASTRBOT_ROOT;
    process.env.ASTRBOT_ROOT = '/opt/astrbot';
    try {
      expect(isAstrBotProjectInstalled('/tmp/project', () => false)).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.ASTRBOT_ROOT;
      else process.env.ASTRBOT_ROOT = prev;
    }
  });

  it('does not treat ~/.astrbot as a project marker', () => {
    const home = '/tmp/home';
    const exists = (path: string) => path === join(home, '.astrbot');

    expect(isAstrBotProjectInstalled('/tmp/project', exists)).toBe(false);
  });

  it('detects cwd/astrbot as a project marker', () => {
    const cwd = '/tmp/astrbot-project';
    const exists = (path: string) => path === join(cwd, 'astrbot');

    expect(isAstrBotProjectInstalled(cwd, exists)).toBe(true);
  });

  it('detects data/plugins as a project marker', () => {
    const cwd = '/tmp/astrbot-project';
    const exists = (path: string) => path === join(cwd, 'data', 'plugins');

    expect(isAstrBotProjectInstalled(cwd, exists)).toBe(true);
  });
});
