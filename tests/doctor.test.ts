/**
 * Tests for the `skills doctor` command.
 *
 * Verifies system info output and agent detection diagnostics.
 */

import { describe, it, expect } from 'vitest';
import { runCliOutput, runCli } from '../src/test-utils.ts';

describe('doctor command', () => {
  it('should output system information', () => {
    const output = runCliOutput(['doctor']);
    expect(output).toContain('Skills CLI Doctor');
    expect(output).toContain('System:');
    expect(output).toContain('OS:');
    expect(output).toContain('Node:');
    expect(output).toContain('Version:');
  });

  it('should output agent detection section', () => {
    const output = runCliOutput(['doctor']);
    expect(output).toContain('Detected Agents:');
    expect(output).toContain('agents detected');
  });

  it('should exit with code 0', () => {
    const result = runCli(['doctor']);
    expect(result.exitCode).toBe(0);
  });

  it('should not display the logo', () => {
    const output = runCliOutput(['doctor']);
    expect(output).not.toContain('███');
  });

  it('should show the current node version', () => {
    const output = runCliOutput(['doctor']);
    expect(output).toContain(process.version);
  });
});
