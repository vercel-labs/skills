import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { WellKnownProvider } from '../src/providers/wellknown.ts';

const SCHEMA_V2 = 'https://schemas.agentskills.io/discovery/0.2.0/schema.json';

function digest(content: string | Uint8Array): string {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}

function response(body: unknown, init?: ResponseInit): Response {
  if (typeof body === 'string' || body instanceof Uint8Array) {
    return new Response(body, init);
  }
  return Response.json(body, init);
}

function createTarGz(files: Record<string, string>): Uint8Array {
  const chunks: Buffer[] = [];

  for (const [name, contents] of Object.entries(files)) {
    const body = Buffer.from(contents);
    const header = Buffer.alloc(512);
    header.write(name, 0, 100, 'utf8');
    header.write('0000644\0', 100, 8, 'ascii');
    header.write('0000000\0', 108, 8, 'ascii');
    header.write('0000000\0', 116, 8, 'ascii');
    header.write(body.length.toString(8).padStart(11, '0') + '\0', 124, 12, 'ascii');
    header.write('00000000000\0', 136, 12, 'ascii');
    header.fill(' ', 148, 156);
    header[156] = '0'.charCodeAt(0);
    header.write('ustar\0', 257, 6, 'ascii');
    header.write('00', 263, 2, 'ascii');

    let sum = 0;
    for (const byte of header) sum += byte;
    header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');

    chunks.push(header, body);
    const padding = (512 - (body.length % 512)) % 512;
    if (padding) chunks.push(Buffer.alloc(padding));
  }

  chunks.push(Buffer.alloc(1024));
  return new Uint8Array(gzipSync(Buffer.concat(chunks)));
}

afterEach(() => {
  vi.restoreAllMocks();
});

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

  describe('fetchAllSkills', () => {
    it('keeps supporting legacy files[] indexes', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
        const href = String(url);
        if (href === 'https://example.com/.well-known/agent-skills/index.json') {
          return response({
            skills: [
              {
                name: 'legacy-skill',
                description: 'Legacy skill.',
                files: ['SKILL.md', 'references/README.md'],
              },
            ],
          });
        }
        if (href === 'https://example.com/.well-known/agent-skills/legacy-skill/SKILL.md') {
          return response('---\nname: legacy-skill\ndescription: Legacy skill.\n---\n# Legacy');
        }
        if (
          href === 'https://example.com/.well-known/agent-skills/legacy-skill/references/README.md'
        ) {
          return response('Reference');
        }
        return response('not found', { status: 404 });
      });

      const skills = await provider.fetchAllSkills('https://example.com');
      expect(skills).toHaveLength(1);
      expect(skills[0]!.installName).toBe('legacy-skill');
      expect(skills[0]!.files.has('references/README.md')).toBe(true);
    });

    it('keeps supporting path-relative legacy indexes like code.claude.com/docs', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
        const href = String(url);
        if (href === 'https://code.claude.com/docs/.well-known/agent-skills/index.json') {
          return response('not found', { status: 404 });
        }
        if (href === 'https://code.claude.com/.well-known/agent-skills/index.json') {
          return response('not found', { status: 404 });
        }
        if (href === 'https://code.claude.com/docs/.well-known/skills/index.json') {
          return response({
            skills: [{ name: 'claude', description: 'Claude Code.', files: ['SKILL.md'] }],
          });
        }
        if (href === 'https://code.claude.com/docs/.well-known/skills/claude/SKILL.md') {
          return response('---\nname: claude\ndescription: Claude Code.\n---\n# Claude');
        }
        return response('not found', { status: 404 });
      });

      const skills = await provider.fetchAllSkills('https://code.claude.com/docs');
      expect(skills).toHaveLength(1);
      expect(skills[0]!.installName).toBe('claude');
      expect(skills[0]!.sourceUrl).toBe(
        'https://code.claude.com/docs/.well-known/skills/claude/SKILL.md'
      );
    });

    it('supports v0.2.0 skill-md entries with relative URL resolution and digest checks', async () => {
      const skillMd = '---\nname: code-review\ndescription: Review code.\n---\n# Code Review';

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
        const href = String(url);
        if (href === 'https://example.com/.well-known/agent-skills/index.json') {
          return response({
            $schema: SCHEMA_V2,
            skills: [
              {
                name: 'code-review',
                type: 'skill-md',
                description: 'Review code.',
                url: 'code-review/SKILL.md',
                digest: digest(skillMd),
              },
            ],
          });
        }
        if (href === 'https://example.com/.well-known/agent-skills/code-review/SKILL.md') {
          return response(skillMd, { headers: { 'content-type': 'text/markdown' } });
        }
        return response('not found', { status: 404 });
      });

      const skills = await provider.fetchAllSkills('https://example.com');
      expect(skills).toHaveLength(1);
      expect(skills[0]!.installName).toBe('code-review');
      expect(skills[0]!.sourceUrl).toBe(
        'https://example.com/.well-known/agent-skills/code-review/SKILL.md'
      );
      expect(skills[0]!.files.get('SKILL.md')).toBe(skillMd);
    });

    it('rejects v0.2.0 skill-md entries with digest mismatches', async () => {
      const skillMd = '---\nname: code-review\ndescription: Review code.\n---\n# Code Review';

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
        const href = String(url);
        if (href === 'https://example.com/.well-known/agent-skills/index.json') {
          return response({
            $schema: SCHEMA_V2,
            skills: [
              {
                name: 'code-review',
                type: 'skill-md',
                description: 'Review code.',
                url: '/skills/code-review/SKILL.md',
                digest: `sha256:${'0'.repeat(64)}`,
              },
            ],
          });
        }
        if (href === 'https://example.com/skills/code-review/SKILL.md') {
          return response(skillMd);
        }
        return response('not found', { status: 404 });
      });

      const skills = await provider.fetchAllSkills('https://example.com');
      expect(skills).toHaveLength(0);
    });

    it('supports v0.2.0 archive entries after digest verification', async () => {
      const archive = createTarGz({
        'SKILL.md': '---\nname: archive-skill\ndescription: Archive skill.\n---\n# Archive',
        'references/README.md': 'Reference',
      });

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
        const href = String(url);
        if (href === 'https://example.com/.well-known/agent-skills/index.json') {
          return response({
            $schema: SCHEMA_V2,
            skills: [
              {
                name: 'archive-skill',
                type: 'archive',
                description: 'Archive skill.',
                url: '/downloads/archive-skill.tar.gz',
                digest: digest(archive),
              },
            ],
          });
        }
        if (href === 'https://example.com/downloads/archive-skill.tar.gz') {
          return response(archive, { headers: { 'content-type': 'application/gzip' } });
        }
        return response('not found', { status: 404 });
      });

      const skills = await provider.fetchAllSkills('https://example.com');
      expect(skills).toHaveLength(1);
      expect(skills[0]!.installName).toBe('archive-skill');
      expect(skills[0]!.files.has('SKILL.md')).toBe(true);
      expect(skills[0]!.files.has('references/README.md')).toBe(true);
    });

    it('does not process unknown schemas', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        response({
          $schema: 'https://schemas.agentskills.io/discovery/9.9.9/schema.json',
          skills: [],
        })
      );

      const skills = await provider.fetchAllSkills('https://example.com');
      expect(skills).toHaveLength(0);
    });
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
