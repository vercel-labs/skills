/**
 * Unit tests for sanitizeName function in installer.ts
 *
 * These tests verify the sanitization logic for skill names to ensure:
 * - Path traversal attacks are prevented
 * - Names follow kebab-case convention
 * - Special characters are handled safely
 */

import { describe, it, expect } from 'vitest';
import {
  sanitizeName,
  applyPrefix,
  stripPrefix,
  buildInstallName,
  rewriteFrontmatterName,
} from '../src/installer.ts';

describe('sanitizeName', () => {
  describe('basic transformations', () => {
    it('converts to lowercase', () => {
      expect(sanitizeName('MySkill')).toBe('myskill');
      expect(sanitizeName('UPPERCASE')).toBe('uppercase');
    });

    it('replaces spaces with hyphens', () => {
      expect(sanitizeName('my skill')).toBe('my-skill');
      expect(sanitizeName('Convex Best Practices')).toBe('convex-best-practices');
    });

    it('replaces multiple spaces with single hyphen', () => {
      expect(sanitizeName('my   skill')).toBe('my-skill');
    });

    it('preserves dots and underscores', () => {
      expect(sanitizeName('bun.sh')).toBe('bun.sh');
      expect(sanitizeName('my_skill')).toBe('my_skill');
      expect(sanitizeName('skill.v2_beta')).toBe('skill.v2_beta');
    });

    it('preserves numbers', () => {
      expect(sanitizeName('skill123')).toBe('skill123');
      expect(sanitizeName('v2.0')).toBe('v2.0');
    });
  });

  describe('special character handling', () => {
    it('replaces special characters with hyphens', () => {
      expect(sanitizeName('skill@name')).toBe('skill-name');
      expect(sanitizeName('skill#name')).toBe('skill-name');
      expect(sanitizeName('skill$name')).toBe('skill-name');
      expect(sanitizeName('skill!name')).toBe('skill-name');
    });

    it('collapses multiple special chars into single hyphen', () => {
      expect(sanitizeName('skill@#$name')).toBe('skill-name');
      expect(sanitizeName('a!!!b')).toBe('a-b');
    });
  });

  describe('path traversal prevention', () => {
    it('prevents path traversal with ../', () => {
      expect(sanitizeName('../etc/passwd')).toBe('etc-passwd');
      expect(sanitizeName('../../secret')).toBe('secret');
    });

    it('prevents path traversal with backslashes', () => {
      expect(sanitizeName('..\\..\\secret')).toBe('secret');
    });

    it('handles absolute paths', () => {
      expect(sanitizeName('/etc/passwd')).toBe('etc-passwd');
      expect(sanitizeName('C:\\Windows\\System32')).toBe('c-windows-system32');
    });
  });

  describe('leading/trailing cleanup', () => {
    it('removes leading dots', () => {
      expect(sanitizeName('.hidden')).toBe('hidden');
      expect(sanitizeName('..hidden')).toBe('hidden');
      expect(sanitizeName('...skill')).toBe('skill');
    });

    it('removes trailing dots', () => {
      expect(sanitizeName('skill.')).toBe('skill');
      expect(sanitizeName('skill..')).toBe('skill');
    });

    it('removes leading hyphens', () => {
      expect(sanitizeName('-skill')).toBe('skill');
      expect(sanitizeName('--skill')).toBe('skill');
    });

    it('removes trailing hyphens', () => {
      expect(sanitizeName('skill-')).toBe('skill');
      expect(sanitizeName('skill--')).toBe('skill');
    });

    it('removes mixed leading dots and hyphens', () => {
      expect(sanitizeName('.-.-skill')).toBe('skill');
      expect(sanitizeName('-.-.skill')).toBe('skill');
    });
  });

  describe('edge cases', () => {
    it('returns unnamed-skill for empty string', () => {
      expect(sanitizeName('')).toBe('unnamed-skill');
    });

    it('returns unnamed-skill when only special chars', () => {
      expect(sanitizeName('...')).toBe('unnamed-skill');
      expect(sanitizeName('---')).toBe('unnamed-skill');
      expect(sanitizeName('@#$%')).toBe('unnamed-skill');
    });

    it('handles very long names (truncates to 255 chars)', () => {
      const longName = 'a'.repeat(300);
      const result = sanitizeName(longName);
      expect(result.length).toBe(255);
      expect(result).toBe('a'.repeat(255));
    });

    it('handles unicode characters', () => {
      expect(sanitizeName('skill日本語')).toBe('skill');
      expect(sanitizeName('émoji🎉skill')).toBe('moji-skill');
    });
  });

  describe('real-world examples', () => {
    it('handles GitHub repo style names', () => {
      expect(sanitizeName('vercel/next.js')).toBe('vercel-next.js');
      expect(sanitizeName('owner/repo-name')).toBe('owner-repo-name');
    });

    it('handles URLs', () => {
      expect(sanitizeName('https://example.com')).toBe('https-example.com');
    });

    it('handles mintlify style names', () => {
      expect(sanitizeName('docs.example.com')).toBe('docs.example.com');
      expect(sanitizeName('bun.sh')).toBe('bun.sh');
    });
  });
});

