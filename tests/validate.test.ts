import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { validateFrontmatter, isValidSPDX } from '../src/validate.ts';

const CLI_PATH = join(import.meta.dirname, '..', 'src', 'cli.ts');

function runCli(args: string[], cwd: string) {
  return spawnSync('node', [CLI_PATH, ...args], {
    cwd,
    encoding: 'utf-8',
    env: { ...process.env, NODE_ENV: 'test' },
    timeout: 30000,
  });
}

describe('isValidSPDX', () => {
  it('recognizes common licenses', () => {
    expect(isValidSPDX('MIT')).toBe(true);
    expect(isValidSPDX('Apache-2.0')).toBe(true);
    expect(isValidSPDX('ISC')).toBe(true);
    expect(isValidSPDX('GPL-3.0')).toBe(true);
    expect(isValidSPDX('CC-BY-4.0')).toBe(true);
    expect(isValidSPDX('Unlicense')).toBe(true);
  });

  it('supports OR expressions', () => {
    expect(isValidSPDX('MIT OR Apache-2.0')).toBe(true);
    expect(isValidSPDX('GPL-3.0 OR MIT')).toBe(true);
  });

  it('rejects unknown identifiers', () => {
    expect(isValidSPDX('CUSTOM-LICENSE')).toBe(false);
    expect(isValidSPDX('')).toBe(false);
  });

  it('rejects partially valid OR expressions', () => {
    expect(isValidSPDX('MIT OR CUSTOM')).toBe(false);
  });
});

describe('validateFrontmatter', () => {
  it('passes a well-formed skill', () => {
    const results = validateFrontmatter(
      {
        name: 'my-skill',
        description: 'A great skill that does many wonderful things',
        author: 'test-author',
        license: 'MIT',
        repository: 'https://github.com/test/repo',
        keywords: ['testing', 'example'],
      },
      '---\n---\n# My Skill\n\n' + 'x'.repeat(50)
    );

    const errors = results.filter((r) => r.severity === 'error');
    expect(errors).toHaveLength(0);
  });

  it('requires name field', () => {
    const results = validateFrontmatter({ description: 'A valid description here enough' }, '');
    expect(results.some((r) => r.field === 'name' && r.severity === 'error')).toBe(true);
  });

  it('requires description field', () => {
    const results = validateFrontmatter({ name: 'test-skill' }, '');
    expect(results.some((r) => r.field === 'description' && r.severity === 'error')).toBe(true);
  });

  it('rejects non-string name', () => {
    const results = validateFrontmatter(
      { name: 123, description: 'A valid description here enough' },
      ''
    );
    expect(results.some((r) => r.field === 'name' && r.severity === 'error')).toBe(true);
  });

  it('rejects non-string description', () => {
    const results = validateFrontmatter({ name: 'test', description: true }, '');
    expect(results.some((r) => r.field === 'description' && r.severity === 'error')).toBe(true);
  });

  it('errors on too-short description', () => {
    const results = validateFrontmatter({ name: 'test', description: 'too short' }, '');
    expect(
      results.some(
        (r) =>
          r.field === 'description' && r.severity === 'error' && r.message.includes('too short')
      )
    ).toBe(true);
  });

  it('warns on very long description', () => {
    const results = validateFrontmatter({ name: 'test', description: 'x'.repeat(501) }, '');
    expect(
      results.some(
        (r) =>
          r.field === 'description' && r.severity === 'warning' && r.message.includes('very long')
      )
    ).toBe(true);
  });

  it('warns on name with uppercase', () => {
    const results = validateFrontmatter(
      { name: 'MySkill', description: 'A valid description here enough' },
      ''
    );
    expect(results.some((r) => r.field === 'name' && r.severity === 'warning')).toBe(true);
  });

  it('warns on missing author', () => {
    const results = validateFrontmatter(
      { name: 'test', description: 'A valid description here enough' },
      ''
    );
    expect(results.some((r) => r.field === 'author' && r.severity === 'warning')).toBe(true);
  });

  it('warns on missing license', () => {
    const results = validateFrontmatter(
      { name: 'test', description: 'A valid description here enough' },
      ''
    );
    expect(results.some((r) => r.field === 'license' && r.severity === 'warning')).toBe(true);
  });

  it('warns on missing repository', () => {
    const results = validateFrontmatter(
      { name: 'test', description: 'A valid description here enough' },
      ''
    );
    expect(results.some((r) => r.field === 'repository' && r.severity === 'warning')).toBe(true);
  });

  it('info on unrecognized SPDX license', () => {
    const results = validateFrontmatter(
      {
        name: 'test',
        description: 'A valid description here enough',
        license: 'CUSTOM-1.0',
      },
      ''
    );
    expect(results.some((r) => r.field === 'license' && r.severity === 'info')).toBe(true);
  });

  it('warns on invalid repository URL', () => {
    const results = validateFrontmatter(
      {
        name: 'test',
        description: 'A valid description here enough',
        repository: 'not-a-url',
      },
      ''
    );
    expect(results.some((r) => r.field === 'repository' && r.severity === 'warning')).toBe(true);
  });

  it('info on missing keywords', () => {
    const results = validateFrontmatter(
      { name: 'test', description: 'A valid description here enough' },
      ''
    );
    expect(results.some((r) => r.field === 'keywords' && r.severity === 'info')).toBe(true);
  });

  it('info on non-array keywords', () => {
    const results = validateFrontmatter(
      { name: 'test', description: 'A valid description here enough', keywords: 'single' },
      ''
    );
    expect(results.some((r) => r.field === 'keywords' && r.severity === 'info')).toBe(true);
  });

  it('validates agents field', () => {
    const results = validateFrontmatter(
      {
        name: 'test',
        description: 'A valid description here enough',
        agents: ['Claude Code', 'NonExistentAgent'],
      },
      ''
    );
    // Claude Code is valid, NonExistentAgent should get info
    expect(
      results.some((r) => r.field === 'agents' && r.message.includes('NonExistentAgent'))
    ).toBe(true);
  });

  it('warns on non-array agents', () => {
    const results = validateFrontmatter(
      {
        name: 'test',
        description: 'A valid description here enough',
        agents: 'Claude Code',
      },
      ''
    );
    expect(results.some((r) => r.field === 'agents' && r.severity === 'warning')).toBe(true);
  });

  it('info on short body content', () => {
    const results = validateFrontmatter(
      { name: 'test', description: 'A valid description here enough' },
      '---\nname: test\n---\nShort.'
    );
    expect(results.some((r) => r.field === 'body' && r.severity === 'info')).toBe(true);
  });

  it('validates product-version field type', () => {
    const results = validateFrontmatter(
      {
        name: 'test',
        description: 'A valid description here enough',
        'product-version': 123,
      },
      ''
    );
    expect(results.some((r) => r.field === 'product-version' && r.severity === 'warning')).toBe(
      true
    );
  });
});

