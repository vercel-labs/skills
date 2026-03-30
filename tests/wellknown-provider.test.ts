import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WellKnownProvider } from '../src/providers/wellknown.ts';

describe('WellKnownProvider', () => {
  const provider = new WellKnownProvider();

  describe('match', () => {
    it('should match arbitrary HTTP URLs', () => {
      expect(provider.match('https://example.com').matches).toBe(true);
      expect(provider.match('https://docs.example.com/skills').matches).toBe(true);
      expect(provider.match('http://localhost:3000').matches).toBe(true);
    });

    it('should match URLs with paths', () => {
      expect(provider.match('https://mintlify.com/docs').matches).toBe(true);
      expect(provider.match('https://example.com/api/v1').matches).toBe(true);
    });

    it('should not match GitHub URLs', () => {
      expect(provider.match('https://github.com/owner/repo').matches).toBe(false);
    });

    it('should not match GitLab URLs', () => {
      expect(provider.match('https://gitlab.com/owner/repo').matches).toBe(false);
    });

    it('should not match HuggingFace URLs', () => {
      expect(provider.match('https://huggingface.co/spaces/owner/repo').matches).toBe(false);
    });

    it('should not match non-HTTP URLs', () => {
      expect(provider.match('git@github.com:owner/repo.git').matches).toBe(false);
      expect(provider.match('ssh://git@example.com/repo').matches).toBe(false);
      expect(provider.match('/local/path').matches).toBe(false);
    });
  });

  describe('getSourceIdentifier', () => {
    it('should return full hostname', () => {
      expect(provider.getSourceIdentifier('https://example.com')).toBe('example.com');
      expect(provider.getSourceIdentifier('https://mintlify.com')).toBe('mintlify.com');
      expect(provider.getSourceIdentifier('https://lovable.dev')).toBe('lovable.dev');
    });

    it('should return same identifier regardless of path', () => {
      expect(provider.getSourceIdentifier('https://example.com/docs')).toBe('example.com');
      expect(provider.getSourceIdentifier('https://example.com/api/v1')).toBe('example.com');
    });

    it('should preserve subdomains', () => {
      expect(provider.getSourceIdentifier('https://docs.example.com')).toBe('docs.example.com');
      expect(provider.getSourceIdentifier('https://api.mintlify.com/docs')).toBe(
        'api.mintlify.com'
      );
      expect(provider.getSourceIdentifier('https://mppx-discovery-skills.vercel.app')).toBe(
        'mppx-discovery-skills.vercel.app'
      );
    });

    it('should strip www. prefix', () => {
      expect(provider.getSourceIdentifier('https://www.example.com')).toBe('example.com');
      expect(provider.getSourceIdentifier('https://www.mintlify.com/docs')).toBe('mintlify.com');
    });

    it('should return unknown for invalid URLs', () => {
      expect(provider.getSourceIdentifier('not-a-url')).toBe('unknown');
    });
  });

  describe('toRawUrl', () => {
    it('should return index.json URL for base URLs using agent-skills path', () => {
      const result = provider.toRawUrl('https://example.com');
      expect(result).toBe('https://example.com/.well-known/agent-skills/index.json');
    });

    it('should return index.json URL with path using agent-skills path', () => {
      const result = provider.toRawUrl('https://example.com/docs');
      expect(result).toBe('https://example.com/docs/.well-known/agent-skills/index.json');
    });

    it('should return SKILL.md URL if already pointing to skill.md', () => {
      const url = 'https://example.com/.well-known/skills/my-skill/SKILL.md';
      expect(provider.toRawUrl(url)).toBe(url);
    });

    it('should return SKILL.md URL for agent-skills path', () => {
      const url = 'https://example.com/.well-known/agent-skills/my-skill/SKILL.md';
      expect(provider.toRawUrl(url)).toBe(url);
    });

    it('should convert legacy skills skill path to agent-skills SKILL.md URL', () => {
      const result = provider.toRawUrl('https://example.com/.well-known/skills/my-skill');
      expect(result).toBe('https://example.com/.well-known/agent-skills/my-skill/SKILL.md');
    });

    it('should convert agent-skills skill path to SKILL.md URL', () => {
      const result = provider.toRawUrl('https://example.com/.well-known/agent-skills/my-skill');
      expect(result).toBe('https://example.com/.well-known/agent-skills/my-skill/SKILL.md');
    });
  });

  describe('isValidSkillEntry (via fetchIndex validation)', () => {
    // Since isValidSkillEntry is private, we test it indirectly through the provider's behavior

    it('provider should have id "well-known"', () => {
      expect(provider.id).toBe('well-known');
    });

    it('provider should have display name "Well-Known Skills"', () => {
      expect(provider.displayName).toBe('Well-Known Skills');
    });
  });
});

