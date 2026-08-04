import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { detectLocale, resetLocale, t } from './messages.ts';

const originalEnv = { ...process.env };

function setEnv(vars: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  resetLocale();
}

beforeEach(() => {
  setEnv({ SKILLS_LANG: undefined, LANG: undefined, LC_ALL: undefined, LC_MESSAGES: undefined });
});

afterEach(() => {
  process.env = { ...originalEnv };
  resetLocale();
});

describe('detectLocale', () => {
  it('defaults to English when no locale is set', () => {
    expect(detectLocale()).toBe('en');
  });

  it('prefers the SKILLS_LANG override', () => {
    setEnv({ SKILLS_LANG: 'zh', LANG: 'en_US.UTF-8' });
    expect(detectLocale()).toBe('zh');
    setEnv({ SKILLS_LANG: 'en', LANG: 'zh_CN.UTF-8' });
    expect(detectLocale()).toBe('en');
  });

  it('detects Chinese from LANG', () => {
    setEnv({ LANG: 'zh_CN.UTF-8' });
    expect(detectLocale()).toBe('zh');
  });

  it('detects Chinese from LC_ALL', () => {
    setEnv({ LC_ALL: 'zh_Hans_CN.UTF-8', LANG: 'en_US.UTF-8' });
    expect(detectLocale()).toBe('zh');
  });

  it('treats non-Chinese locales as English', () => {
    setEnv({ LANG: 'ja_JP.UTF-8' });
    expect(detectLocale()).toBe('en');
  });
});

describe('t', () => {
  it('returns the English template unchanged in English mode', () => {
    expect(t('Installation cancelled')).toBe('Installation cancelled');
  });

  it('returns the Chinese translation in Chinese mode', () => {
    setEnv({ SKILLS_LANG: 'zh' });
    expect(t('Installation cancelled')).toBe('安装已取消');
  });

  it('substitutes placeholders', () => {
    expect(
      t('Installing {name} from {pkg}…', { name: 'web-design', pkg: 'vercel/agent-skills' })
    ).toBe('Installing web-design from vercel/agent-skills…');
    setEnv({ SKILLS_LANG: 'zh' });
    expect(
      t('Installing {name} from {pkg}…', { name: 'web-design', pkg: 'vercel/agent-skills' })
    ).toBe('正在从 vercel/agent-skills 安装 web-design…');
  });

  it('falls back to English when no translation exists', () => {
    setEnv({ SKILLS_LANG: 'zh' });
    expect(t('Some untranslated message')).toBe('Some untranslated message');
  });
});
