import pc from 'picocolors';

export type SkillStatus = 'active' | 'deprecated' | 'yanked';

export interface DeprecationInfo {
  since?: string;
  reason: string;
  replacement?: string;
  sunset?: string;
}

export interface YankInfo {
  since?: string;
  reason: string;
  advisory?: string;
}

export interface SkillLifecycle {
  status: SkillStatus;
  deprecated?: DeprecationInfo;
  yanked?: YankInfo;
}

/**
 * Parse lifecycle state from SKILL.md frontmatter.
 * Skills without a `status` field default to `active`.
 */
export function parseLifecycle(frontmatter: Record<string, unknown>): SkillLifecycle {
  const status = parseStatus(frontmatter.status);

  if (status === 'yanked') {
    return {
      status: 'yanked',
      yanked: parseYankInfo(frontmatter.yanked),
    };
  }

  if (status === 'deprecated') {
    return {
      status: 'deprecated',
      deprecated: parseDeprecationInfo(frontmatter.deprecated),
    };
  }

  // Check for deprecated/yanked objects even without explicit status
  if (frontmatter.yanked && typeof frontmatter.yanked === 'object') {
    return {
      status: 'yanked',
      yanked: parseYankInfo(frontmatter.yanked),
    };
  }

  if (frontmatter.deprecated && typeof frontmatter.deprecated === 'object') {
    return {
      status: 'deprecated',
      deprecated: parseDeprecationInfo(frontmatter.deprecated),
    };
  }

  // Simple boolean/string shorthand
  if (frontmatter.deprecated === true || frontmatter.deprecated === 'true') {
    return {
      status: 'deprecated',
      deprecated: { reason: 'This skill has been deprecated' },
    };
  }

  if (frontmatter.yanked === true || frontmatter.yanked === 'true') {
    return {
      status: 'yanked',
      yanked: { reason: 'This skill has been yanked' },
    };
  }

  return { status: 'active' };
}

function parseStatus(value: unknown): SkillStatus {
  if (typeof value === 'string') {
    const lower = value.toLowerCase();
    if (lower === 'deprecated') return 'deprecated';
    if (lower === 'yanked') return 'yanked';
    if (lower === 'active') return 'active';
  }
  return 'active';
}

function parseDeprecationInfo(value: unknown): DeprecationInfo {
  if (typeof value === 'object' && value !== null) {
    const obj = value as Record<string, unknown>;
    return {
      since: typeof obj.since === 'string' ? obj.since : undefined,
      reason: typeof obj.reason === 'string' ? obj.reason : 'This skill has been deprecated',
      replacement: typeof obj.replacement === 'string' ? obj.replacement : undefined,
      sunset: typeof obj.sunset === 'string' ? obj.sunset : undefined,
    };
  }
  return { reason: 'This skill has been deprecated' };
}

function parseYankInfo(value: unknown): YankInfo {
  if (typeof value === 'object' && value !== null) {
    const obj = value as Record<string, unknown>;
    return {
      since: typeof obj.since === 'string' ? obj.since : undefined,
      reason: typeof obj.reason === 'string' ? obj.reason : 'This skill has been yanked',
      advisory: typeof obj.advisory === 'string' ? obj.advisory : undefined,
    };
  }
  return { reason: 'This skill has been yanked' };
}

/**
 * Format a deprecation warning for display.
 */
export function formatDeprecationWarning(info: DeprecationInfo, skillName: string): string {
  const lines: string[] = [];
  lines.push(pc.yellow(`⚠ ${skillName} is deprecated`));
  lines.push(`  ${pc.dim('Reason:')} ${info.reason}`);
  if (info.replacement) {
    lines.push(`  ${pc.dim('Replacement:')} ${pc.cyan(`npx skills add ${info.replacement}`)}`);
  }
  if (info.sunset) {
    lines.push(`  ${pc.dim('Sunset:')} ${info.sunset}`);
  }
  return lines.join('\n');
}

/**
 * Format a yank warning for display.
 */
export function formatYankWarning(info: YankInfo, skillName: string): string {
  const lines: string[] = [];
  lines.push(pc.red(`✗ ${skillName} has been yanked`));
  lines.push(`  ${pc.dim('Reason:')} ${info.reason}`);
  if (info.advisory) {
    lines.push(`  ${pc.dim('Advisory:')} ${pc.cyan(info.advisory)}`);
  }
  return lines.join('\n');
}

/**
 * Format lifecycle annotation for list display (compact single-line).
 */
export function formatLifecycleAnnotation(lifecycle: SkillLifecycle): string | null {
  if (lifecycle.status === 'deprecated' && lifecycle.deprecated) {
    const parts = [pc.yellow('[deprecated]')];
    if (lifecycle.deprecated.replacement) {
      parts.push(`Use ${lifecycle.deprecated.replacement} instead`);
    }
    if (lifecycle.deprecated.sunset) {
      parts.push(`(sunset: ${lifecycle.deprecated.sunset})`);
    }
    return parts.join(' ');
  }

  if (lifecycle.status === 'yanked' && lifecycle.yanked) {
    return `${pc.red('[yanked]')} ${lifecycle.yanked.reason}`;
  }

  return null;
}
