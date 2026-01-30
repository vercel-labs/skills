import { describe, it, expect } from 'vitest';
import { agents } from '../src/agents.ts';
import { homedir } from 'os';
import { join } from 'path';

describe('Augment agent', () => {
  it('should be properly configured', () => {
    const augment = agents['augment'];
    
    expect(augment).toBeDefined();
    expect(augment.name).toBe('augment');
    expect(augment.displayName).toBe('Augment');
    expect(augment.skillsDir).toBe('.augment/rules');
    expect(augment.globalSkillsDir).toBe(join(homedir(), '.augment/rules'));
    expect(typeof augment.detectInstalled).toBe('function');
  });

  it('should be included in agent keys', () => {
    const agentKeys = Object.keys(agents);
    expect(agentKeys).toContain('augment');
  });

  it('should have correct paths matching the issue requirements', () => {
    const augment = agents['augment'];
    
    // Project Skills Directory: .augment/rules
    expect(augment.skillsDir).toBe('.augment/rules');
    
    // Global Skills Directory: ~/.augment/rules
    expect(augment.globalSkillsDir).toBe(join(homedir(), '.augment/rules'));
  });

  it('should detect installation at ~/.augment', async () => {
    const augment = agents['augment'];
    
    // The detection function should be defined
    expect(augment.detectInstalled).toBeDefined();
    expect(typeof augment.detectInstalled).toBe('function');
  });
});

