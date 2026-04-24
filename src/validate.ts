import { readFile, readdir, stat } from 'fs/promises';
import { join, relative, basename } from 'path';
import matter from 'gray-matter';
import pc from 'picocolors';
import { agents } from './agents.ts';

type Severity = 'error' | 'warning' | 'info';

interface ValidationResult {
  field: string;
  severity: Severity;
  message: string;
  suggestion?: string;
}

interface ValidationReport {
  skillName: string;
  skillPath: string;
  results: ValidationResult[];
  errors: number;
  warnings: number;
}

const COMMON_SPDX = new Set([
  'MIT',
  'Apache-2.0',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'GPL-2.0',
  'GPL-3.0',
  'LGPL-2.1',
  'LGPL-3.0',
  'MPL-2.0',
  'Unlicense',
  'CC-BY-4.0',
  'CC-BY-SA-4.0',
  'CC0-1.0',
  'AGPL-3.0',
  'BSL-1.0',
  'Artistic-2.0',
]);

const VALID_AGENT_NAMES = new Set(Object.values(agents).map((a) => a.displayName));

/**
 * Validate a license string against common SPDX identifiers.
 * Supports OR expressions like "MIT OR Apache-2.0".
 */
export function isValidSPDX(license: string): boolean {
  const parts = license.split(/\s+OR\s+/);
  return parts.every((part) => COMMON_SPDX.has(part.trim()));
}

/**
 * Validate a single SKILL.md file's frontmatter.
 */
export function validateFrontmatter(
  data: Record<string, unknown>,
  content: string
): ValidationResult[] {
  const results: ValidationResult[] = [];

  // Required: name
  if (!data.name) {
    results.push({ field: 'name', severity: 'error', message: 'missing (required)' });
  } else if (typeof data.name !== 'string') {
    results.push({ field: 'name', severity: 'error', message: 'must be a string' });
  } else {
    if (data.name.length < 1 || data.name.length > 64) {
      results.push({
        field: 'name',
        severity: 'error',
        message: `length ${data.name.length} chars (must be 1-64)`,
      });
    }
    if (!/^[a-z0-9][a-z0-9._-]*[a-z0-9]$|^[a-z0-9]$/.test(data.name)) {
      results.push({
        field: 'name',
        severity: 'warning',
        message: 'should be kebab-case (lowercase, hyphens, dots, underscores)',
        suggestion: data.name
          .toLowerCase()
          .replace(/[^a-z0-9._]+/g, '-')
          .replace(/^-|-$/g, ''),
      });
    }
  }

  // Required: description
  if (!data.description) {
    results.push({ field: 'description', severity: 'error', message: 'missing (required)' });
  } else if (typeof data.description !== 'string') {
    results.push({ field: 'description', severity: 'error', message: 'must be a string' });
  } else {
    if (data.description.length < 20) {
      results.push({
        field: 'description',
        severity: 'error',
        message: `too short (${data.description.length} chars, minimum 20)`,
      });
    }
    if (data.description.length > 500) {
      results.push({
        field: 'description',
        severity: 'warning',
        message: `very long (${data.description.length} chars, recommended max 500)`,
      });
    }
  }

  // Recommended: author
  if (!data.author) {
    results.push({
      field: 'author',
      severity: 'warning',
      message: 'missing (who maintains this skill?)',
    });
  } else if (typeof data.author !== 'string' || data.author.trim() === '') {
    results.push({ field: 'author', severity: 'warning', message: 'should be a non-empty string' });
  }

  // Recommended: license
  if (!data.license) {
    results.push({
      field: 'license',
      severity: 'warning',
      message: 'missing (what are the usage terms?)',
    });
  } else if (typeof data.license === 'string') {
    if (!isValidSPDX(data.license)) {
      results.push({
        field: 'license',
        severity: 'info',
        message: `"${data.license}" is not a recognized SPDX identifier`,
        suggestion: 'Common licenses: MIT, Apache-2.0, ISC, GPL-3.0, CC-BY-4.0',
      });
    }
  }

  // Recommended: repository
  if (!data.repository) {
    results.push({
      field: 'repository',
      severity: 'warning',
      message: 'missing (where is the source code?)',
    });
  } else if (typeof data.repository === 'string') {
    try {
      new URL(data.repository);
    } catch {
      results.push({
        field: 'repository',
        severity: 'warning',
        message: 'should be a valid URL',
      });
    }
  }

  // Optional: keywords
  if (!data.keywords) {
    results.push({
      field: 'keywords',
      severity: 'info',
      message: 'missing (helps with discovery)',
    });
  } else if (!Array.isArray(data.keywords)) {
    results.push({ field: 'keywords', severity: 'info', message: 'should be an array of strings' });
  }

  // Conditional: product-version
  if (data['product-version'] !== undefined) {
    if (typeof data['product-version'] !== 'string') {
      results.push({
        field: 'product-version',
        severity: 'warning',
        message: 'should be a string (e.g., ">=18.0.0")',
      });
    }
  }

  // Conditional: agents
  if (data.agents !== undefined) {
    if (!Array.isArray(data.agents)) {
      results.push({
        field: 'agents',
        severity: 'warning',
        message: 'should be an array of strings',
      });
    } else {
      for (const agent of data.agents) {
        if (typeof agent !== 'string') {
          results.push({
            field: 'agents',
            severity: 'warning',
            message: `invalid agent entry: ${agent}`,
          });
        } else if (!VALID_AGENT_NAMES.has(agent) && agent !== '*') {
          results.push({
            field: 'agents',
            severity: 'info',
            message: `"${agent}" is not a recognized agent name`,
          });
        }
      }
    }
  }

  // Body content check
  const bodyContent = content.replace(/^---[\s\S]*?---/, '').trim();
  if (bodyContent.length < 50) {
    results.push({
      field: 'body',
      severity: 'info',
      message: 'skill body is very short (consider adding more instructions)',
    });
  }

  return results;
}

