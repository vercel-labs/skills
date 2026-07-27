import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { runCli, runCliOutput, stripLogo, hasLogo } from './test-utils.ts';

describe('skills CLI', () => {
  describe('--help', () => {
    it('should display help message', () => {
      const output = runCliOutput(['--help']);
      expect(output).toContain('Usage: skills <command> [options]');
      expect(output).toContain('Manage Skills:');
      expect(output).toContain('init [name]');
      expect(output).toContain('add <package>');
      expect(output).toContain('use <package>@<skill>');
      expect(output).toContain('update');
      expect(output).toContain('Add Options:');
      expect(output).toContain('Use Options:');
      expect(output).toContain('-g, --global');
      expect(output).toContain('-a, --agent');
      expect(output).toContain('-s, --skill');
      expect(output).toContain('-l, --list');
      expect(output).toContain('-y, --yes');
      expect(output).toContain('--all');
    });

    it('should show same output for -h alias', () => {
      const helpOutput = runCliOutput(['--help']);
      const hOutput = runCliOutput(['-h']);
      expect(hOutput).toBe(helpOutput);
    });
  });

  describe('--version', () => {
    it('should display version number', () => {
      const output = runCliOutput(['--version']);
      expect(output.trim()).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('should match package.json version', () => {
      const output = runCliOutput(['--version']);
      const pkg = JSON.parse(
        readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf-8')
      );
      expect(output.trim()).toBe(pkg.version);
    });
  });

  describe('no arguments', () => {
    it('should display banner', () => {
      const result = runCli([]);
      const output = stripLogo(result.stdout);
      expect(output).toContain('The open agent skills ecosystem');
      expect(output).toContain('npx skills add');
      expect(output).toContain('npx skills use');
      expect(output).toContain('npx skills update');
      expect(output).toContain('npx skills init');
      expect(output).toContain('skills.sh');
    });
  });

  describe('unknown command', () => {
    it('should show error for unknown command', () => {
      const output = runCliOutput(['unknown-command']);
      expect(output).toMatchInlineSnapshot(`
        "Unknown command: unknown-command
        Run skills --help for usage.
        "
      `);
    });

    it('should exit with code 1 for unknown command', () => {
      const result = runCli(['unknown-command']);
      expect(result.exitCode).toBe(1);
    });

    it('should exit with code 0 for top-level --help', () => {
      const result = runCli(['--help']);
      expect(result.exitCode).toBe(0);
    });

    it('should exit with code 0 for --version', () => {
      const result = runCli(['--version']);
      expect(result.exitCode).toBe(0);
    });
  });

  describe('subcommand --help', () => {
    // Each subcommand invoked with --help/-h must short-circuit to help output
    // before the subcommand handler runs, so no side effects (telemetry,
    // network calls, lock-file writes) can happen.
    const cases: Array<[string, string]> = [
      ['add --help routes to top-level help', 'add'],
      ['update --help routes to top-level help', 'update'],
      ['check --help routes to top-level help', 'check'],
      ['list --help routes to top-level help', 'list'],
      ['init --help routes to top-level help', 'init'],
      ['find --help routes to top-level help', 'find'],
      ['experimental_install --help routes to top-level help', 'experimental_install'],
      ['experimental_sync --help routes to top-level help', 'experimental_sync'],
    ];

    for (const [label, command] of cases) {
      it(label, () => {
        const result = runCli([command, '--help']);
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain('Usage: skills <command> [options]');
      });

      it(`${label} (-h alias)`, () => {
        const result = runCli([command, '-h']);
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain('Usage: skills <command> [options]');
      });
    }

    it('remove --help routes to remove-specific help', () => {
      const result = runCli(['remove', '--help']);
      expect(result.exitCode).toBe(0);
      // remove has its own help screen distinct from the top-level usage banner
      expect(result.stdout).toContain('skills remove');
    });

    it('update --help does not run the update flow', () => {
      const result = runCli(['update', '--help']);
      expect(result.exitCode).toBe(0);
      // The update flow prints this banner; it must not appear when --help is
      // passed, otherwise the side-effecting check is being executed.
      expect(result.stdout).not.toContain('Checking for skill updates');
      expect(result.stderr).not.toContain('Checking for skill updates');
    });
  });

  describe('logo display', () => {
    it('should not display logo for list command', () => {
      const output = runCliOutput(['list']);
      expect(hasLogo(output)).toBe(false);
    });

    it('should not display logo for check command', () => {
      // Note: check command makes GitHub API calls, so we just verify initial output
      const output = runCliOutput(['check']);
      expect(hasLogo(output)).toBe(false);
    }, 60000);

    it('should not display logo for update command', () => {
      // Note: update command makes GitHub API calls, so we just verify initial output
      const output = runCliOutput(['update']);
      expect(hasLogo(output)).toBe(false);
    }, 60000);
  });
});
