import { describe, expect, it } from 'vitest';
import { parseFrontmatter } from '../src/frontmatter';

describe('parseFrontmatter', () => {
  it('parses a SKILL.md whose frontmatter is on line 1 (happy path, unchanged)', () => {
    const raw = ['---', 'name: my-skill', 'description: A skill.', '---', '', '# Body', ''].join(
      '\n'
    );
    const { data, content } = parseFrontmatter(raw);
    expect(data.name).toBe('my-skill');
    expect(data.description).toBe('A skill.');
    expect(content.includes('# Body')).toBe(true);
  });

  it('tolerates a single-line HTML comment above the frontmatter', () => {
    const raw = [
      '<!-- Absorbed from upstream/repo (MIT). -->',
      '---',
      'name: my-skill',
      'description: A skill with provenance.',
      '---',
      '',
      '# Body',
      '',
    ].join('\n');
    const { data, content } = parseFrontmatter(raw);
    expect(data.name).toBe('my-skill');
    expect(data.description).toBe('A skill with provenance.');
    expect(content.includes('# Body')).toBe(true);
  });

  it('tolerates a multi-line HTML comment above the frontmatter', () => {
    const raw = [
      '<!--',
      '  Absorbed from upstream/repo (MIT).',
      '  Provenance preserved across the absorption boundary.',
      '-->',
      '---',
      'name: my-skill',
      'description: A skill.',
      '---',
      '# Body',
      '',
    ].join('\n');
    const { data } = parseFrontmatter(raw);
    expect(data.name).toBe('my-skill');
  });

  it('tolerates several stacked HTML comments before the frontmatter', () => {
    const raw = [
      '<!-- Comment A -->',
      '<!-- Comment B -->',
      '<!-- Comment C -->',
      '',
      '---',
      'name: my-skill',
      'description: A skill.',
      '---',
      '# Body',
      '',
    ].join('\n');
    const { data } = parseFrontmatter(raw);
    expect(data.name).toBe('my-skill');
  });

  it('tolerates leading blank lines before the frontmatter', () => {
    const raw = [
      '',
      '',
      '',
      '---',
      'name: my-skill',
      'description: A skill.',
      '---',
      '# Body',
      '',
    ].join('\n');
    const { data } = parseFrontmatter(raw);
    expect(data.name).toBe('my-skill');
  });

  it('returns empty data when no frontmatter exists at all (unchanged)', () => {
    const raw = '# Just a body\n\nNo frontmatter here.\n';
    const { data, content } = parseFrontmatter(raw);
    expect(data).toEqual({});
    expect(content).toBe(raw);
  });

  it('returns empty data when leading HTML comments are present but no frontmatter follows (unchanged)', () => {
    const raw = '<!-- Only a comment, no frontmatter -->\n\n# Body\n';
    const { data, content } = parseFrontmatter(raw);
    expect(data).toEqual({});
    // content is the ORIGINAL raw (so callers can re-render), not the stripped version.
    expect(content).toBe(raw);
  });

  it('handles CRLF line endings (Windows-authored SKILL.md)', () => {
    const raw =
      '<!-- comment -->\r\n---\r\nname: my-skill\r\ndescription: A skill.\r\n---\r\n# Body\r\n';
    const { data } = parseFrontmatter(raw);
    expect(data.name).toBe('my-skill');
  });
});