describe('validate CLI command', () => {
  let dir: string;

  it('should be listed in help output', () => {
    const result = runCli(['--help'], process.cwd());
    expect(result.stdout).toContain('validate');
    expect(result.stdout).toContain('lint');
  });

  it('should validate a valid skill and exit 0', async () => {
    dir = await mkdtemp(join(tmpdir(), 'validate-cli-'));
    try {
      const skillDir = join(dir, 'my-skill');
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        join(skillDir, 'SKILL.md'),
        `---
name: my-skill
description: A perfectly valid skill with enough description text
author: test-author
license: MIT
repository: https://github.com/test/repo
keywords: [test]
---

# My Skill

This is a well-written skill with plenty of body content to pass validation checks easily.
`,
        'utf-8'
      );

      const result = runCli(['validate', 'my-skill'], dir);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('my-skill');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('should exit 1 for skill with errors', async () => {
    dir = await mkdtemp(join(tmpdir(), 'validate-cli-'));
    try {
      const skillDir = join(dir, 'bad-skill');
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        join(skillDir, 'SKILL.md'),
        `---
name: bad-skill
description: short
---
# Bad
`,
        'utf-8'
      );

      const result = runCli(['validate', 'bad-skill'], dir);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain('error');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('should exit 1 in strict mode with warnings', async () => {
    dir = await mkdtemp(join(tmpdir(), 'validate-cli-'));
    try {
      const skillDir = join(dir, 'warn-skill');
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        join(skillDir, 'SKILL.md'),
        `---
name: warn-skill
description: A description that is long enough to pass the minimum requirement
---

# Warn Skill

This skill has enough body content to avoid the short body warning message here.
`,
        'utf-8'
      );

      // Without --strict: should pass (only warnings, no errors)
      const normalResult = runCli(['validate', 'warn-skill'], dir);
      expect(normalResult.status).toBe(0);

      // With --strict: should fail on warnings
      const strictResult = runCli(['validate', 'warn-skill', '--strict'], dir);
      expect(strictResult.status).toBe(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('should handle no SKILL.md files gracefully', async () => {
    dir = await mkdtemp(join(tmpdir(), 'validate-cli-'));
    try {
      const result = runCli(['validate'], dir);
      expect(result.stdout).toContain('No SKILL.md files found');
      expect(result.status).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('lint alias should work', async () => {
    dir = await mkdtemp(join(tmpdir(), 'validate-cli-'));
    try {
      const result = runCli(['lint'], dir);
      expect(result.stdout).toContain('No SKILL.md files found');
      expect(result.status).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('init template includes recommended fields', () => {
  it('should include author and license in init template', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'init-template-'));
    try {
      const result = runCli(['init', 'new-skill'], dir);
      expect(result.status).toBe(0);

      const { readFile } = await import('node:fs/promises');
      const content = await readFile(join(dir, 'new-skill', 'SKILL.md'), 'utf-8');
      expect(content).toContain('author:');
      expect(content).toContain('license:');
      expect(content).toContain('# repository:');
      expect(content).toContain('# keywords:');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
