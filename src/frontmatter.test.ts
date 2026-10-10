import { describe, it, expect } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseFrontmatter } from './frontmatter.ts';
import { parseSkillMd } from './skills.ts';

describe('parseFrontmatter', () => {
  it.each([
    ['LF', '\n', ''],
    ['CRLF', '\r\n', ''],
    ['BOM and LF', '\n', '\uFEFF'],
    ['BOM and CRLF', '\r\n', '\uFEFF'],
  ])('reads YAML with %s', (_label, newline, prefix) => {
    const raw =
      prefix +
      ['---', 'name: example', 'description: Example skill', '---', '# Body', ''].join(newline);
    expect(parseFrontmatter(raw)).toEqual({
      data: { name: 'example', description: 'Example skill' },
      content: '# Body' + newline,
    });
  });

  it.each(['', '\uFEFF'])('keeps JavaScript frontmatter unsupported (prefix %j)', (prefix) => {
    const raw = prefix + '---js\n({ name: "example", description: "Example skill" })\n---\n# Body';
    expect(parseFrontmatter(raw)).toEqual({ data: {}, content: raw });
  });

  it('preserves text without frontmatter', () => {
    const raw = '\uFEFF# Body\n';
    expect(parseFrontmatter(raw)).toEqual({ data: {}, content: raw });
  });
});

describe('parseSkillMd', () => {
  it.each(['\n', '\r\n'])('loads a BOM-prefixed skill with newline %j', async (newline) => {
    const dir = await mkdtemp(join(tmpdir(), 'skills-bom-'));
    const path = join(dir, 'SKILL.md');
    const raw =
      '\uFEFF' +
      ['---', 'name: example', 'description: Example skill', '---', '# Body', ''].join(newline);
    try {
      await writeFile(path, raw, 'utf8');
      const skill = await parseSkillMd(path);
      expect(skill).toMatchObject({
        name: 'example',
        description: 'Example skill',
        path: dir,
        rawContent: raw,
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
