import { describe, it, expect } from 'vitest';
import { readFileSync, mkdtempSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
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

    it('should contain Global Options with --debug', () => {
      const output = runCliOutput(['--help']);
      expect(output).toContain('Global Options:');
      expect(output).toContain('--debug, -d');
      expect(output).toContain('--verbose');
    });
  });

  describe('--debug', () => {
    it('should log to file and not pollute stderr TUI nor stdout for --json', () => {
      const xdg = mkdtempSync(join(tmpdir(), 'skills-xdg-'));
      try {
        const result = runCli(['list', '--json'], undefined, {
          SKILLS_DEBUG: '1',
          XDG_STATE_HOME: xdg,
        });
        // stderr should contain single Debug log: line, but NOT raw debug lines
        expect(result.stderr).toContain('Debug log:');
        expect(result.stderr).not.toContain('[debug:cli]');
        // stdout should still be valid JSON
        expect(() => JSON.parse(result.stdout)).not.toThrow();
        // file should contain debug traces
        const logFile = join(xdg, 'skills', 'debug.log');
        expect(existsSync(logFile)).toBe(true);
        const content = readFileSync(logFile, 'utf-8');
        expect(content).toContain('[debug:cli]');
        expect(content).toContain('[debug:fs]');
        expect(content).toContain('=== skills --debug');
      } finally {
        rmSync(xdg, { recursive: true, force: true });
      }
    });

    it('should accept -d alias, strip from command, and log to file', () => {
      const xdg = mkdtempSync(join(tmpdir(), 'skills-xdg-'));
      try {
        const result = runCli(['-d', '--help'], undefined, { XDG_STATE_HOME: xdg });
        expect(result.stdout).toContain('Usage: skills');
        expect(result.stderr).toContain('Debug log:');
        expect(result.stderr).not.toContain('[debug:cli]');
        const logFile = join(xdg, 'skills', 'debug.log');
        expect(readFileSync(logFile, 'utf-8')).toContain('[debug:cli]');
      } finally {
        rmSync(xdg, { recursive: true, force: true });
      }
    });

    it('should accept --debug before command and keep --json pure', () => {
      const xdg = mkdtempSync(join(tmpdir(), 'skills-xdg-'));
      try {
        const result = runCli(['--debug', 'list', '--json'], undefined, { XDG_STATE_HOME: xdg });
        expect(result.stderr).toContain('Debug log:');
        expect(result.stderr).not.toContain('[debug:cli]');
        expect(() => JSON.parse(result.stdout)).not.toThrow();
        const logFile = join(xdg, 'skills', 'debug.log');
        expect(readFileSync(logFile, 'utf-8')).toContain('[debug:cli]');
      } finally {
        rmSync(xdg, { recursive: true, force: true });
      }
    });

    it('should accept --debug after command', () => {
      const xdg = mkdtempSync(join(tmpdir(), 'skills-xdg-'));
      try {
        const result = runCli(['list', '--debug', '--json'], undefined, { XDG_STATE_HOME: xdg });
        expect(result.stderr).toContain('Debug log:');
        expect(result.stderr).not.toContain('[debug:cli]');
        expect(() => JSON.parse(result.stdout)).not.toThrow();
        const logFile = join(xdg, 'skills', 'debug.log');
        expect(readFileSync(logFile, 'utf-8')).toContain('[debug:cli]');
      } finally {
        rmSync(xdg, { recursive: true, force: true });
      }
    });

    it('should enable via DEBUG=skills and log to file', () => {
      const xdg = mkdtempSync(join(tmpdir(), 'skills-xdg-'));
      try {
        const result = runCli(['--help'], undefined, { DEBUG: 'skills', XDG_STATE_HOME: xdg });
        expect(result.stderr).toContain('Debug log:');
        expect(result.stderr).not.toContain('[debug:cli]');
        const logFile = join(xdg, 'skills', 'debug.log');
        expect(readFileSync(logFile, 'utf-8')).toContain('[debug:cli]');
      } finally {
        rmSync(xdg, { recursive: true, force: true });
      }
    });

    it('should support --debug=/path override', () => {
      const xdg = mkdtempSync(join(tmpdir(), 'skills-xdg-'));
      const custom = join(xdg, 'custom.log');
      try {
        const result = runCli(['--debug=' + custom, '--help'], undefined, { XDG_STATE_HOME: xdg });
        expect(result.stderr).toContain('Debug log:');
        expect(result.stderr).toContain(custom);
        expect(existsSync(custom)).toBe(true);
        expect(readFileSync(custom, 'utf-8')).toContain('[debug:cli]');
        // default should not be used
        expect(existsSync(join(xdg, 'skills', 'debug.log'))).toBe(false);
      } finally {
        rmSync(xdg, { recursive: true, force: true });
      }
    });

    it('should support SKILLS_DEBUG_FILE override', () => {
      const xdg = mkdtempSync(join(tmpdir(), 'skills-xdg-'));
      const custom = join(xdg, 'env.log');
      try {
        const result = runCli(['--help'], undefined, {
          SKILLS_DEBUG_FILE: custom,
          XDG_STATE_HOME: xdg,
        });
        expect(result.stderr).toContain('Debug log:');
        expect(existsSync(custom)).toBe(true);
        expect(readFileSync(custom, 'utf-8')).toContain('[debug:cli]');
      } finally {
        rmSync(xdg, { recursive: true, force: true });
      }
    });

    it('should fallback to stderr when SKILLS_DEBUG=stderr', () => {
      const result = runCli(['list', '--json'], undefined, { SKILLS_DEBUG: 'stderr' });
      expect(result.stderr).toContain('[debug:cli]');
      // should NOT contain Debug log: file line
      expect(result.stderr).not.toContain('Debug log:');
      expect(() => JSON.parse(result.stdout)).not.toThrow();
    });

    it('should treat SKILLS_DEBUG=/path.log as file path', () => {
      const xdg = mkdtempSync(join(tmpdir(), 'skills-xdg-'));
      const custom = join(xdg, 'skills-debug.log');
      try {
        const result = runCli(['--help'], undefined, {
          SKILLS_DEBUG: custom,
          XDG_STATE_HOME: xdg,
        });
        expect(result.stderr).toContain('Debug log:');
        expect(existsSync(custom)).toBe(true);
        expect(readFileSync(custom, 'utf-8')).toContain('[debug:cli]');
      } finally {
        rmSync(xdg, { recursive: true, force: true });
      }
    });
  });

  describe('--version', () => {
    it('should display version number', () => {
      const output = runCliOutput(['--version']);
      expect(output.trim()).toMatch(/^\d+\.\d+\.\d+ \(bermudi fork\)$/);
    });

    it('should match package.json version', () => {
      const output = runCliOutput(['--version']);
      const pkg = JSON.parse(
        readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf-8')
      );
      expect(output.trim()).toContain(pkg.version);
      expect(output.trim()).toContain('bermudi fork');
    });

    it('should show bermudi fork in help', () => {
      const output = runCliOutput(['--help']);
      expect(output).toContain('bermudi fork');
    });

    it('should show bermudi fork in banner', () => {
      const result = runCli([]);
      const output = stripLogo(result.stdout);
      expect(output).toContain('bermudi fork');
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
