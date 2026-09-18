import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { runCli } from './test-utils.ts';
import { parseListOptions, buildExportCommands } from './list.ts';
import type { InstalledSkill } from './installer.ts';
import type { SkillLockEntry } from './skill-lock.ts';

describe('list command', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `skills-list-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  function createTestSkill(root: string, name: string, description: string): string {
    const skillDir = join(root, '.agents', 'skills', name);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      `---
name: ${name}
description: ${description}
---
# ${name}
`
    );
    return skillDir;
  }

  describe('parseListOptions', () => {
    it('should parse empty args', () => {
      const options = parseListOptions([]);
      expect(options).toEqual({});
    });

    it('should parse -g flag', () => {
      const options = parseListOptions(['-g']);
      expect(options.global).toBe(true);
    });

    it('should parse --global flag', () => {
      const options = parseListOptions(['--global']);
      expect(options.global).toBe(true);
    });

    it('should parse -a flag with single agent', () => {
      const options = parseListOptions(['-a', 'claude-code']);
      expect(options.agent).toEqual(['claude-code']);
    });

    it('should parse --agent flag with single agent', () => {
      const options = parseListOptions(['--agent', 'cursor']);
      expect(options.agent).toEqual(['cursor']);
    });

    it('should parse -a flag with multiple agents', () => {
      const options = parseListOptions(['-a', 'claude-code', 'cursor', 'codex']);
      expect(options.agent).toEqual(['claude-code', 'cursor', 'codex']);
    });

    it('should parse combined flags', () => {
      const options = parseListOptions(['-g', '-a', 'claude-code', 'cursor']);
      expect(options.global).toBe(true);
      expect(options.agent).toEqual(['claude-code', 'cursor']);
    });

    it('should parse --json flag', () => {
      const options = parseListOptions(['--json']);
      expect(options.json).toBe(true);
    });

    it('should parse --export flag', () => {
      const options = parseListOptions(['--export']);
      expect(options.export).toBe(true);
    });

    it('should parse combined --export and -g flags', () => {
      const options = parseListOptions(['-g', '--export']);
      expect(options.global).toBe(true);
      expect(options.export).toBe(true);
    });

    it('should parse combined --json and -g flags', () => {
      const options = parseListOptions(['-g', '--json']);
      expect(options.global).toBe(true);
      expect(options.json).toBe(true);
    });

    it('should stop collecting agents at next flag', () => {
      const options = parseListOptions(['-a', 'claude-code', '-g']);
      expect(options.agent).toEqual(['claude-code']);
      expect(options.global).toBe(true);
    });
  });

  describe('CLI integration', () => {
    it('should run list command', () => {
      const result = runCli(['list'], testDir);
      // Empty project dir shows "No project skills found"
      expect(result.stdout).toContain('No project skills found');
      expect(result.exitCode).toBe(0);
    });

    it('should run ls alias', () => {
      const result = runCli(['ls'], testDir);
      expect(result.stdout).toContain('No project skills found');
      expect(result.exitCode).toBe(0);
    });

    it('should output empty JSON array when no skills', () => {
      const result = runCli(['list', '--json'], testDir);
      expect(result.exitCode).toBe(0);
      const parsed = JSON.parse(result.stdout.trim());
      expect(parsed).toEqual([]);
    });

    it('should output valid JSON with --json flag', () => {
      createTestSkill(testDir, 'json-skill', 'A skill for JSON testing');

      const result = runCli(['list', '--json'], testDir);
      expect(result.exitCode).toBe(0);
      const parsed = JSON.parse(result.stdout.trim());
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBe(1);
      expect(parsed[0].name).toBe('json-skill');
      expect(parsed[0].path).toContain('json-skill');
      expect(parsed[0].scope).toBe('project');
      expect(Array.isArray(parsed[0].agents)).toBe(true);
      // No ANSI codes in JSON output
      expect(result.stdout).not.toMatch(/\x1b\[/);
    });

    it('should report project skill provenance from skills-lock.json', () => {
      createTestSkill(testDir, 'project-skill', 'A tracked project skill');
      writeFileSync(
        join(testDir, 'skills-lock.json'),
        JSON.stringify({
          version: 1,
          skills: {
            'project-skill': {
              source: 'owner/project-skills',
              sourceUrl: 'https://github.com/owner/project-skills',
              sourceType: 'github',
              computedHash: 'project-hash',
            },
          },
        })
      );

      const result = runCli(['list', '--json'], testDir);
      const [skill] = JSON.parse(result.stdout.trim());

      expect(skill).toMatchObject({
        source: 'owner/project-skills',
        sourceUrl: 'https://github.com/owner/project-skills',
        sourceType: 'github',
      });
      expect(skill).not.toHaveProperty('origin');
    });

    it('should output multiple skills as JSON array', () => {
      createTestSkill(testDir, 'skill-alpha', 'Alpha');
      createTestSkill(testDir, 'skill-beta', 'Beta');

      const result = runCli(['list', '--json'], testDir);
      expect(result.exitCode).toBe(0);
      const parsed = JSON.parse(result.stdout.trim());
      expect(parsed.length).toBe(2);
      const names = parsed.map((s: any) => s.name);
      expect(names).toContain('skill-alpha');
      expect(names).toContain('skill-beta');
    });

    it('should show message when no project skills found', () => {
      const result = runCli(['list'], testDir);
      expect(result.stdout).toContain('No project skills found');
      expect(result.stdout).toContain('Try listing global skills with -g');
      expect(result.exitCode).toBe(0);
    });

    it('should list project skills', () => {
      createTestSkill(testDir, 'test-skill', 'A test skill for listing');

      const result = runCli(['list'], testDir);
      expect(result.stdout).toContain('test-skill');
      expect(result.stdout).toContain('Project Skills');
      // Description should not be shown
      expect(result.stdout).not.toContain('A test skill for listing');
      expect(result.exitCode).toBe(0);
    });

    it('should show a tracked project skill source in human output', () => {
      createTestSkill(testDir, 'tracked-skill', 'A tracked project skill');
      writeFileSync(
        join(testDir, 'skills-lock.json'),
        JSON.stringify({
          version: 1,
          skills: {
            'tracked-skill': {
              source: 'owner/project-skills',
              sourceType: 'github',
              computedHash: 'project-hash',
            },
          },
        })
      );

      const result = runCli(['list'], testDir);

      expect(result.stdout).toContain('Source:');
      expect(result.stdout).toContain('owner/project-skills');
      expect(result.stdout).not.toContain('Origin:');
    });

    it('should keep untrusted source metadata on one output line', () => {
      createTestSkill(testDir, 'tracked-skill', 'A tracked project skill');
      writeFileSync(
        join(testDir, 'skills-lock.json'),
        JSON.stringify({
          version: 1,
          skills: {
            'tracked-skill': {
              source: 'owner/\nFORGED',
              sourceType: 'github',
              computedHash: 'project-hash',
            },
          },
        })
      );

      const result = runCli(['list'], testDir);

      expect(result.stdout).toContain('Source: owner/ FORGED');
      expect(result.stdout).not.toContain('\nFORGED');
    });

    it('should list multiple skills', () => {
      createTestSkill(testDir, 'skill-one', 'First skill');
      createTestSkill(testDir, 'skill-two', 'Second skill');

      const result = runCli(['list'], testDir);
      expect(result.stdout).toContain('skill-one');
      expect(result.stdout).toContain('skill-two');
      expect(result.stdout).toContain('Project Skills');
      expect(result.exitCode).toBe(0);
    });

    it('should respect -g flag for global only', () => {
      createTestSkill(testDir, 'project-skill', 'A project skill');

      const testHome = join(testDir, 'home');
      createTestSkill(testHome, 'global-skill', 'A global skill');

      const result = runCli(['list', '-g'], testDir, { HOME: testHome });
      // Should not show project skill when -g is specified
      expect(result.stdout).not.toContain('project-skill');
      expect(result.stdout).toContain('global-skill');
      expect(result.stdout).toContain('Global Skills');
    });

    it('should report global provenance when a lock key differs from its folder name', () => {
      const testHome = join(testDir, 'home');
      createTestSkill(testHome, 'ce-review', 'A tracked global plugin skill');
      const lockDir = join(testHome, '.local', 'state', 'skills');
      mkdirSync(lockDir, { recursive: true });
      writeFileSync(
        join(lockDir, '.skill-lock.json'),
        JSON.stringify({
          version: 3,
          skills: {
            'ce:review': {
              source: 'everyinc/compound-engineering-plugin',
              sourceUrl: 'https://github.com/everyinc/compound-engineering-plugin',
              sourceType: 'github',
              skillFolderHash: 'global-hash',
              installedAt: '2026-07-01T00:00:00.000Z',
              updatedAt: '2026-07-01T00:00:00.000Z',
            },
          },
        })
      );

      const result = runCli(['list', '-g', '--json'], testDir, { HOME: testHome });
      const [skill] = JSON.parse(result.stdout.trim());

      expect(skill).toMatchObject({
        name: 'ce-review',
        source: 'everyinc/compound-engineering-plugin',
        sourceUrl: 'https://github.com/everyinc/compound-engineering-plugin',
        sourceType: 'github',
      });
    });

    it('should show error for invalid agent filter', () => {
      const result = runCli(['list', '-a', 'invalid-agent'], testDir);
      expect(result.stdout).toContain('Invalid agents');
      expect(result.stdout).toContain('invalid-agent');
      expect(result.exitCode).toBe(1);
    });

    it('should filter by valid agent', () => {
      createTestSkill(testDir, 'test-skill', 'A test skill');

      const result = runCli(['list', '-a', 'claude-code'], testDir);
      expect(result.stdout).toContain('test-skill');
      expect(result.exitCode).toBe(0);
    });

    it('should ignore directories without SKILL.md', () => {
      createTestSkill(testDir, 'valid-skill', 'Valid skill');

      // Create an invalid directory (no SKILL.md)
      const invalidDir = join(testDir, '.agents', 'skills', 'invalid-skill');
      mkdirSync(invalidDir, { recursive: true });
      writeFileSync(join(invalidDir, 'README.md'), '# Not a skill');

      const result = runCli(['list'], testDir);
      expect(result.stdout).toContain('valid-skill');
      expect(result.stdout).not.toContain('invalid-skill');
      expect(result.exitCode).toBe(0);
    });

    it('should handle SKILL.md with missing frontmatter', () => {
      createTestSkill(testDir, 'valid-skill', 'Valid skill');

      // Create a skill with invalid SKILL.md (no frontmatter)
      const invalidDir = join(testDir, '.agents', 'skills', 'invalid-skill');
      mkdirSync(invalidDir, { recursive: true });
      writeFileSync(join(invalidDir, 'SKILL.md'), '# Invalid\nNo frontmatter here');

      const result = runCli(['list'], testDir);
      expect(result.stdout).toContain('valid-skill');
      expect(result.stdout).not.toContain('invalid-skill');
      expect(result.exitCode).toBe(0);
    });

    it('should show skill path', () => {
      createTestSkill(testDir, 'test-skill', 'A test skill');

      const result = runCli(['list'], testDir);
      // Path is shown inline with skill name (handles both Unix / and Windows \)
      expect(result.stdout).toMatch(/\.agents[/\\]skills[/\\]test-skill/);
    });
  });

  describe('--export', () => {
    function writeProjectLock(skills: Record<string, Record<string, unknown>>): void {
      writeFileSync(join(testDir, 'skills-lock.json'), JSON.stringify({ version: 1, skills }));
    }

    describe('buildExportCommands', () => {
      function makeSkill(name: string): InstalledSkill {
        return {
          name,
          description: '',
          path: `/skills/${name}`,
          canonicalPath: `/skills/${name}`,
          scope: 'global',
          agents: [],
        };
      }

      function lockLookup(
        entries: Record<string, Partial<SkillLockEntry>>
      ): (skillName: string) => SkillLockEntry | undefined {
        return (name) => entries[name] as SkillLockEntry | undefined;
      }

      it('should return no commands when no skills are installed', () => {
        const { commands, skipped } = buildExportCommands([], () => undefined, false);
        expect(commands).toEqual([]);
        expect(skipped).toEqual([]);
      });

      it('should group skills from the same source into one command', () => {
        const { commands } = buildExportCommands(
          [makeSkill('skill-a'), makeSkill('skill-b')],
          lockLookup({
            'skill-a': { source: 'owner/repo', sourceType: 'github' },
            'skill-b': { source: 'owner/repo', sourceType: 'github' },
          }),
          false
        );
        expect(commands).toEqual(['skills add owner/repo --skill skill-a skill-b -y']);
      });

      it('should use github shorthand for github.com and full URLs otherwise', () => {
        const { commands } = buildExportCommands(
          [makeSkill('hub'), makeSkill('ghe')],
          lockLookup({
            hub: {
              source: 'owner/repo',
              sourceUrl: 'https://github.com/owner/repo.git',
              sourceType: 'github',
            },
            ghe: {
              source: 'team/repo',
              sourceUrl: 'https://ghe.acme.com/team/repo.git',
              sourceType: 'github',
            },
          }),
          false
        );
        expect(commands).toEqual([
          'skills add https://ghe.acme.com/team/repo.git --skill ghe -y',
          'skills add owner/repo --skill hub -y',
        ]);
      });

      it('should keep skills with different refs in separate commands', () => {
        const { commands } = buildExportCommands(
          [makeSkill('pinned'), makeSkill('floating')],
          lockLookup({
            pinned: { source: 'owner/repo', sourceType: 'github', ref: 'v2' },
            floating: { source: 'owner/repo', sourceType: 'github' },
          }),
          false
        );
        expect(commands).toEqual([
          'skills add owner/repo --skill floating -y',
          "skills add 'owner/repo#v2' --skill pinned -y",
        ]);
      });

      it('should preserve each skill path from the lock file', () => {
        const { commands } = buildExportCommands(
          [makeSkill('root-skill'), makeSkill('nested-skill')],
          lockLookup({
            'root-skill': {
              source: 'owner/repo',
              sourceType: 'github',
              skillPath: 'SKILL.md',
            },
            'nested-skill': {
              source: 'owner/repo',
              sourceType: 'github',
              skillPath: 'skills/nested-skill/SKILL.md',
            },
          }),
          false
        );
        expect(commands).toEqual([
          'skills add owner/repo --skill root-skill -y',
          'skills add owner/repo/skills/nested-skill --skill nested-skill -y',
        ]);
      });

      it('should use full-depth when a git URL cannot include a skill path', () => {
        const { commands } = buildExportCommands(
          [makeSkill('nested-skill')],
          lockLookup({
            'nested-skill': {
              source: 'git@git.example.com:owner/repo.git',
              sourceType: 'git',
              skillPath: 'skills/nested-skill/SKILL.md',
            },
          }),
          false
        );
        expect(commands).toEqual([
          'skills add git@git.example.com:owner/repo.git --skill nested-skill --full-depth -y',
        ]);
      });

      it('should skip ambiguous legacy git sources', () => {
        const { commands, skipped } = buildExportCommands(
          [makeSkill('legacy-skill')],
          lockLookup({
            'legacy-skill': { source: 'acme/skills', sourceType: 'git' },
          }),
          false
        );
        expect(commands).toEqual([]);
        expect(skipped).toEqual(['legacy-skill (missing source URL)']);
      });

      it('should skip local and node_modules sources, explaining why', () => {
        const { commands, skipped } = buildExportCommands(
          [makeSkill('local-skill'), makeSkill('nm-skill')],
          lockLookup({
            'local-skill': { source: '/some/path', sourceType: 'local' },
            'nm-skill': { source: '@scope/pkg', sourceType: 'node_modules' },
          }),
          false
        );
        expect(commands).toEqual([]);
        expect(skipped).toEqual([
          'local-skill (local path: /some/path)',
          'nm-skill (node_modules: @scope/pkg)',
        ]);
      });

      it('should skip skills with no lock entry', () => {
        const { commands, skipped } = buildExportCommands(
          [makeSkill('orphan')],
          () => undefined,
          false
        );
        expect(commands).toEqual([]);
        expect(skipped).toEqual(['orphan (no recorded source)']);
      });

      it('should include -g for global scope', () => {
        const { commands } = buildExportCommands(
          [makeSkill('skill-a')],
          lockLookup({ 'skill-a': { source: 'owner/repo', sourceType: 'github' } }),
          true
        );
        expect(commands).toEqual(['skills add owner/repo --skill skill-a -g -y']);
      });
    });

    it('should output nothing on stdout when no skills are installed', () => {
      const result = runCli(['list', '--export'], testDir);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('');
    });

    it('should output only commands, one per line', () => {
      createTestSkill(testDir, 'skill-alpha', 'Alpha');
      createTestSkill(testDir, 'skill-beta', 'Beta');
      writeProjectLock({
        'skill-alpha': {
          source: 'owner/team-skills',
          sourceUrl: 'https://github.com/owner/team-skills.git',
          sourceType: 'github',
          computedHash: 'hash-a',
        },
        'skill-beta': {
          source: 'owner/team-skills',
          sourceUrl: 'https://github.com/owner/team-skills.git',
          sourceType: 'github',
          computedHash: 'hash-b',
        },
      });

      const result = runCli(['list', '--export'], testDir);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe(
        'skills add owner/team-skills --skill skill-alpha skill-beta -y'
      );
    });

    it('should use github shorthand for github.com and full URLs otherwise', () => {
      createTestSkill(testDir, 'hub-skill', 'GitHub skill');
      createTestSkill(testDir, 'ghe-skill', 'Enterprise skill');
      writeProjectLock({
        'hub-skill': {
          source: 'owner/repo',
          sourceUrl: 'https://github.com/owner/repo.git',
          sourceType: 'github',
          computedHash: 'hash-a',
        },
        'ghe-skill': {
          source: 'team/repo',
          sourceUrl: 'https://ghe.acme.com/team/repo.git',
          sourceType: 'github',
          computedHash: 'hash-b',
        },
      });

      const result = runCli(['list', '--export'], testDir);
      expect(result.stdout).toContain('skills add owner/repo --skill hub-skill -y');
      expect(result.stdout).toContain(
        'skills add https://ghe.acme.com/team/repo.git --skill ghe-skill -y'
      );
    });

    it('should append the ref as a quoted fragment', () => {
      createTestSkill(testDir, 'ref-skill', 'Pinned skill');
      writeProjectLock({
        'ref-skill': {
          source: 'owner/repo',
          sourceUrl: 'https://github.com/owner/repo.git',
          sourceType: 'github',
          ref: 'v2',
          computedHash: 'hash-a',
        },
      });

      const result = runCli(['list', '--export'], testDir);
      expect(result.stdout).toContain("skills add 'owner/repo#v2' --skill ref-skill -y");
    });

    it('should keep skipped local skills out of the command output', () => {
      createTestSkill(testDir, 'local-skill', 'Local skill');
      writeProjectLock({
        'local-skill': {
          source: '/some/path/on/this/machine',
          sourceType: 'local',
          computedHash: 'hash-a',
        },
      });

      const result = runCli(['list', '--export'], testDir);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).not.toContain('skills add');
      expect(result.stdout).not.toContain('local-skill');
    });

    it('should include -g when exporting global skills', () => {
      const testHome = join(testDir, 'home');
      createTestSkill(testHome, 'global-skill', 'A global skill');
      const lockDir = join(testHome, '.local', 'state', 'skills');
      mkdirSync(lockDir, { recursive: true });
      writeFileSync(
        join(lockDir, '.skill-lock.json'),
        JSON.stringify({
          version: 3,
          skills: {
            'global-skill': {
              source: 'owner/global-skills',
              sourceUrl: 'https://github.com/owner/global-skills.git',
              sourceType: 'github',
              skillFolderHash: 'global-hash',
              installedAt: '2026-07-01T00:00:00.000Z',
              updatedAt: '2026-07-01T00:00:00.000Z',
            },
          },
        })
      );

      const result = runCli(['list', '-g', '--export'], testDir, { HOME: testHome });
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe(
        'skills add owner/global-skills --skill global-skill -g -y'
      );
    });

    it('should reject --export combined with --json', () => {
      const result = runCli(['list', '--export', '--json'], testDir);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain('--export cannot be combined with --json');
    });
  });

  describe('help output', () => {
    it('should include list command in help', () => {
      const result = runCli(['--help']);
      expect(result.stdout).toContain('list, ls');
      expect(result.stdout).toContain('List installed skills');
    });

    it('should include list options in help', () => {
      const result = runCli(['--help']);
      expect(result.stdout).toContain('List Options:');
      expect(result.stdout).toContain('-g, --global');
      expect(result.stdout).toContain('-a, --agent');
    });

    it('should include list examples in help', () => {
      const result = runCli(['--help']);
      expect(result.stdout).toContain('skills list');
      expect(result.stdout).toContain('skills ls -g');
      expect(result.stdout).toContain('skills ls -a claude-code');
    });
  });

  describe('banner', () => {
    it('should include list command in banner', () => {
      const result = runCli([]);
      expect(result.stdout).toContain('npx skills list');
      expect(result.stdout).toContain('List installed skills');
    });
  });
});
