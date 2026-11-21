import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchSources } from '../src/add.ts';
import { WellKnownProvider } from '../src/providers/wellknown.ts';
import { parseSource } from '../src/source-parser.ts';
import { createZip } from './fixtures/zip.ts';

const origin = 'https://skills.example.com';
const content = '---\nname: example\ndescription: Example skill.\n---\n# Example';

function serveIndexes(
  options: { type?: 'skill-md' | 'archive'; valid?: boolean; v2?: boolean } = {}
) {
  const bytes =
    options.type === 'archive' ? createZip([{ path: 'SKILL.md', contents: content }]) : content;
  const digest = options.valid
    ? `sha256:${createHash('sha256').update(bytes).digest('hex')}`
    : `sha256:${'0'.repeat(64)}`;
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    if (url === `${origin}/.well-known/agent-skills/index.json`) {
      if (options.v2 === false) return new Response(null, { status: 404 });
      return Response.json({
        $schema: 'https://schemas.agentskills.io/discovery/0.2.0/schema.json',
        skills: [
          {
            name: 'example',
            description: 'Example',
            type: options.type ?? 'skill-md',
            url: '/artifact',
            digest,
          },
        ],
      });
    }
    if (url === `${origin}/.well-known/skills/index.json`) {
      return Response.json({
        skills: [{ name: 'example', description: 'Example', files: ['SKILL.md'] }],
      });
    }
    if (url === `${origin}/artifact`) return new Response(bytes);
    if (url === `${origin}/.well-known/skills/example/SKILL.md`) return new Response(content);
    return new Response(null, { status: 404 });
  });
}

afterEach(() => vi.restoreAllMocks());

describe('well-known integrity failures', () => {
  it.each(['skill-md', 'archive'] as const)(
    'does not downgrade a mismatched %s artifact to v1',
    async (type) => {
      const fetch = serveIndexes({ type });

      await expect(new WellKnownProvider().fetchAllSkills(origin)).rejects.toThrow(
        /digest mismatch.*example/i
      );

      expect(fetch.mock.calls.map(([url]) => String(url))).not.toContain(
        `${origin}/.well-known/skills/example/SKILL.md`
      );
    }
  );

  it('preserves the integrity error in the source-fetching path used by updates', async () => {
    const fetch = serveIndexes();

    const [source] = await fetchSources([{ parsed: parseSource(origin), skills: ['example'] }]);

    expect(source?.resolved).toBeNull();
    expect(source?.error).toMatch(/digest mismatch.*example/i);
    expect(fetch.mock.calls.map(([url]) => String(url))).not.toContain(
      `${origin}/.well-known/skills/example/SKILL.md`
    );
  });

  it('does not downgrade when fetching a single skill', async () => {
    serveIndexes();

    await expect(new WellKnownProvider().fetchSkill(origin)).rejects.toThrow(
      /digest mismatch.*example/i
    );
  });

  it('keeps verified v2 artifacts ahead of v1', async () => {
    const fetch = serveIndexes({ valid: true });

    const skills = await new WellKnownProvider().fetchAllSkills(origin);

    expect(skills).toHaveLength(1);
    expect(skills[0]?.sourceUrl).toBe(`${origin}/artifact`);
    expect(fetch.mock.calls.map(([url]) => String(url))).not.toContain(
      `${origin}/.well-known/skills/example/SKILL.md`
    );
  });

  it('still uses v1 when no v2 index exists', async () => {
    serveIndexes({ v2: false });

    const skills = await new WellKnownProvider().fetchAllSkills(origin);

    expect(skills).toHaveLength(1);
    expect(skills[0]?.sourceUrl).toBe(`${origin}/.well-known/skills/example/SKILL.md`);
  });
});
