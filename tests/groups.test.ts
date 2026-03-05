import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  readGroupsConfig,
  writeGroupsConfig,
  createGroup,
  deleteGroup,
  addSkillToGroup,
  removeSkillFromGroup,
  findGroupForSkill,
  getSkillsInGroup,
  getGroupsPath,
  type GroupsConfig,
} from '../src/groups.ts';

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'skills-groups-test-'));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe('readGroupsConfig', () => {
  it('returns null when file does not exist', async () => {
    const result = await readGroupsConfig(tempDir);
    expect(result).toBeNull();
  });

  it('returns null for invalid JSON', async () => {
    const { writeFile } = await import('fs/promises');
    await writeFile(join(tempDir, 'skills.groups.json'), 'not json');
    const result = await readGroupsConfig(tempDir);
    expect(result).toBeNull();
  });

  it('returns null when groups field is missing', async () => {
    const { writeFile } = await import('fs/promises');
    await writeFile(join(tempDir, 'skills.groups.json'), JSON.stringify({ version: 1 }));
    const result = await readGroupsConfig(tempDir);
    expect(result).toBeNull();
  });

  it('reads a valid config', async () => {
    const config: GroupsConfig = {
      groups: {
        core: { description: 'Core skills', skills: ['coding-standards'] },
      },
    };
    const { writeFile } = await import('fs/promises');
    await writeFile(join(tempDir, 'skills.groups.json'), JSON.stringify(config));
    const result = await readGroupsConfig(tempDir);
    expect(result).toEqual(config);
  });
});

describe('writeGroupsConfig', () => {
  it('writes sorted groups and skills', async () => {
    const config: GroupsConfig = {
      groups: {
        debug: { description: 'Debug', skills: ['logging', 'debugging'] },
        core: { description: 'Core', skills: ['typescript', 'coding'] },
      },
    };
    await writeGroupsConfig(config, tempDir);
    const content = JSON.parse(await readFile(join(tempDir, 'skills.groups.json'), 'utf-8'));
    const groupNames = Object.keys(content.groups);
    expect(groupNames).toEqual(['core', 'debug']);
    expect(content.groups.debug.skills).toEqual(['debugging', 'logging']);
  });
});

describe('createGroup', () => {
  it('creates a new group', async () => {
    const created = await createGroup('deploy', 'Deployment skills', tempDir);
    expect(created).toBe(true);
    const config = await readGroupsConfig(tempDir);
    expect(config?.groups.deploy).toEqual({ description: 'Deployment skills', skills: [] });
  });

  it('returns false if group already exists', async () => {
    await createGroup('deploy', 'First', tempDir);
    const created = await createGroup('deploy', 'Second', tempDir);
    expect(created).toBe(false);
    const config = await readGroupsConfig(tempDir);
    expect(config?.groups.deploy?.description).toBe('First');
  });

  it('creates groups file if it does not exist', async () => {
    await createGroup('core', '', tempDir);
    const config = await readGroupsConfig(tempDir);
    expect(config).not.toBeNull();
    expect(config?.groups.core).toBeDefined();
  });
});

describe('deleteGroup', () => {
  it('deletes an existing group', async () => {
    await createGroup('temp', 'Temporary', tempDir);
    const deleted = await deleteGroup('temp', tempDir);
    expect(deleted).toEqual({ description: 'Temporary', skills: [] });
    const config = await readGroupsConfig(tempDir);
    expect(config?.groups.temp).toBeUndefined();
  });

  it('returns null for non-existent group', async () => {
    const deleted = await deleteGroup('missing', tempDir);
    expect(deleted).toBeNull();
  });
});

describe('addSkillToGroup', () => {
  it('adds a skill to an existing group', async () => {
    await createGroup('core', 'Core', tempDir);
    const added = await addSkillToGroup('typescript', 'core', tempDir);
    expect(added).toBe(true);
    const config = await readGroupsConfig(tempDir);
    expect(config?.groups.core?.skills).toContain('typescript');
  });

  it('creates the group if it does not exist', async () => {
    const added = await addSkillToGroup('logging', 'debug', tempDir);
    expect(added).toBe(true);
    const config = await readGroupsConfig(tempDir);
    expect(config?.groups.debug?.skills).toContain('logging');
  });

  it('returns false if skill already in group', async () => {
    await addSkillToGroup('typescript', 'core', tempDir);
    const added = await addSkillToGroup('typescript', 'core', tempDir);
    expect(added).toBe(false);
  });
});

describe('removeSkillFromGroup', () => {
  it('removes a skill from a group', async () => {
    await addSkillToGroup('typescript', 'core', tempDir);
    const removed = await removeSkillFromGroup('typescript', 'core', tempDir);
    expect(removed).toBe(true);
    const config = await readGroupsConfig(tempDir);
    expect(config?.groups.core?.skills).not.toContain('typescript');
  });

  it('returns false if group does not exist', async () => {
    const removed = await removeSkillFromGroup('skill', 'missing', tempDir);
    expect(removed).toBe(false);
  });

  it('returns false if skill not in group', async () => {
    await createGroup('core', 'Core', tempDir);
    const removed = await removeSkillFromGroup('missing', 'core', tempDir);
    expect(removed).toBe(false);
  });
});

describe('findGroupForSkill', () => {
  it('finds the group for a skill', () => {
    const config: GroupsConfig = {
      groups: {
        core: { description: '', skills: ['typescript'] },
        debug: { description: '', skills: ['logging'] },
      },
    };
    expect(findGroupForSkill(config, 'typescript')).toBe('core');
    expect(findGroupForSkill(config, 'logging')).toBe('debug');
  });

  it('returns null for ungrouped skill', () => {
    const config: GroupsConfig = {
      groups: { core: { description: '', skills: ['typescript'] } },
    };
    expect(findGroupForSkill(config, 'unknown')).toBeNull();
  });
});

describe('getSkillsInGroup', () => {
  it('returns skills for an existing group', () => {
    const config: GroupsConfig = {
      groups: { core: { description: '', skills: ['a', 'b'] } },
    };
    expect(getSkillsInGroup(config, 'core')).toEqual(['a', 'b']);
  });

  it('returns null for non-existent group', () => {
    const config: GroupsConfig = { groups: {} };
    expect(getSkillsInGroup(config, 'missing')).toBeNull();
  });
});

describe('getGroupsPath', () => {
  it('returns correct path', () => {
    expect(getGroupsPath('/my/project')).toBe('/my/project/skills.groups.json');
  });
});

describe('parseRemoveOptions --group', () => {
  it('parses --group flag', async () => {
    const { parseRemoveOptions } = await import('../src/remove.ts');
    const { skills, options } = parseRemoveOptions(['--group', 'debug']);
    expect(options.group).toBe('debug');
    expect(skills).toEqual([]);
  });
});

describe('parseAddOptions --group', () => {
  it('parses --group flag', async () => {
    const { parseAddOptions } = await import('../src/add.ts');
    const { source, options } = parseAddOptions([
      'vercel-labs/skills',
      '--group',
      'core',
      '--skill',
      'typescript',
    ]);
    expect(options.group).toBe('core');
    expect(source).toEqual(['vercel-labs/skills']);
  });
});

describe('parseListOptions --by-group', () => {
  it('parses --by-group flag', async () => {
    const { parseListOptions } = await import('../src/list.ts');
    const options = parseListOptions(['--by-group']);
    expect(options.byGroup).toBe(true);
  });
});
