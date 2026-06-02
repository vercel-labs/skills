/**
 * End-to-end tests for installing skills from marketplace remote plugin sources.
 *
 * Fixtures: the marketplace is a local directory (local path source) whose
 * .claude-plugin/marketplace.json declares remote plugins pointing at local
 * git repositories via file:// URLs — real git, no network.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { pathToFileURL } from 'url';
import { runCli } from '../src/test-utils.ts';

const INSTALL_TIMEOUT = 120_000;

let dirCounter = 0;

function git(cwd: string, command: string): string {
  return execSync(`git ${command}`, { cwd, stdio: 'pipe' }).toString().trim();
}

/** Create a git repo containing skills at the given relative paths */
function createDomainRepo(dir: string, skillDirs: Record<string, string>): string {
  mkdirSync(dir, { recursive: true });
  git(dir, 'init -q');
  git(dir, 'config user.email test@example.com');
  git(dir, 'config user.name Test');
  git(dir, 'config commit.gpgsign false');

  for (const [skillDirPath, name] of Object.entries(skillDirs)) {
    const skillDir = join(dir, skillDirPath);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      `---\nname: ${name}\ndescription: Test skill ${name}\n---\n\n# ${name}\n`
    );
  }

  git(dir, 'add -A');
  git(dir, 'commit -qm init');
  return git(dir, 'rev-parse HEAD');
}

/** Create a marketplace directory with a manifest and optional local skills */
function createMarketplace(
  dir: string,
  manifest: unknown,
  localSkills: Record<string, string> = {}
): void {
  mkdirSync(join(dir, '.claude-plugin'), { recursive: true });
  writeFileSync(join(dir, '.claude-plugin/marketplace.json'), JSON.stringify(manifest, null, 2));

  for (const [skillDirPath, name] of Object.entries(localSkills)) {
    const skillDir = join(dir, skillDirPath);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      `---\nname: ${name}\ndescription: Test skill ${name}\n---\n\n# ${name}\n`
    );
  }
}

function readLocalLock(projectDir: string): {
  version: number;
  skills: Record<
    string,
    {
      source: string;
      sourceType: string;
      computedHash: string;
      resolvedFrom?: { pluginName: string; url: string; path?: string; ref?: string; sha: string };
    }
  >;
} {
  return JSON.parse(readFileSync(join(projectDir, 'skills-lock.json'), 'utf-8'));
}

