import { describe, it, expect } from 'vitest';
import { hashSkillText, repoWebUrl, setLineage } from './lineage.ts';

const URL_A = 'https://github.com/acme/skills/tree/0123456789abcdef0123456789abcdef01234567/alpha';
const HASH_A = 'sha256:539e4d99711945ae440673fe5157fbded82fdaca1b5e99ac8189e4cbffc8da3d';

describe('hashSkillText', () => {
  // Expected values from the reference implementation:
  // python3 -c 'from skillgraph.hashing import hash_skill_text; print(hash_skill_text(s))'
  // https://github.com/sangaraju1988/skill-derivation-graph/blob/0bc8397/skillgraph/hashing.py
  it.each([
    [
      'plain',
      '---\nname: alpha\ndescription: Alpha skill\nmetadata:\n  author: acme\n---\n# Alpha\n\nDo the thing.\n',
      HASH_A,
    ],
    [
      'CRLF, trailing whitespace and blank lines',
      '---\r\nname: alpha  \r\ndescription: Alpha skill\t\r\nmetadata:\r\n  author: acme \r\n---\r\n# Alpha   \r\n\r\nDo the thing.\r\n\r\n\r\n',
      HASH_A,
    ],
    [
      'existing lineage keys',
      '---\nname: alpha\ndescription: Alpha skill\nmetadata:\n  author: acme\n  derived-from: "https://github.com/x/y/tree/abc/alpha"\n  derived-from-hash: "sha256:00"\n---\n# Alpha\n\nDo the thing.\n',
      HASH_A,
    ],
    [
      'Python whitespace rules and a BOM',
      '\uFEFF---\nname: alpha\u00a0\nderived-from: kept\u001c\n---\nbody\uFEFF\nend\u0085\n',
      'sha256:b761a90d7a0699a04e3a430a25963169a8f08b00a563e65379fbc7706f9566ac',
    ],
    [
      'no frontmatter',
      '# Just a body',
      'sha256:cc99fe67eb5e638e965e9285b287f5a20e1331685a8f0d88ba4c4f6a0ce90439',
    ],
  ])('matches the reference implementation: %s', (_label, text, expected) => {
    expect(hashSkillText(text)).toBe(expected);
  });
});

describe('setLineage', () => {
  const lineage = `  derived-from: "${URL_A}"\n  derived-from-hash: "${HASH_A}"\n`;

  it('creates metadata at the end of the frontmatter', () => {
    const raw = '---\nname: alpha\ndescription: Alpha skill\n---\n# Body\n';
    expect(setLineage(raw, URL_A, HASH_A)).toBe(
      `---\nname: alpha\ndescription: Alpha skill\nmetadata:\n${lineage}---\n# Body\n`
    );
  });

  it('appends to existing metadata and keeps other keys, comments and formatting', () => {
    const raw =
      '---\nname: alpha\nmetadata:   # owner info\n  author: acme\n  tags: [a, b]\n\nlicense: MIT\n---\n# Body\n';
    expect(setLineage(raw, URL_A, HASH_A)).toBe(
      `---\nname: alpha\nmetadata:   # owner info\n  author: acme\n  tags: [a, b]\n${lineage}\nlicense: MIT\n---\n# Body\n`
    );
  });

  it('uses the indentation of the existing metadata block', () => {
    const raw = '---\nname: alpha\nmetadata:\n    author: acme\n---\n';
    expect(setLineage(raw, URL_A, HASH_A)).toBe(
      `---\nname: alpha\nmetadata:\n    author: acme\n    derived-from: "${URL_A}"\n    derived-from-hash: "${HASH_A}"\n---\n`
    );
  });

  it('replaces existing lineage keys without duplicating them', () => {
    const raw = '---\nname: alpha\nmetadata:\n  author: acme\n---\n# Body\n';
    const once = setLineage(raw, 'https://example.com/old', 'sha256:old')!;
    expect(setLineage(once, URL_A, HASH_A)).toBe(
      `---\nname: alpha\nmetadata:\n  author: acme\n${lineage}---\n# Body\n`
    );
    expect(setLineage(setLineage(raw, URL_A, HASH_A)!, URL_A, HASH_A)).toBe(
      setLineage(raw, URL_A, HASH_A)
    );
  });

  it('keeps CRLF line endings and a BOM', () => {
    const raw = '\uFEFF---\r\nname: alpha\r\n---\r\n# Body\r\n';
    expect(setLineage(raw, URL_A, HASH_A)).toBe(
      `\uFEFF---\r\nname: alpha\r\nmetadata:\r\n  derived-from: "${URL_A}"\r\n  derived-from-hash: "${HASH_A}"\r\n---\r\n# Body\r\n`
    );
  });

  it('never touches the body', () => {
    const raw = '---\nname: alpha\n---\nmetadata:\n  derived-from: body text\n---\n';
    const stamped = setLineage(raw, URL_A, HASH_A)!;
    expect(stamped.endsWith('---\nmetadata:\n  derived-from: body text\n---\n')).toBe(true);
  });

  it('does not change the hash of the stamped text', () => {
    const raw =
      '---\nname: alpha\ndescription: Alpha skill\nmetadata:\n  author: acme\n---\n# Alpha\n\nDo the thing.\n';
    expect(hashSkillText(setLineage(raw, URL_A, HASH_A)!)).toBe(hashSkillText(raw));
  });

  it.each([
    ['no frontmatter', '# Body\n'],
    ['unterminated frontmatter', '---\nname: alpha\n# Body\n'],
    ['flow-style metadata', '---\nname: alpha\nmetadata: {author: acme}\n---\n'],
  ])('returns null for %s', (_label, raw) => {
    expect(setLineage(raw, URL_A, HASH_A)).toBeNull();
  });
});

describe('repoWebUrl', () => {
  it.each([
    ['https://github.com/acme/skills.git', 'https://github.com/acme/skills'],
    ['https://token@github.com/acme/skills.git/', 'https://github.com/acme/skills'],
    ['git@github.com:acme/skills.git', 'https://github.com/acme/skills'],
    [
      'ssh://git@gitlab.example.com:2222/group/skills.git',
      'https://gitlab.example.com/group/skills',
    ],
    ['https://git.example.com:8443/skills', 'https://git.example.com:8443/skills'],
    ['file:///tmp/repo', 'file:///tmp/repo'],
  ])('%s -> %s', (url, expected) => {
    expect(repoWebUrl(url)).toBe(expected);
  });

  it('returns null for an unrecognised URL', () => {
    expect(repoWebUrl('not a url')).toBeNull();
  });
});
