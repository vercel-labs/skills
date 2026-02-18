#!/usr/bin/env node
/**
 * Skill batch export and update
 * Supports standard YAML format export and batch skill status updates
 */

import * as p from '@clack/prompts';
import pc from 'picocolors';
import { readFileSync, existsSync, writeFileSync } from 'fs';
import { readFile, writeFile } from 'fs/promises';
import matter from 'gray-matter';
import { listInstalledSkills } from './installer.ts';
import { track } from './telemetry.ts';

// Skill configuration interface
interface SkillConfig {
  name: string;
  description: string;
  disabled?: boolean;
  tags?: string[];
  triggers?: string[];
  [key: string]: any;
}

/**
 * Check if a value represents a disabled state
 */
function isDisabled(value: any): boolean {
  return value === true || value === 'true' || value === 'yes' || value === 'on' || value === '1';
}

/**
 * Set disabled state in frontmatter data
 */
function setDisabled(data: any, disabled: boolean): void {
  if (disabled) {
    data.disabled = true;
  } else {
    delete data.disabled;
  }
}

/**
 * Escape a string for YAML (handle special characters, quotes, newlines)
 */
function escapeYaml(value: string): string {
  // If value contains special YAML characters, wrap in quotes and escape
  const needsQuotes =
    /[:#{}[\],&*!?|>%@`]/.test(value) ||
    value.startsWith('-') ||
    value.startsWith(' ') ||
    value.endsWith(' ') ||
    value === '';

  if (!needsQuotes) {
    return value;
  }

  // Escape double quotes and use double quoted style
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');

  return `"${escaped}"`;
}

/**
 * Convert array to YAML format
 */
function arrayToYaml(arr: string[]): string {
  if (arr.length === 0) return '[]';
  return `[${arr.map((v) => escapeYaml(v)).join(', ')}]`;
}

/**
 * Convert skills to YAML format
 * @param extraFields - Additional fields to include
 */
function toYaml(skills: SkillConfig[], extraFields: string[] = []): string {
  if (skills.length === 0) {
    return '# Skills Configuration\nskills: []\n';
  }

  const lines: string[] = [];
  lines.push('# Skills Configuration');
  lines.push(`# Generated: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('skills:');

  for (const skill of skills) {
    lines.push(`  - name: ${escapeYaml(skill.name)}`);
    lines.push(`    description: ${escapeYaml(skill.description)}`);
    lines.push(`    disabled: ${skill.disabled ? 'true' : 'false'}`);

    // Add extra fields
    for (const field of extraFields) {
      if (field === 'tags' && skill.tags && skill.tags.length > 0) {
        lines.push(`    tags: ${arrayToYaml(skill.tags)}`);
      }
      if (field === 'triggers' && skill.triggers && skill.triggers.length > 0) {
        lines.push(`    triggers:`);
        for (const trigger of skill.triggers) {
          lines.push(`      - ${escapeYaml(trigger)}`);
        }
      }
    }
  }

  return lines.join('\n') + '\n';
}

/**
 * Parse YAML skills configuration
 */
function parseYamlConfig(content: string): SkillConfig[] {
  const skills: SkillConfig[] = [];
  const lines = content.split('\n');
  const skillList: Array<{ name: string; description?: string; disabled?: string }> = [];
  let inSkillsSection = false;
  let currentItem: { name?: string; description?: string; disabled?: string } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();
    const indent = line.length - line.trimStart().length;

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Detect skills: section start
    if (trimmed.startsWith('skills:')) {
      inSkillsSection = true;
      continue;
    }

    if (!inSkillsSection) continue;

    // Parse array items (start with -, indent is 2)
    if (trimmed.startsWith('- ') && indent === 2) {
      // Save previous item
      if (currentItem?.name) {
        skillList.push(currentItem);
      }
      // Extract name from "- name: xxx" or just "- xxx"
      const match = trimmed.match(/^- (name:\s*)?(.+)$/);
      if (match) {
        currentItem = { name: match[2].trim() };
      } else {
        currentItem = null;
      }
      continue;
    }

    // Parse key-value pairs (indent >= 4)
    if (indent >= 4 && currentItem) {
      const colonIndex = trimmed.indexOf(':');
      if (colonIndex === -1) continue;

      const key = trimmed.substring(0, colonIndex).trim();
      let value = trimmed.substring(colonIndex + 1).trim();

      // Remove surrounding quotes
      value = value.replace(/^["']|["']$/g, '');

      if (key === 'name') {
        currentItem.name = value;
      } else if (key === 'description' || key === 'desc') {
        // For multi-line values, concatenate with previous description
        if (value) {
          currentItem.description = (currentItem.description || '') + value;
        }
      } else if (key === 'disabled' || key === 'off') {
        currentItem.disabled = value;
      }
    }
  }

  // Save last item
  if (currentItem?.name) {
    skillList.push(currentItem);
  }

  // Convert to final format
  for (const item of skillList) {
    skills.push({
      name: item.name,
      description: item.description || '',
      disabled: isDisabled(item.disabled),
    });
  }

  return skills;
}

/**
 * Batch export skills
 */
async function exportSkills(
  options: { output?: string; global?: boolean; extraFields?: string[] } = {}
): Promise<void> {
  const spinner = p.spinner();
  spinner.start('Loading installed skills...');

  try {
    const installedSkills = await listInstalledSkills({
      global: options.global,
    });

    // Parse from SKILL.md to get disabled status and extra fields
    const skills: SkillConfig[] = [];
    for (const installedSkill of installedSkills) {
      const skillConfig: SkillConfig = {
        name: installedSkill.name,
        description: installedSkill.description || '',
        disabled: false,
      };

      // Always parse SKILL.md to get disabled status
      try {
        const skillMdPath = `${installedSkill.path}/SKILL.md`;
        if (existsSync(skillMdPath)) {
          const content = await readFile(skillMdPath, 'utf-8');
          const { data } = matter(content);

          // Read disabled status
          if (isDisabled(data.disabled)) {
            skillConfig.disabled = true;
          }

          // Parse extra fields if requested
          if (options.extraFields && options.extraFields.length > 0) {
            // Parse tags
            if (options.extraFields.includes('tags') && data.tags) {
              skillConfig.tags = Array.isArray(data.tags) ? data.tags : [data.tags];
            }

            // Parse triggers (supports trigger or triggers)
            if (options.extraFields.includes('triggers')) {
              const triggerData = data.triggers || data.trigger;
              if (triggerData) {
                skillConfig.triggers = Array.isArray(triggerData) ? triggerData : [triggerData];
              }
            }
          }
        }
      } catch {
        // Ignore parse failures, keep default values
      }

      skills.push(skillConfig);
    }

    spinner.stop(`Found ${pc.cyan(String(skills.length))} skill(s)`);

    if (skills.length === 0) {
      p.log.warn('No installed skills found');
      return;
    }

    const yamlContent = toYaml(skills, options.extraFields);

    if (options.output) {
      writeFileSync(options.output, yamlContent, 'utf-8');
      p.log.success(`Exported to ${pc.cyan(options.output)}`);
    } else {
      console.log();
      console.log(yamlContent);
    }

    track({ event: 'batch-export', skillCount: String(skills.length) });
  } catch (error) {
    spinner.stop('Failed to load skills');
    p.log.error(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    process.exit(1);
  }
}

/**
 * Batch update skills - Apply configuration changes to SKILL.md files
 */
async function updateSkillsFromConfig(
  configPath: string,
  options: { yes?: boolean; dryRun?: boolean; global?: boolean } = {}
): Promise<void> {
  if (!existsSync(configPath)) {
    console.log();
    p.log.error(pc.red(`Configuration file not found: ${configPath}`));
    console.log();
    p.log.message(`${pc.dim('Create a file with the following format:')}\n`);
    p.log.message(`# Skills Configuration`);
    p.log.message(`skills:`);
    p.log.message(`  - name: find-skills`);
    p.log.message(`    description: Help find and discover skills`);
    p.log.message(`    disabled: false\n`);
    process.exit(1);
  }

  const content = readFileSync(configPath, 'utf-8');
  const skills = parseYamlConfig(content);

  if (skills.length === 0) {
    p.log.warn(pc.yellow('No skills found in configuration file'));
    return;
  }

  console.log();
  const scopeText = options.global ? ' (global)' : '';
  p.intro(pc.bgCyan(pc.black(` skills batch-update${scopeText} `)));

  console.log();
  p.log.info(`Found ${pc.cyan(String(skills.length))} skill(s) in config`);
  console.log();

  const enabledSkills = skills.filter((s) => !s.disabled);
  const disabledSkills = skills.filter((s) => s.disabled);

  if (enabledSkills.length > 0) {
    p.log.info('Enabled skills:');
    for (const skill of enabledSkills) {
      p.log.message(`  ${pc.green('✓')} ${pc.cyan(skill.name)}`);
      if (skill.description) {
        p.log.message(`    ${pc.dim(skill.description)}`);
      }
    }
    console.log();
  }

  if (disabledSkills.length > 0) {
    p.log.info('Disabled skills:');
    for (const skill of disabledSkills) {
      p.log.message(`  ${pc.gray('✗')} ${pc.gray(skill.name)} ${pc.dim('(disabled)')}`);
    }
    console.log();
  }

  if (options.dryRun) {
    console.log();
    const spinner = p.spinner();
    spinner.start('Checking for updates...');

    let wouldUpdateCount = 0;
    let wouldSkipCount = 0;

    for (const skillConfig of skills) {
      try {
        const installedSkills = await listInstalledSkills({ global: options.global });
        const installedSkill = installedSkills.find((s) => s.name === skillConfig.name);

        if (!installedSkill) {
          wouldSkipCount++;
          continue;
        }

        const skillMdPath = `${installedSkill.canonicalPath}/SKILL.md`;
        if (!existsSync(skillMdPath)) {
          wouldSkipCount++;
          continue;
        }

        const fileContent = await readFile(skillMdPath, 'utf-8');
        const { data } = matter(fileContent);

        const currentDisabled = isDisabled(data.disabled);
        const targetDisabled = skillConfig.disabled === true;

        if (currentDisabled !== targetDisabled) {
          wouldUpdateCount++;
        } else {
          wouldSkipCount++;
        }
      } catch {
        wouldSkipCount++;
      }
    }

    spinner.stop('Check complete');

    console.log();
    if (wouldUpdateCount > 0) {
      p.log.info(`${wouldUpdateCount} skill(s) would be updated`);
    }
    if (wouldSkipCount > 0) {
      p.log.info(`${wouldSkipCount} skill(s) would be skipped (no changes needed or not found)`);
    }

    console.log();
    p.log.info(pc.yellow('Dry run mode - no changes made'));
    return;
  }

  if (!options.yes) {
    const confirmed = await p.confirm({
      message: 'Apply configuration changes?',
    });

    if (p.isCancel(confirmed) || !confirmed) {
      p.cancel('Update cancelled');
      process.exit(0);
    }
  }

  console.log();
  const spinner = p.spinner();
  spinner.start('Applying configuration...');

  let updatedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (const skillConfig of skills) {
    try {
      // Find the skill in installed skills
      const installedSkills = await listInstalledSkills({ global: options.global });
      const installedSkill = installedSkills.find((s) => s.name === skillConfig.name);

      if (!installedSkill) {
        console.log(
          `  ${pc.dim('⚠')} ${pc.yellow(skillConfig.name)} ${pc.dim(`not found in ${options.global ? 'global' : 'local'} scope`)}`
        );
        skippedCount++;
        continue;
      }

      // Read the SKILL.md file
      const skillMdPath = `${installedSkill.canonicalPath}/SKILL.md`;
      if (!existsSync(skillMdPath)) {
        console.warn(
          `  ${pc.dim('⚠')} ${pc.yellow(skillConfig.name)} ${pc.dim('SKILL.md not found')}`
        );
        skippedCount++;
        continue;
      }

      const fileContent = await readFile(skillMdPath, 'utf-8');
      const { data, content: markdownContent } = matter(fileContent);

      // Check if any field needs to be updated
      const currentDisabled = isDisabled(data.disabled);
      const targetDisabled = skillConfig.disabled === true;
      const currentDescription = data.description || '';
      const targetDescription = skillConfig.description || '';

      let needsUpdate = false;

      // Check disabled state
      if (currentDisabled !== targetDisabled) {
        needsUpdate = true;
      }

      // Check description
      if (currentDescription !== targetDescription) {
        needsUpdate = true;
        data.description = targetDescription;
      }

      if (!needsUpdate) {
        skippedCount++;
        continue;
      }

      // Update the disabled field in frontmatter
      if (targetDisabled) {
        data.disabled = true;
      } else {
        delete data.disabled;
      }

      // Reconstruct the file with updated frontmatter
      const updatedContent = matter.stringify(markdownContent, data);

      // Write back to file
      await writeFile(skillMdPath, updatedContent, 'utf-8');
      updatedCount++;
    } catch (error) {
      errorCount++;
      console.warn(
        `  ${pc.red('✗')} Failed to update ${skillConfig.name}: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  spinner.stop('Configuration applied');

  console.log();
  if (updatedCount > 0) {
    p.log.success(`Updated ${updatedCount} skill(s)`);
  }
  if (skippedCount > 0) {
    p.log.info(`${skippedCount} skill(s) skipped (no changes needed or not found)`);
    if (options.global) {
      p.log.message(`  ${pc.dim('Hint: Use "skills list -g" to see globally installed skills')}`);
    } else {
      p.log.message(`  ${pc.dim('Hint: Use "skills list" to see locally installed skills')}`);
    }
  }
  if (errorCount > 0) {
    p.log.warn(`${errorCount} skill(s) had errors`);
  }

  track({
    event: 'batch-update-config',
    skillCount: String(skills.length),
    enabledCount: String(enabledSkills.length),
    disabledCount: String(disabledSkills.length),
    global: String(options.global ?? false),
  });

  console.log();
  p.outro(pc.green('Batch update complete!'));
}

// ==================== Export Functions ====================

/**
 * Main function for batch export
 * Supports: -o, --output, -g, --global, --with, -w
 */
export async function runBatchExport(args: string[]): Promise<void> {
  const outputIndex = args.findIndex((arg) => arg === '-o' || arg === '--output');
  const output = outputIndex !== -1 ? args[outputIndex + 1] : undefined;

  const global = args.includes('-g') || args.includes('--global');

  // Parse extra fields argument: --with tags,triggers or -w tags
  const withIndex = args.findIndex((arg) => arg === '--with' || arg === '-w');
  let extraFields: string[] | undefined;
  if (withIndex !== -1 && withIndex + 1 < args.length) {
    const withValue = args[withIndex + 1];
    if (withValue && !withValue.startsWith('-')) {
      extraFields = withValue
        .split(',')
        .map((f) => f.trim())
        .filter(Boolean);
    }
  }

  await exportSkills({ output, global, extraFields });
}

/**
 * Main function for batch update
 * Supports: -g, --global, -y, --yes, --dry-run
 */
export async function runBatchUpdate(args: string[]): Promise<void> {
  const global = args.includes('-g') || args.includes('--global');

  // Parse config path (remove flags)
  const nonFlagArgs = args.filter((arg) => !arg.startsWith('-'));
  const configPath = nonFlagArgs[0] || './skills-config.yml';

  const options = {
    yes: args.includes('-y') || args.includes('--yes'),
    dryRun: args.includes('--dry-run'),
    global,
  };

  await updateSkillsFromConfig(configPath, options);
}
