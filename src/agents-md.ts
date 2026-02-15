import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { listInstalledSkills, type InstalledSkill } from './installer.ts';

const RESET = '\x1b[0m';
const DIM = '\x1b[38;5;102m';
const TEXT = '\x1b[38;5;145m';

const MANAGED_SECTION_START = '<!-- skills:agents:start -->';
const MANAGED_SECTION_END = '<!-- skills:agents:end -->';

interface AgentsOptions {
  global?: boolean;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeTableCell(value: string): string {
  return value.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim();
}

function renderSkillTable(skills: InstalledSkill[]): string[] {
  const sorted = [...skills].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  );

  const lines = ['| Skill | Description |', '| --- | --- |'];

  for (const skill of sorted) {
    const skillName = escapeTableCell(skill.name).replace(/`/g, '\\`');
    const description = escapeTableCell(skill.description);
    lines.push(`| \`${skillName}\` | ${description} |`);
  }

  return lines;
}

function renderManagedSection(skills: InstalledSkill[], global: boolean): string {
  const scopeLabel = global ? 'global' : 'project';
  const lines = [
    '## Skills',
    '',
    `This section is managed by \`npx skills agents\`. It lists installed ${scopeLabel} skills and descriptions.`,
    '',
  ];

  if (skills.length === 0) {
    lines.push(
      `No installed ${scopeLabel} skills found. Install one with \`npx skills add <package>\` and re-run this command.`
    );
    lines.push('');
  } else {
    lines.push(...renderSkillTable(skills));
    lines.push('');
  }

  return lines.join('\n');
}

function upsertManagedSection(content: string, sectionBody: string): string {
  const managedBlock = `${MANAGED_SECTION_START}\n${sectionBody}\n${MANAGED_SECTION_END}`;
  const sectionRegex = new RegExp(
    `${escapeRegExp(MANAGED_SECTION_START)}[\\s\\S]*?${escapeRegExp(MANAGED_SECTION_END)}`,
    'm'
  );

  if (sectionRegex.test(content)) {
    return content.replace(sectionRegex, managedBlock);
  }

  const trimmed = content.trimEnd();
  if (trimmed.length === 0) {
    return `${managedBlock}\n`;
  }

  return `${trimmed}\n\n${managedBlock}\n`;
}

export function parseAgentsOptions(args: string[]): AgentsOptions {
  const options: AgentsOptions = {};

  for (const arg of args) {
    if (arg === '-g' || arg === '--global') {
      options.global = true;
    }
  }

  return options;
}

export async function runAgents(args: string[]): Promise<void> {
  const options = parseAgentsOptions(args);
  const global = options.global === true;
  const cwd = process.cwd();
  const agentsMdPath = join(cwd, 'AGENTS.md');

  const installedSkills = await listInstalledSkills({ global, cwd });
  const managedSection = renderManagedSection(installedSkills, global);

  const currentContent = existsSync(agentsMdPath)
    ? readFileSync(agentsMdPath, 'utf-8')
    : '# AGENTS.md\n';
  const nextContent = upsertManagedSection(currentContent, managedSection);

  writeFileSync(agentsMdPath, nextContent, 'utf-8');

  const scopeLabel = global ? 'global' : 'project';
  console.log(
    `${TEXT}Updated AGENTS.md with ${installedSkills.length} ${scopeLabel} skill(s).${RESET}`
  );
  console.log(
    `${DIM}Run this again after installing/removing skills to refresh the section.${RESET}`
  );
}
