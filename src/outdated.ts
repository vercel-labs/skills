import {
  checkGlobalSkillUpdates,
  getProjectSkillsForUpdate,
  resolveUpdateScope,
  type GlobalCheckResult,
  type SkippedSkill,
  type UpdateCheckOptions,
  type UpdateScope,
} from './updates.ts';
import { track } from './telemetry.ts';

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[38;5;102m';
const TEXT = '\x1b[38;5;145m';

// ============================================
// Flag parsing
// ============================================

interface OutdatedOptions extends UpdateCheckOptions {
  json?: boolean;
}

export function parseOutdatedOptions(args: string[]): OutdatedOptions {
  const options: OutdatedOptions = {};
  const positional: string[] = [];
  for (const arg of args) {
    if (arg === '-g' || arg === '--global') {
      options.global = true;
    } else if (arg === '-p' || arg === '--project') {
      options.project = true;
    } else if (arg === '-y' || arg === '--yes') {
      options.yes = true;
    } else if (arg === '--json') {
      options.json = true;
    } else if (!arg.startsWith('-')) {
      positional.push(arg);
    }
  }
  if (positional.length > 0) {
    options.skills = positional;
  }
  return options;
}

// ============================================
// JSON output (stable contract, schema-versioned)
// ============================================

/**
 * Per-skill outdated status. `outdated` is a tri-state:
 *   - true  — upstream hash differs from local; update available
 *   - false — upstream and local hashes match; skill is current
 *   - null  — could not determine (local path, git URL, well-known, missing
 *             metadata, fetch error); `error` explains why
 */
export interface OutdatedJsonSkill {
  name: string;
  scope: 'global' | 'project';
  source: string;
  sourceUrl: string;
  sourceType: string;
  ref: string | null;
  skillPath: string | null;
  localHash: string | null;
  upstreamHash: string | null;
  outdated: boolean | null;
  error: string | null;
}

export interface OutdatedJson {
  /** Bumped on breaking schema changes. Readers should check this field. */
  schema: 1;
  /** ISO 8601 timestamp when the scan started. */
  checkedAt: string;
  /** The scope this run covered (matches the resolved scope from -g/-p flags). */
  scope: UpdateScope;
  skills: OutdatedJsonSkill[];
  summary: {
    checked: number;
    outdated: number;
    upToDate: number;
    skipped: number;
    errored: number;
  };
}

// ============================================
// Building the JSON report
// ============================================

export function buildGlobalEntries(result: GlobalCheckResult): OutdatedJsonSkill[] {
  const entries: OutdatedJsonSkill[] = [];

  for (const c of result.checked) {
    const { name, entry, upstreamHash, error } = c;
    if (error !== null) {
      entries.push({
        name,
        scope: 'global',
        source: entry.source,
        sourceUrl: entry.sourceUrl,
        sourceType: entry.sourceType,
        ref: entry.ref ?? null,
        skillPath: entry.skillPath ?? null,
        localHash: entry.skillFolderHash,
        upstreamHash: null,
        outdated: null,
        error,
      });
      continue;
    }

    if (upstreamHash === null) {
      // Fetch succeeded but the server returned no hash (private/deleted repo)
      entries.push({
        name,
        scope: 'global',
        source: entry.source,
        sourceUrl: entry.sourceUrl,
        sourceType: entry.sourceType,
        ref: entry.ref ?? null,
        skillPath: entry.skillPath ?? null,
        localHash: entry.skillFolderHash,
        upstreamHash: null,
        outdated: null,
        error: 'No upstream hash available',
      });
      continue;
    }

    entries.push({
      name,
      scope: 'global',
      source: entry.source,
      sourceUrl: entry.sourceUrl,
      sourceType: entry.sourceType,
      ref: entry.ref ?? null,
      skillPath: entry.skillPath ?? null,
      localHash: entry.skillFolderHash,
      upstreamHash,
      outdated: upstreamHash !== entry.skillFolderHash,
      error: null,
    });
  }

  for (const s of result.skipped) {
    entries.push(buildSkippedEntry(s));
  }

  return entries;
}

function buildSkippedEntry(s: SkippedSkill): OutdatedJsonSkill {
  return {
    name: s.name,
    scope: 'global',
    source: s.sourceUrl,
    sourceUrl: s.sourceUrl,
    sourceType: s.sourceType,
    ref: s.ref ?? null,
    skillPath: null,
    localHash: null,
    upstreamHash: null,
    outdated: null,
    error: s.reason,
  };
}

async function buildProjectEntries(skillFilter?: string[]): Promise<OutdatedJsonSkill[]> {
  // Project-scope skills are always re-cloned on update; there is no
  // authoritative hash-based check primitive for them. Report them with
  // a structured reason so machine readers can surface "requires refresh"
  // affordances without guessing at string messages.
  const projectSkills = await getProjectSkillsForUpdate(skillFilter);
  const entries: OutdatedJsonSkill[] = [];

  for (const skill of projectSkills) {
    // LocalSkillLockEntry intentionally doesn't carry sourceUrl — fall
    // back to `source` (owner/repo / npm / path). The UI can reconstruct
    // a clickable URL from `sourceType` + `source` if needed.
    entries.push({
      name: skill.name,
      scope: 'project',
      source: skill.source,
      sourceUrl: skill.source,
      sourceType: skill.entry.sourceType ?? 'unknown',
      ref: skill.entry.ref ?? null,
      skillPath: null,
      localHash: skill.entry.computedHash ?? null,
      upstreamHash: null,
      outdated: null,
      error: 'Project-scope skills are refreshed on update',
    });
  }

  return entries;
}

export function summarize(skills: OutdatedJsonSkill[]): OutdatedJson['summary'] {
  let outdated = 0;
  let upToDate = 0;
  let skipped = 0;
  let errored = 0;
  for (const s of skills) {
    if (s.outdated === true) outdated++;
    else if (s.outdated === false) upToDate++;
    else if (s.localHash === null) skipped++;
    else errored++;
  }
  return {
    checked: skills.length,
    outdated,
    upToDate,
    skipped,
    errored,
  };
}

// ============================================
// Human-readable rendering
// ============================================

function printHuman(report: OutdatedJson): void {
  const outdated = report.skills.filter((s) => s.outdated === true);
  const upToDate = report.skills.filter((s) => s.outdated === false);
  const notChecked = report.skills.filter((s) => s.outdated === null);

  if (report.skills.length === 0) {
    console.log(`${DIM}No installed skills found to check.${RESET}`);
    return;
  }

  if (outdated.length > 0) {
    console.log(`${TEXT}${BOLD}${outdated.length} skill(s) with updates available${RESET}`);
    for (const s of outdated) {
      const ref = s.ref ? `#${s.ref}` : '';
      const localShort = s.localHash?.slice(0, 7) ?? '???';
      const upstreamShort = s.upstreamHash?.slice(0, 7) ?? '???';
      console.log(
        `  ${TEXT}•${RESET} ${s.name} ${DIM}(${s.source}${ref} — ${localShort} → ${upstreamShort})${RESET}`
      );
    }
    console.log();
    console.log(`${DIM}Run ${TEXT}npx skills update${DIM} to apply.${RESET}`);
  } else if (upToDate.length > 0) {
    console.log(`${TEXT}✓ All checked skills are up to date (${upToDate.length})${RESET}`);
  }

  if (notChecked.length > 0) {
    console.log();
    console.log(`${DIM}${notChecked.length} skill(s) could not be checked:${RESET}`);
    for (const s of notChecked) {
      console.log(`  ${TEXT}•${RESET} ${s.name} ${DIM}(${s.error ?? 'unknown'})${RESET}`);
    }
  }
}

// ============================================
// runOutdated entry
// ============================================

/**
 * Check installed skills for available updates without installing anything.
 *
 * Flags:
 *   -g / --global     Check only global skills
 *   -p / --project    Check only project skills
 *   -y / --yes        Skip interactive scope prompt
 *   --json            Emit machine-readable JSON to stdout (implies -y)
 *   [skill names...]  Filter to specific skills
 *
 * Exit codes:
 *   0 on successful scan (even when outdated skills or errors exist)
 *   Non-zero only on catastrophic failures (argument parse, etc.)
 */
export async function runOutdated(args: string[] = []): Promise<void> {
  const options = parseOutdatedOptions(args);

  // --json implies non-interactive
  if (options.json) {
    options.yes = true;
  }

  const scope = await resolveUpdateScope(options);
  const checkedAt = new Date().toISOString();

  const entries: OutdatedJsonSkill[] = [];

  if (scope === 'global' || scope === 'both') {
    const onProgress = options.json
      ? undefined
      : (i: number, total: number, name: string) => {
          process.stdout.write(
            `\r${DIM}Checking global skill ${i}/${total}: ${name}${RESET}\x1b[K`
          );
        };

    const result = await checkGlobalSkillUpdates(options.skills, onProgress);
    if (!options.json && result.checked.length > 0) {
      process.stdout.write('\r\x1b[K');
    }

    entries.push(...buildGlobalEntries(result));
  }

  if (scope === 'project' || scope === 'both') {
    entries.push(...(await buildProjectEntries(options.skills)));
  }

  if (options.skills && entries.length === 0) {
    if (options.json) {
      // Still emit a valid (empty) report so callers don't have to special-case.
      const report: OutdatedJson = {
        schema: 1,
        checkedAt,
        scope,
        skills: [],
        summary: { checked: 0, outdated: 0, upToDate: 0, skipped: 0, errored: 0 },
      };
      console.log(JSON.stringify(report));
      return;
    }
    console.log(`${DIM}No installed skills found matching: ${options.skills.join(', ')}${RESET}`);
    return;
  }

  const report: OutdatedJson = {
    schema: 1,
    checkedAt,
    scope,
    skills: entries,
    summary: summarize(entries),
  };

  if (options.json) {
    console.log(JSON.stringify(report));
  } else {
    printHuman(report);
  }

  track({
    event: 'outdated',
    scope,
    skillCount: String(report.summary.checked),
    outdatedCount: String(report.summary.outdated),
    erroredCount: String(report.summary.errored),
    json: options.json ? '1' : '0',
  });
}
