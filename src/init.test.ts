import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync, readFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { runCliOutput, stripLogo } from './test-utils.ts';

describe('init command', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `agents-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should initialize a agent and create AGENT.md', () => {
    const output = stripLogo(runCliOutput(['init', 'my-test-agent'], testDir));
    expect(output).toMatchInlineSnapshot(`
      "Initialized agent: my-test-agent

      Created:
        my-test-agent/AGENT.md

      Next steps:
        1. Edit my-test-agent/AGENT.md to define your agent instructions
        2. Update the name and description in the frontmatter

      Publishing:
        GitHub:  Push to a repo, then npx agents add <owner>/<repo>
        URL:     Host the file, then npx agents add https://example.com/my-test-agent/AGENT.md

      Browse existing agents for inspiration at https://agents.sh/

      "
    `);

    const agentPath = join(testDir, 'my-test-agent', 'AGENT.md');
    expect(existsSync(agentPath)).toBe(true);

    const content = readFileSync(agentPath, 'utf-8');
    expect(content).toMatchInlineSnapshot(`
      "---
      name: my-test-agent
      description: A brief description of what this agent does
      ---

      # my-test-agent

      Instructions for the agent to follow when this agent is activated.

      ## When to use

      Describe when this agent should be used.

      ## Instructions

      1. First step
      2. Second step
      3. Additional steps as needed
      "
    `);
  });

  it('should allow multiple agents in same directory', () => {
    runCliOutput(['init', 'hydration-fix'], testDir);
    runCliOutput(['init', 'waterfall-data-fetching'], testDir);

    expect(existsSync(join(testDir, 'hydration-fix', 'AGENT.md'))).toBe(true);
    expect(existsSync(join(testDir, 'waterfall-data-fetching', 'AGENT.md'))).toBe(true);
  });

  it('should init AGENT.md in cwd when no name provided', () => {
    const output = stripLogo(runCliOutput(['init'], testDir));

    expect(output).toContain('Initialized agent:');
    expect(output).toContain('Created:\n  AGENT.md'); // directly in cwd, not in a subfolder
    expect(output).toContain('Publishing:');
    expect(output).toContain('GitHub:');
    expect(output).toContain('npx agents add <owner>/<repo>');
    expect(output).toContain('URL:');
    expect(output).toContain('npx agents add https://example.com/AGENT.md');
    expect(existsSync(join(testDir, 'AGENT.md'))).toBe(true);
  });

  it('should show publishing hints with agent path', () => {
    const output = stripLogo(runCliOutput(['init', 'my-agent'], testDir));

    expect(output).toContain('Publishing:');
    expect(output).toContain('GitHub:  Push to a repo, then npx agents add <owner>/<repo>');
    expect(output).toContain(
      'URL:     Host the file, then npx agents add https://example.com/my-agent/AGENT.md'
    );
  });

  it('should show error if agent already exists', () => {
    runCliOutput(['init', 'existing-agent'], testDir);
    const output = stripLogo(runCliOutput(['init', 'existing-agent'], testDir));
    expect(output).toMatchInlineSnapshot(`
      "Agent already exists at existing-agent/AGENT.md
      "
    `);
  });
});
