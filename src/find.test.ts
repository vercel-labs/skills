import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  formatInstallCommand,
  formatInstallHint,
  formatSkillLink,
  runFind,
} from './find.ts';
import { stripAnsi } from './test-utils.ts';

const EXAMPLE_REGISTRY_URL = 'https://registry.example.com/catalog';

describe('formatInstallCommand', () => {
  it('uses source@skill for repository sources', () => {
    expect(
      formatInstallCommand({
        name: 'find-skills',
        slug: 'vercel-labs/skills/find-skills',
        source: 'vercel-labs/skills',
      })
    ).toBe('vercel-labs/skills@find-skills');
  });

  it('uses add with --skill for URL sources', () => {
    expect(
      formatInstallCommand({
        name: 'skill-name',
        slug: 'public/skill-name',
        source: EXAMPLE_REGISTRY_URL,
      })
    ).toBe(`npx skills add ${EXAMPLE_REGISTRY_URL} --skill skill-name`);
  });

  it('falls back to slug when source is missing', () => {
    expect(
      formatInstallCommand({
        name: 'my-skill',
        slug: 'owner/repo',
        source: '',
      })
    ).toBe('owner/repo@my-skill');
  });
});

describe('formatInstallHint', () => {
  it('uses a URL-based template for URL sources', () => {
    expect(
      formatInstallHint({
        slug: 'public/skill-name',
        source: EXAMPLE_REGISTRY_URL,
      })
    ).toBe(`npx skills add ${EXAMPLE_REGISTRY_URL} --skill skill-name`);
  });

  it('uses the repository template for non-URL sources', () => {
    expect(
      formatInstallHint({
        slug: 'vercel-labs/skills/find-skills',
        source: 'vercel-labs/skills',
      })
    ).toBe('npx skills add <owner/repo@skill>');
  });
});

describe('formatSkillLink', () => {
  it('uses registry-resolved well-known paths for URL sources', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (url: string) => {
        if (url === `${EXAMPLE_REGISTRY_URL}/.well-known/agent-skills/index.json`) {
          return { ok: false };
        }

        if (url === `${EXAMPLE_REGISTRY_URL}/.well-known/skills/index.json`) {
          return {
            ok: true,
            json: async () => ({
              skills: [{ name: 'adapt', description: 'Test skill', files: ['SKILL.md'] }],
            }),
          };
        }

        throw new Error(`Unexpected URL: ${url}`);
      })
    );

    await expect(
      formatSkillLink({
        name: 'adapt',
        slug: 'adapt',
        source: EXAMPLE_REGISTRY_URL,
      })
    ).resolves.toBe(`${EXAMPLE_REGISTRY_URL}/.well-known/skills/adapt/SKILL.md`);
  });

  it('uses the skills.sh page for repository sources', async () => {
    await expect(
      formatSkillLink({
        name: 'find-skills',
        slug: 'vercel-labs/skills/find-skills',
        source: 'vercel-labs/skills',
      })
    ).resolves.toBe('https://skills.sh/vercel-labs/skills/find-skills');
  });
});

describe('runFind output', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('prints URL-source results with a single install template and concrete SKILL.md links', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === 'https://skills.sh/api/search?q=test&limit=10') {
        return {
          ok: true,
          json: async () => ({
            skills: [
              {
                id: 'ab-test-setup',
                name: 'ab-test-setup',
                installs: 12,
                source: EXAMPLE_REGISTRY_URL,
              },
              {
                id: 'webapp-testing',
                name: 'webapp-testing',
                installs: 0,
                source: EXAMPLE_REGISTRY_URL,
              },
            ],
          }),
        };
      }

      if (url === `${EXAMPLE_REGISTRY_URL}/.well-known/agent-skills/index.json`) {
        return { ok: false };
      }

      if (url === `${EXAMPLE_REGISTRY_URL}/.well-known/skills/index.json`) {
        return {
          ok: true,
          json: async () => ({
            skills: [
              { name: 'ab-test-setup', description: 'A', files: ['SKILL.md'] },
              { name: 'webapp-testing', description: 'B', files: ['SKILL.md'] },
            ],
          }),
        };
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    await runFind(['test']);

    const output = stripAnsi(logSpy.mock.calls.flat().join('\n'));
    expect(output).toContain(`Install with npx skills add ${EXAMPLE_REGISTRY_URL} --skill skill-name`);
    expect(output).toContain('ab-test-setup');
    expect(output).toContain('webapp-testing');
    expect(output).toContain(`${EXAMPLE_REGISTRY_URL}/.well-known/skills/ab-test-setup/SKILL.md`);
    expect(output).toContain(`${EXAMPLE_REGISTRY_URL}/.well-known/skills/webapp-testing/SKILL.md`);
    expect(output).not.toContain(`${EXAMPLE_REGISTRY_URL}@ab-test-setup`);
    expect(output).not.toContain(`npx skills add ${EXAMPLE_REGISTRY_URL} --skill ab-test-setup`);
  });

  it('keeps repository-source results in owner/repo@skill format', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === 'https://skills.sh/api/search?q=find&limit=10') {
        return {
          ok: true,
          json: async () => ({
            skills: [
              {
                id: 'vercel-labs/skills/find-skills',
                name: 'find-skills',
                installs: 42,
                source: 'vercel-labs/skills',
              },
            ],
          }),
        };
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    await runFind(['find']);

    const output = stripAnsi(logSpy.mock.calls.flat().join('\n'));
    expect(output).toContain('Install with npx skills add <owner/repo@skill>');
    expect(output).toContain('vercel-labs/skills@find-skills');
    expect(output).toContain('https://skills.sh/vercel-labs/skills/find-skills');
  });

  it('falls back to slug-based links when source is missing', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === 'https://skills.sh/api/search?q=my&limit=10') {
        return {
          ok: true,
          json: async () => ({
            skills: [
              {
                id: 'owner/repo/my-skill',
                name: 'my-skill',
                installs: 0,
                source: '',
              },
            ],
          }),
        };
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    await runFind(['my']);

    const output = stripAnsi(logSpy.mock.calls.flat().join('\n'));
    expect(output).toContain('owner/repo/my-skill@my-skill');
    expect(output).toContain('https://skills.sh/owner/repo/my-skill');
  });

  it('shows a no-results message when search returns nothing', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === 'https://skills.sh/api/search?q=missing&limit=10') {
        return {
          ok: true,
          json: async () => ({ skills: [] }),
        };
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    await runFind(['missing']);

    const output = stripAnsi(logSpy.mock.calls.flat().join('\n'));
    expect(output).toContain('No skills found for "missing"');
  });
});
