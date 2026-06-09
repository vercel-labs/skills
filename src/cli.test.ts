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
      const result = runCli([], undefined, {
        AI_AGENT: '',
        ANTIGRAVITY_AGENT: '',
        AUGMENT_AGENT: '',
        CLAUDE_CODE: '',
        CLAUDE_CODE_IS_COWORK: '',
        CLAUDECODE: '',
        CODEX_CI: '',
        CODEX_SANDBOX: '',
        CODEX_THREAD_ID: '',
        COPILOT_ALLOW_ALL: '',
        COPILOT_GITHUB_TOKEN: '',
        COPILOT_MODEL: '',
        CURSOR_AGENT: '',
        CURSOR_EXTENSION_HOST_ROLE: '',
        CURSOR_TRACE_ID: '',
        GEMINI_CLI: '',
        OPENCODE_CLIENT: '',
        REPL_ID: '',
      });
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