describe('add with marketplace remote plugin sources', () => {
  let testDir: string;
  let projectDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `remote-add-test-${Date.now()}-${dirCounter++}`);
    projectDir = join(testDir, 'project');
    mkdirSync(projectDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it(
    'lists remote plugins without resolving them',
    () => {
      const domainRepo = join(testDir, 'domain-repo');
      createDomainRepo(domainRepo, { 'skills/remote-skill': 'remote-skill' });

      const marketplace = join(testDir, 'marketplace');
      createMarketplace(
        marketplace,
        {
          name: 'test-marketplace',
          plugins: [
            {
              name: 'remote-plugin',
              description: 'A plugin living in another repo',
              source: { source: 'url', url: pathToFileURL(domainRepo).href },
            },
          ],
        },
        { 'skills/local-skill': 'local-skill' }
      );

      const result = runCli(['add', marketplace, '--list'], projectDir);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('1 skill and 1 remote plugin');
      expect(result.stdout).toContain('remote-plugin');
      expect(result.stdout).toContain('A plugin living in another repo');
      expect(result.stdout).toContain('local-skill');
      // Remote plugin groups are marked with a globe so they can't be confused with local groups
      expect(result.stdout).toContain('🌐  Remote Plugin');
    },
    INSTALL_TIMEOUT
  );

  it(
    'installs a remote git-subdir plugin by plugin name and records provenance',
    () => {
      const domainRepo = join(testDir, 'frontend-monorepo');
      const domainSha = createDomainRepo(domainRepo, {
        'libs/design-system/skills/ds-angular': 'ds-angular',
        'unrelated/skills/decoy': 'decoy-skill',
      });

      const marketplace = join(testDir, 'marketplace');
      createMarketplace(marketplace, {
        name: 'company-marketplace',
        plugins: [
          {
            name: 'ds-angular',
            description: 'Angular Design System skill',
            source: {
              source: 'git-subdir',
              url: pathToFileURL(domainRepo).href,
              path: 'libs/design-system',
            },
          },
        ],
      });

      const result = runCli(
        ['add', marketplace, '--skill', 'ds-angular', '-y', '-a', 'claude-code'],
        projectDir
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Done!');
      // Transparency: resolved source and commit are shown
      expect(result.stdout).toContain('frontend-monorepo/libs/design-system');
      expect(result.stdout).toContain(domainSha.slice(0, 7));

      // The skill from the domain repo is installed; the decoy outside the path is not
      expect(existsSync(join(projectDir, '.claude/skills/ds-angular/SKILL.md'))).toBe(true);
      expect(existsSync(join(projectDir, '.claude/skills/decoy-skill'))).toBe(false);

      // Lock: marketplace is the source of record; resolvedFrom records provenance
      const lock = readLocalLock(projectDir);
      const entry = lock.skills['ds-angular'];
      expect(entry).toBeDefined();
      expect(entry.source).toBe(marketplace);
      expect(entry.sourceType).toBe('local');
      expect(entry.resolvedFrom).toBeDefined();
      expect(entry.resolvedFrom!.pluginName).toBe('ds-angular');
      expect(entry.resolvedFrom!.url).toBe(pathToFileURL(domainRepo).href);
      expect(entry.resolvedFrom!.path).toBe('libs/design-system');
      expect(entry.resolvedFrom!.sha).toBe(domainSha);
    },
    INSTALL_TIMEOUT
  );

  it(
    'finds a skill inside a remote plugin whose name differs from the skill name',
    () => {
      const domainRepo = join(testDir, 'domain-repo');
      createDomainRepo(domainRepo, {
        'skills/inner-skill-a': 'inner-skill-a',
        'skills/inner-skill-b': 'inner-skill-b',
      });

      const marketplace = join(testDir, 'marketplace');
      createMarketplace(marketplace, {
        plugins: [
          {
            name: 'design-system',
            description: 'Multiple design skills',
            source: { source: 'url', url: pathToFileURL(domainRepo).href },
          },
        ],
      });

      // Request a skill by its inner name, not the plugin name
      const result = runCli(
        ['add', marketplace, '--skill', 'inner-skill-a', '-y', '-a', 'claude-code'],
        projectDir
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Done!');

      // Only the requested inner skill is installed
      expect(existsSync(join(projectDir, '.claude/skills/inner-skill-a/SKILL.md'))).toBe(true);
      expect(existsSync(join(projectDir, '.claude/skills/inner-skill-b'))).toBe(false);

      const lock = readLocalLock(projectDir);
      expect(lock.skills['inner-skill-a']).toBeDefined();
      expect(lock.skills['inner-skill-a'].resolvedFrom?.pluginName).toBe('design-system');
    },
    INSTALL_TIMEOUT
  );

  it(
    'installs all skills in a selected remote plugin (plugin name selects the whole plugin)',
    () => {
      const domainRepo = join(testDir, 'domain-repo');
      createDomainRepo(domainRepo, {
        'skills/skill-one': 'skill-one',
        'skills/skill-two': 'skill-two',
      });

      const marketplace = join(testDir, 'marketplace');
      createMarketplace(marketplace, {
        plugins: [
          {
            name: 'multi-plugin',
            source: { source: 'url', url: pathToFileURL(domainRepo).href },
          },
        ],
      });

      const result = runCli(
        ['add', marketplace, '--skill', 'multi-plugin', '-y', '-a', 'claude-code'],
        projectDir
      );

      expect(result.exitCode).toBe(0);
      expect(existsSync(join(projectDir, '.claude/skills/skill-one/SKILL.md'))).toBe(true);
      expect(existsSync(join(projectDir, '.claude/skills/skill-two/SKILL.md'))).toBe(true);
    },
    INSTALL_TIMEOUT
  );

  it(
    'installs local and remote skills together with --skill *',
    () => {
      const domainRepo = join(testDir, 'domain-repo');
      createDomainRepo(domainRepo, { 'skills/remote-skill': 'remote-skill' });

      const marketplace = join(testDir, 'marketplace');
      createMarketplace(
        marketplace,
        {
          plugins: [
            {
              name: 'remote-plugin',
              source: { source: 'url', url: pathToFileURL(domainRepo).href },
            },
          ],
        },
        { 'skills/local-skill': 'local-skill' }
      );

      const result = runCli(
        ['add', marketplace, '--skill', '*', '-y', '-a', 'claude-code'],
        projectDir
      );

      expect(result.exitCode).toBe(0);
      expect(existsSync(join(projectDir, '.claude/skills/local-skill/SKILL.md'))).toBe(true);
      expect(existsSync(join(projectDir, '.claude/skills/remote-skill/SKILL.md'))).toBe(true);

      // Local skill has no resolvedFrom; remote skill does
      const lock = readLocalLock(projectDir);
      expect(lock.skills['local-skill'].resolvedFrom).toBeUndefined();
      expect(lock.skills['remote-skill'].resolvedFrom).toBeDefined();
    },
    INSTALL_TIMEOUT
  );

  it(
    'isolates failures: local skills install and exit code is non-zero when a remote plugin is unreachable',
    () => {
      const marketplace = join(testDir, 'marketplace');
      createMarketplace(
        marketplace,
        {
          plugins: [
            {
              name: 'broken-plugin',
              source: {
                source: 'url',
                url: pathToFileURL(join(testDir, 'does-not-exist')).href,
              },
            },
          ],
        },
        { 'skills/local-skill': 'local-skill' }
      );

      const result = runCli(
        ['add', marketplace, '--skill', '*', '-y', '-a', 'claude-code'],
        projectDir
      );

      // The reachable local skill still installs
      expect(existsSync(join(projectDir, '.claude/skills/local-skill/SKILL.md'))).toBe(true);
      // The failure is reported and reflected in the exit code
      expect(result.stdout).toContain('broken-plugin');
      expect(result.stdout).toContain('Could not resolve');
      expect(result.exitCode).toBe(1);
    },
    INSTALL_TIMEOUT
  );

  it(
    'reports unsupported npm plugin sources without failing the install',
    () => {
      const marketplace = join(testDir, 'marketplace');
      createMarketplace(
        marketplace,
        {
          plugins: [
            {
              name: 'npm-plugin',
              source: { source: 'npm', package: '@org/plugin' },
            },
          ],
        },
        { 'skills/local-skill': 'local-skill' }
      );

      const result = runCli(
        ['add', marketplace, '--skill', '*', '-y', '-a', 'claude-code'],
        projectDir
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('unsupported source types');
      expect(result.stdout).toContain('npm-plugin');
      expect(existsSync(join(projectDir, '.claude/skills/local-skill/SKILL.md'))).toBe(true);
    },
    INSTALL_TIMEOUT
  );

  it(
    'errors when no skills exist and no remote plugins are declared',
    () => {
      const marketplace = join(testDir, 'marketplace');
      createMarketplace(marketplace, { plugins: [] });

      const result = runCli(['add', marketplace, '-y', '-a', 'claude-code'], projectDir);

      expect(result.stdout).toContain('No skills found');
      expect(result.exitCode).toBe(1);
    },
    INSTALL_TIMEOUT
  );

  it(
    'warns and lets a local skill shadow a remote plugin of the same name (A1)',
    () => {
      const domainRepo = join(testDir, 'domain-repo');
      createDomainRepo(domainRepo, { 'skills/ds-angular': 'ds-angular' });

      const marketplace = join(testDir, 'marketplace');
      createMarketplace(
        marketplace,
        {
          plugins: [
            {
              name: 'ds-angular',
              source: { source: 'url', url: pathToFileURL(domainRepo).href },
            },
          ],
        },
        // A local skill of the same name as the remote plugin
        { 'skills/ds-angular': 'ds-angular' }
      );

      const result = runCli(
        ['add', marketplace, '--skill', 'ds-angular', '-y', '-a', 'claude-code'],
        projectDir
      );

      expect(result.exitCode).toBe(0);
      // Shadowing is announced, not silent
      expect(result.stdout).toContain('shadowed by a local skill');
      expect(result.stdout).toContain('local wins');

      // The local skill wins: no resolvedFrom provenance (it came from the marketplace itself)
      const lock = readLocalLock(projectDir);
      expect(lock.skills['ds-angular']).toBeDefined();
      expect(lock.skills['ds-angular'].resolvedFrom).toBeUndefined();
    },
    INSTALL_TIMEOUT
  );

  it(
    'warns about duplicate plugin names and uses the first entry (A2)',
    () => {
      const firstRepo = join(testDir, 'first-repo');
      createDomainRepo(firstRepo, { 'skills/from-first': 'from-first' });
      const secondRepo = join(testDir, 'second-repo');
      createDomainRepo(secondRepo, { 'skills/from-second': 'from-second' });

      const marketplace = join(testDir, 'marketplace');
      createMarketplace(marketplace, {
        plugins: [
          { name: 'dup-plugin', source: { source: 'url', url: pathToFileURL(firstRepo).href } },
          { name: 'dup-plugin', source: { source: 'url', url: pathToFileURL(secondRepo).href } },
        ],
      });

      const result = runCli(
        ['add', marketplace, '--skill', 'dup-plugin', '-y', '-a', 'claude-code'],
        projectDir
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('duplicate plugin name');
      // First entry wins: the skill from the first repo is installed, not the second
      expect(existsSync(join(projectDir, '.claude/skills/from-first/SKILL.md'))).toBe(true);
      expect(existsSync(join(projectDir, '.claude/skills/from-second'))).toBe(false);
    },
    INSTALL_TIMEOUT
  );

  it(
    'warns when two remote plugins provide a skill of the same name and keeps the first (B2)',
    () => {
      const repoA = join(testDir, 'repo-a');
      createDomainRepo(repoA, { 'skills/clash': 'clash' });
      const repoB = join(testDir, 'repo-b');
      createDomainRepo(repoB, { 'skills/clash': 'clash' });

      const marketplace = join(testDir, 'marketplace');
      createMarketplace(marketplace, {
        plugins: [
          { name: 'plugin-a', source: { source: 'url', url: pathToFileURL(repoA).href } },
          { name: 'plugin-b', source: { source: 'url', url: pathToFileURL(repoB).href } },
        ],
      });

      // Select both plugins; both contain an inner skill named "clash"
      const result = runCli(
        ['add', marketplace, '--skill', '*', '-y', '-a', 'claude-code'],
        projectDir
      );

      expect(result.exitCode).toBe(0);
      // The collision is announced, never silent
      expect(result.stdout).toContain('is provided by both');
      expect(result.stdout).toContain('first wins');

      // The first plugin's skill wins the lock entry; it is not overwritten
      const lock = readLocalLock(projectDir);
      expect(lock.skills['clash']).toBeDefined();
      expect(lock.skills['clash'].resolvedFrom?.pluginName).toBe('plugin-a');
      expect(existsSync(join(projectDir, '.claude/skills/clash/SKILL.md'))).toBe(true);
    },
    INSTALL_TIMEOUT
  );

  it(
    'searches remote plugins deterministically in -y mode without prompting (typo guard off)',
    () => {
      const domainRepo = join(testDir, 'domain-repo');
      createDomainRepo(domainRepo, { 'skills/inner-skill': 'inner-skill' });

      const marketplace = join(testDir, 'marketplace');
      createMarketplace(marketplace, {
        plugins: [
          {
            name: 'design-system',
            source: { source: 'url', url: pathToFileURL(domainRepo).href },
          },
        ],
      });

      // A typo'd skill name in -y mode: no interactive guard, the search runs and
      // simply finds nothing — the command must not hang on a prompt.
      const result = runCli(
        ['add', marketplace, '--skill', 'inner-skil', '-y', '-a', 'claude-code'],
        projectDir
      );

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain('No matching skills found');
      // No interactive confirmation text leaks into -y output
      expect(result.stdout).not.toContain('This will fetch');
    },
    INSTALL_TIMEOUT
  );
});