/**
 * Find all SKILL.md files in a directory tree.
 */
async function findSkillFiles(dir: string, maxDepth = 5, depth = 0): Promise<string[]> {
  if (depth > maxDepth) return [];

  const results: string[] = [];

  try {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.name === 'SKILL.md' && entry.isFile()) {
        results.push(join(dir, entry.name));
      } else if (entry.isDirectory() && !['node_modules', '.git', '.agents'].includes(entry.name)) {
        const subResults = await findSkillFiles(join(dir, entry.name), maxDepth, depth + 1);
        results.push(...subResults);
      }
    }
  } catch {
    // Directory not readable
  }

  return results;
}

/**
 * Validate a single SKILL.md file and return a report.
 */
async function validateSkillFile(skillMdPath: string, cwd: string): Promise<ValidationReport> {
  const content = await readFile(skillMdPath, 'utf-8');
  const { data } = matter(content);
  const skillName =
    (typeof data.name === 'string' && data.name) || basename(join(skillMdPath, '..'));

  const results = validateFrontmatter(data, content);
  const errors = results.filter((r) => r.severity === 'error').length;
  const warnings = results.filter((r) => r.severity === 'warning').length;

  return {
    skillName,
    skillPath: relative(cwd, skillMdPath) || skillMdPath,
    results,
    errors,
    warnings,
  };
}

interface ValidateOptions {
  strict?: boolean;
}

function parseValidateOptions(args: string[]): { paths: string[]; options: ValidateOptions } {
  const options: ValidateOptions = {};
  const paths: string[] = [];

  for (const arg of args) {
    if (arg === '--strict') {
      options.strict = true;
    } else if (!arg.startsWith('-')) {
      paths.push(arg);
    }
  }

  return { paths, options };
}

/**
 * Run the `skills validate` command.
 */
export async function runValidate(args: string[]): Promise<void> {
  const { paths, options } = parseValidateOptions(args);
  const cwd = process.cwd();

  console.log();
  console.log(pc.bold('Validating skills...'));
  console.log();

  // Find SKILL.md files
  let skillFiles: string[] = [];

  if (paths.length > 0) {
    for (const p of paths) {
      const fullPath = join(cwd, p);
      try {
        const s = await stat(fullPath);
        if (s.isFile() && p.endsWith('SKILL.md')) {
          skillFiles.push(fullPath);
        } else if (s.isDirectory()) {
          const found = await findSkillFiles(fullPath);
          skillFiles.push(...found);
        }
      } catch {
        console.log(pc.red(`  Path not found: ${p}`));
      }
    }
  } else {
    skillFiles = await findSkillFiles(cwd);
  }

  if (skillFiles.length === 0) {
    console.log(pc.dim('No SKILL.md files found.'));
    console.log(pc.dim(`Create one with ${pc.cyan('npx skills init')}`));
    return;
  }

  // Validate each file
  const reports: ValidationReport[] = [];
  let totalErrors = 0;
  let totalWarnings = 0;

  for (const file of skillFiles) {
    try {
      const report = await validateSkillFile(file, cwd);
      reports.push(report);
      totalErrors += report.errors;
      totalWarnings += report.warnings;
    } catch (error) {
      console.log(
        pc.red(
          `  Failed to validate ${relative(cwd, file)}: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      );
    }
  }

  // Display results
  const severityColors: Record<Severity, (s: string) => string> = {
    error: pc.red,
    warning: pc.yellow,
    info: pc.dim,
  };

  for (const report of reports) {
    console.log(`${pc.bold(report.skillName)} ${pc.dim(`(${report.skillPath})`)}`);

    if (report.results.length === 0) {
      console.log(`  ${pc.green('[pass]')}    All checks passed`);
    } else {
      for (const result of report.results) {
        const color = severityColors[result.severity];
        const tag = `[${result.severity}]`.padEnd(10);
        console.log(`  ${color(tag)} ${result.field}: ${result.message}`);
        if (result.suggestion) {
          console.log(`  ${' '.repeat(10)} ${pc.dim(`suggestion: ${result.suggestion}`)}`);
        }
      }
    }
    console.log();
  }

  // Summary
  const parts: string[] = [];
  if (totalErrors > 0) parts.push(pc.red(`${totalErrors} error${totalErrors !== 1 ? 's' : ''}`));
  if (totalWarnings > 0)
    parts.push(pc.yellow(`${totalWarnings} warning${totalWarnings !== 1 ? 's' : ''}`));

  if (parts.length > 0) {
    console.log(
      `Results: ${parts.join(', ')} across ${reports.length} skill${reports.length !== 1 ? 's' : ''}`
    );
  } else {
    console.log(
      pc.green(`All ${reports.length} skill${reports.length !== 1 ? 's' : ''} passed validation`)
    );
  }
  console.log();

  // Exit code
  if (totalErrors > 0) {
    process.exit(1);
  }
  if (options.strict && totalWarnings > 0) {
    process.exit(1);
  }
}
