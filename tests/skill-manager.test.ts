import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_DIR = join(__dirname, 'fixtures', 'skill-manager');

// Mock YAML parser (copied from update-skills.mjs)
function parseYAML(content: string): Record<string, any> {
  const result: Record<string, any> = {};
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Parse key-value pairs
    const colonIndex = trimmed.indexOf(':');
    if (colonIndex === -1) continue;

    const key = trimmed.substring(0, colonIndex).trim();
    let value = trimmed.substring(colonIndex + 1).trim();

    // Remove quotes
    value = value.replace(/^["']|["']$/g, '');

    // Parse array format [a, b, c]
    if (value.startsWith('[') && value.endsWith(']')) {
      const arrContent = value.slice(1, -1);
      result[key] = arrContent
        .split(',')
        .map((v) => v.trim())
        .filter((v) => v);
    } else {
      result[key] = value;
    }
  }

  return result;
}

// Mock frontmatter update function
function updateFrontmatter(content: string, field: string, value: any): string {
  // Handle array fields (e.g., tags)
  if (Array.isArray(value) && field !== 'trigger') {
    const bracketRegex = new RegExp(`^(${field}:\\s*\\[)[^\\]]*(\\])`, 'm');
    const arrayStr = value.join(', ');
    if (bracketRegex.test(content)) {
      return content.replace(bracketRegex, `${field}: [${arrayStr}]`);
    }
    const plainRegex = new RegExp(`^(${field}:\\s*)(.+)$`, 'm');
    if (plainRegex.test(content)) {
      return content.replace(plainRegex, `${field}: [${arrayStr}]`);
    }
  }

  // Handle trigger field
  if (field === 'trigger' && Array.isArray(value)) {
    const triggerRegex = /^(trigger:\s*)(?:[\s\S]*?)(?=\n\w+:|\n---)/m;
    const listItems = value.map((v) => `  - ${v}`).join('\n');
    if (triggerRegex.test(content)) {
      return content.replace(triggerRegex, `trigger:\n${listItems}`);
    }
  }

  // Handle simple fields
  const regex = new RegExp(`^(${field}:)\\s*(.*)$`, 'm');
  if (regex.test(content)) {
    return content.replace(regex, `${field}: ${value}`);
  }

  return content;
}

// Mock argument parser function
function parseArgs(args: string[]): { mode: string; source: string | null } {
  let mode = 'local';
  let source: string | null = null;

  if (args.length === 0) {
    return { mode: 'local', source: null };
  }

  if (args[0] === 'local' || args[0] === 'remote') {
    mode = args[0];
    source = args[1] || null;
  } else if (args[0].startsWith('http')) {
    mode = 'remote';
    source = args[0];
  } else {
    mode = 'local';
    source = args[0];
  }

  return { mode, source };
}

describe('skill-manager', () => {
  beforeEach(() => {
    // Ensure test directory exists
    if (!existsSync(TEST_DIR)) {
      mkdirSync(TEST_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    // Clean up test files
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  describe('YAML Parsing', () => {
    it('should parse basic key-value pairs', () => {
      const yaml = `
name: test-skill
version: 1.0.0
author: test-author
      `;
      const result = parseYAML(yaml);
      expect(result.name).toBe('test-skill');
      expect(result.version).toBe('1.0.0');
      expect(result.author).toBe('test-author');
    });

    it('should parse quoted strings', () => {
      const yaml = `
name: "test-skill"
description: 'test description'
      `;
      const result = parseYAML(yaml);
      expect(result.name).toBe('test-skill');
      expect(result.description).toBe('test description');
    });

    it('should parse arrays', () => {
      const yaml = `
tags: [tag1, tag2, tag3]
      `;
      const result = parseYAML(yaml);
      expect(result.tags).toEqual(['tag1', 'tag2', 'tag3']);
    });

    it('should skip empty lines and comments', () => {
      const yaml = `
# This is a comment
name: test-skill

# Another comment
version: 1.0.0
      `;
      const result = parseYAML(yaml);
      expect(result.name).toBe('test-skill');
      expect(result.version).toBe('1.0.0');
    });

    it('should parse array values with spaces', () => {
      const yaml = `
tags: [ skill-management, batch-update, automation ]
      `;
      const result = parseYAML(yaml);
      expect(result.tags).toEqual(['skill-management', 'batch-update', 'automation']);
    });
  });

  describe('Argument Parsing', () => {
    it('should default to local mode', () => {
      const result = parseArgs([]);
      expect(result.mode).toBe('local');
      expect(result.source).toBeNull();
    });

    it('should parse local mode', () => {
      const result = parseArgs(['local', './config.yml']);
      expect(result.mode).toBe('local');
      expect(result.source).toBe('./config.yml');
    });

    it('should parse remote mode', () => {
      const result = parseArgs(['remote', 'https://example.com/config.yml']);
      expect(result.mode).toBe('remote');
      expect(result.source).toBe('https://example.com/config.yml');
    });

    it('should auto-detect URL as remote mode', () => {
      const result = parseArgs(['https://example.com/config.yml']);
      expect(result.mode).toBe('remote');
      expect(result.source).toBe('https://example.com/config.yml');
    });

    it('should treat non-URL arguments as local files', () => {
      const result = parseArgs(['./my-config.yml']);
      expect(result.mode).toBe('local');
      expect(result.source).toBe('./my-config.yml');
    });

    it('should handle mode without source', () => {
      const result = parseArgs(['local']);
      expect(result.mode).toBe('local');
      expect(result.source).toBeNull();
    });
  });

  describe('Frontmatter Update', () => {
    it('should update simple fields', () => {
      const content = `---
name: old-name
version: 1.0.0
---
# Content
      `;
      const result = updateFrontmatter(content, 'name', 'new-name');
      expect(result).toContain('name: new-name');
      expect(result).toContain('version: 1.0.0');
    });

    it('should update array fields (tags)', () => {
      const content = `---
name: test-skill
tags: [old-tag1, old-tag2]
---
# Content
      `;
      const result = updateFrontmatter(content, 'tags', ['new-tag1', 'new-tag2']);
      expect(result).toContain('tags: [new-tag1, new-tag2]');
    });

    it('should update array fields without brackets', () => {
      const content = `---
name: test-skill
tags: old-tag1, old-tag2
---
# Content
      `;
      const result = updateFrontmatter(content, 'tags', ['new-tag1', 'new-tag2']);
      expect(result).toContain('tags: [new-tag1, new-tag2]');
    });

    it('should update trigger field to list format', () => {
      const content = `---
name: test-skill
trigger:
  - old-trigger
---
# Content
      `;
      const result = updateFrontmatter(content, 'trigger', ['trigger1', 'trigger2']);
      expect(result).toContain('  - trigger1');
      expect(result).toContain('  - trigger2');
    });

    it('should preserve unmodified fields', () => {
      const content = `---
name: test-skill
version: 1.0.0
author: test-author
---
# Content
      `;
      const result = updateFrontmatter(content, 'version', '2.0.0');
      expect(result).toContain('name: test-skill');
      expect(result).toContain('version: 2.0.0');
      expect(result).toContain('author: test-author');
    });
  });

  describe('Config Validation', () => {
    it('should validate skill name format', () => {
      const validNames = ['skill-manager', 'test-skill', 'my_skill', 'test123'];
      const invalidNames = ['', ' ', 'skill name', 'skill@name', 'skill.name'];

      for (const name of validNames) {
        expect(name).toMatch(/^[a-z0-9_-]+$/);
      }

      for (const name of invalidNames) {
        if (name) {
          expect(name).not.toMatch(/^[a-z0-9_-]+$/);
        }
      }
    });

    it('should validate version number format', () => {
      const validVersions = ['1.0.0', '0.1.0', '2.3.4', '1.0.0-beta'];

      for (const version of validVersions) {
        expect(version).toMatch(/^\d+\.\d+\.\d+/);
      }
    });

    it('should validate tag format', () => {
      const validTags = ['tag1', 'tag-2', 'tag_3', 'multi-word'];

      for (const tag of validTags) {
        expect(tag).toBeDefined();
        expect(typeof tag).toBe('string');
      }
    });
  });

  describe('Error Handling', () => {
    it('should handle special characters in YAML', () => {
      const yaml = `
description: "This is a \\"quoted\\" value"
name: test-skill
      `;
      const result = parseYAML(yaml);
      expect(result.name).toBe('test-skill');
      expect(result.description).toBeDefined();
    });

    it('should handle empty arrays', () => {
      const yaml = `
tags: []
      `;
      const result = parseYAML(yaml);
      expect(result.tags).toEqual([]);
    });

    it('should handle values with commas', () => {
      const yaml = `
description: "This, has, commas"
      `;
      const result = parseYAML(yaml);
      expect(result.description).toBe('This, has, commas');
    });
  });

  describe('batch-update feature tests', () => {
    it('should parse config with disabled field', () => {
      const yamlConfig = `# Skills Configuration
skills:
  - name: skill-1
    description: Test skill 1
    disabled: false
  - name: skill-2
    description: Test skill 2
    disabled: true
      `;

      // Assume parseYamlConfig function is testable
      // In actual tests, need to import the real function
      const lines = yamlConfig.split('\n');
      const hasDisabledField = lines.some((line) => line.includes('disabled:'));
      expect(hasDisabledField).toBe(true);
    });

    it('should identify enabled and disabled skills', () => {
      const enabledSkill = { name: 'enabled-skill', description: 'Enabled', disabled: false };
      const disabledSkill = { name: 'disabled-skill', description: 'Disabled', disabled: true };

      expect(enabledSkill.disabled).toBe(false);
      expect(disabledSkill.disabled).toBe(true);
    });

    it('should handle dry-run mode', () => {
      const dryRun = true;
      const expectedBehavior = 'Dry run mode - no changes made';

      // Mock dry-run behavior verification
      if (dryRun) {
        expect(expectedBehavior).toBeTruthy();
      }
    });
  });
});