describe('WellKnownProvider.fetchSkillsByNames', () => {
  const provider = new WellKnownProvider();

  // Mock index.json and SKILL.md responses
  const mockIndex = {
    skills: [
      { name: 'skill-a', description: 'Skill A desc', files: ['SKILL.md'] },
      { name: 'skill-b', description: 'Skill B desc', files: ['SKILL.md', 'refs/data.md'] },
      { name: 'skill-c', description: 'Skill C desc', files: ['SKILL.md'] },
    ],
  };

  const skillMdContent = (name: string) =>
    `---\nname: ${name}\ndescription: ${name} description\n---\n# ${name}`;

  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  function mockFetchResponses() {
    fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url.includes('index.json')) {
        return new Response(JSON.stringify(mockIndex), { status: 200 });
      }

      // Match SKILL.md requests like /.well-known/agent-skills/skill-a/SKILL.md
      const skillMatch = url.match(/\/([a-z-]+)\/SKILL\.md$/);
      if (skillMatch && skillMatch[1]) {
        const name = skillMatch[1];
        if (['skill-a', 'skill-b', 'skill-c'].includes(name)) {
          return new Response(skillMdContent(name), { status: 200 });
        }
      }

      // Match other files like refs/data.md
      if (url.includes('/refs/data.md')) {
        return new Response('reference data', { status: 200 });
      }

      return new Response('Not found', { status: 404 });
    });
  }

  it('should only fetch requested skills, not all skills', async () => {
    mockFetchResponses();

    const results = await provider.fetchSkillsByNames('https://example.com', ['skill-b']);

    expect(results).toHaveLength(1);
    expect(results[0]!.installName).toBe('skill-b');

    // Verify: should NOT have fetched skill-a or skill-c SKILL.md
    const fetchedUrls = fetchSpy.mock.calls.map((call) => {
      const input = call[0];
      return typeof input === 'string' ? input : input!.toString();
    });

    expect(fetchedUrls.some((u) => u.includes('/skill-a/SKILL.md'))).toBe(false);
    expect(fetchedUrls.some((u) => u.includes('/skill-c/SKILL.md'))).toBe(false);
    expect(fetchedUrls.some((u) => u.includes('/skill-b/SKILL.md'))).toBe(true);
  });

  it('should handle case-insensitive skill name matching', async () => {
    mockFetchResponses();

    const results = await provider.fetchSkillsByNames('https://example.com', ['Skill-A']);

    expect(results).toHaveLength(1);
    expect(results[0]!.installName).toBe('skill-a');
  });

  it('should fetch multiple requested skills', async () => {
    mockFetchResponses();

    const results = await provider.fetchSkillsByNames('https://example.com', [
      'skill-a',
      'skill-c',
    ]);

    expect(results).toHaveLength(2);
    const names = results.map((r) => r.installName).sort();
    expect(names).toEqual(['skill-a', 'skill-c']);
  });

  it('should return empty array for non-existent skill names', async () => {
    mockFetchResponses();

    const results = await provider.fetchSkillsByNames('https://example.com', ['non-existent']);

    expect(results).toHaveLength(0);
  });

  it('should return empty array when index fetch fails', async () => {
    fetchSpy.mockImplementation(async () => new Response('Not found', { status: 404 }));

    const results = await provider.fetchSkillsByNames('https://example.com', ['skill-a']);

    expect(results).toHaveLength(0);
  });
});

describe('parseSource with well-known URLs', async () => {
  // Import parseSource after provider is defined
  const { parseSource } = await import('../src/source-parser.ts');

  it('should parse arbitrary URL as well-known type', () => {
    const result = parseSource('https://example.com');
    expect(result.type).toBe('well-known');
    expect(result.url).toBe('https://example.com');
  });

  it('should parse URL with path as well-known type', () => {
    const result = parseSource('https://mintlify.com/docs');
    expect(result.type).toBe('well-known');
    expect(result.url).toBe('https://mintlify.com/docs');
  });

  it('should not parse GitHub URL as well-known', () => {
    const result = parseSource('https://github.com/owner/repo');
    expect(result.type).toBe('github');
  });

  it('should not parse .git URL as well-known', () => {
    const result = parseSource('https://git.example.com/owner/repo.git');
    expect(result.type).toBe('git');
  });

  it('should parse direct skill.md URL as well-known (no more direct-url type)', () => {
    const result = parseSource('https://docs.example.com/skill.md');
    expect(result.type).toBe('well-known');
  });
});