describe('applyPrefix', () => {
  it('prepends a sanitized prefix', () => {
    expect(applyPrefix('tool', 'bundle')).toBe('bundle-tool');
    expect(applyPrefix('tool', 'Bundle Pack')).toBe('bundle-pack-tool');
  });

  it('is a no-op without a prefix', () => {
    expect(applyPrefix('tool')).toBe('tool');
    expect(applyPrefix('tool', '')).toBe('tool');
  });

  it('does not double-prefix', () => {
    expect(applyPrefix('browser-use', 'browser-use')).toBe('browser-use');
    expect(applyPrefix('bundle-tool', 'bundle')).toBe('bundle-tool');
  });
});

describe('stripPrefix', () => {
  it('removes an applied prefix (inverse of applyPrefix)', () => {
    expect(stripPrefix('bundle-tool', 'bundle')).toBe('tool');
  });

  it('is a no-op when not prefixed or no prefix given', () => {
    expect(stripPrefix('tool', 'bundle')).toBe('tool');
    expect(stripPrefix('tool')).toBe('tool');
    // Dedup case: name equals prefix, never had a `<prefix>-` segment.
    expect(stripPrefix('browser-use', 'browser-use')).toBe('browser-use');
  });

  it('round-trips with applyPrefix', () => {
    const prefix = 'bundle';
    expect(stripPrefix(applyPrefix('tool', prefix), prefix)).toBe('tool');
  });
});

describe('buildInstallName', () => {
  it('sanitizes the name when no prefix is given', () => {
    expect(buildInstallName('My Skill')).toBe('my-skill');
  });

  it('namespaces under a prefix', () => {
    expect(buildInstallName('tool', 'bundle')).toBe('bundle-tool');
  });

  it('does not double-prefix an already-prefixed name', () => {
    expect(buildInstallName('browser-use', 'browser-use')).toBe('browser-use');
    expect(buildInstallName('bundle-tool', 'bundle')).toBe('bundle-tool');
  });
});

describe('rewriteFrontmatterName', () => {
  it('rewrites the name value inside frontmatter, leaving the body intact', () => {
    const raw = `---\nname: tool\ndescription: Test tool\n---\n# Body\ntext\n`;
    const out = rewriteFrontmatterName(raw, 'bundle-tool');
    expect(out).toContain('name: bundle-tool');
    expect(out).toContain('description: Test tool');
    expect(out).toContain('# Body');
    expect(out).not.toContain('name: tool');
  });

  it('is idempotent', () => {
    const raw = `---\nname: bundle-tool\n---\nbody\n`;
    expect(rewriteFrontmatterName(raw, 'bundle-tool')).toBe(raw);
  });

  it('inserts a name line when frontmatter lacks one', () => {
    const raw = `---\ndescription: no name here\n---\nbody\n`;
    const out = rewriteFrontmatterName(raw, 'prefixed-skill');
    expect(out).toContain('name: prefixed-skill');
    expect(out).toContain('description: no name here');
  });

  it('returns input unchanged when there is no frontmatter', () => {
    const raw = `# Just markdown\nno frontmatter`;
    expect(rewriteFrontmatterName(raw, 'whatever')).toBe(raw);
  });
});
