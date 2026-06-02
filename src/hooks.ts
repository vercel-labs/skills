import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { agents } from './agents.ts';
import type { AgentType, HookSchema } from './types.ts';

export type { HookSchema };

export interface HookWiringOptions {
  skillName: string;
  /** Stable identity key for dedup/removal — typically "owner/repo/skillName" for GitHub sources,
   *  or just "skillName" for local/URL installs. Embedded in the hook command at wire time. */
  skillRef: string;
  agent: AgentType;
  home?: string;
}

// Read hook command templates from env vars at call time (not module load time)
// so that callers can override them in tests or via wrapper injection.
function getHookStartCmd(): string | null {
  const raw = process.env['SKILLS_HOOK_START_CMD'];
  return raw && raw.trim() ? raw.trim() : null;
}

function getHookStopCmd(): string | null {
  const raw = process.env['SKILLS_HOOK_STOP_CMD'];
  return raw && raw.trim() ? raw.trim() : null;
}

function getHookFailCmd(): string | null {
  const raw = process.env['SKILLS_HOOK_FAIL_CMD'];
  return raw && raw.trim() ? raw.trim() : null;
}

/**
 * Wire the global stop (and optional fail) hooks for a detected agent.
 * Called once by `skills setup`. Returns true if any change was made.
 */
export async function wireStopHook(
  agentName: AgentType,
  options?: { home?: string }
): Promise<boolean> {
  const config = agents[agentName];
  if (!config.hooksFile || !config.stopEvent || !config.hookSchema) return false;

  const stopCmd = getHookStopCmd();
  if (!stopCmd) return false;

  const home = options?.home ?? homedir();
  const hooksPath = join(home, config.hooksFile);
  const schema = config.hookSchema;

  let changed = false;

  if (writeEventHook(hooksPath, schema, config.stopEvent, stopCmd)) changed = true;

  const failCmd = getHookFailCmd();
  if (failCmd && config.failEvent) {
    if (writeEventHook(hooksPath, schema, config.failEvent, failCmd)) changed = true;
  }

  return changed;
}

/**
 * Wire a per-skill UserPromptSubmit hook for the given agent.
 * Called by `skills add` after installation. Returns true if a change was made.
 */
export async function wireUserPromptHook(options: HookWiringOptions): Promise<boolean> {
  const { skillName, skillRef, agent: agentName } = options;
  const config = agents[agentName];
  if (!config.hooksFile || !config.promptEvent || !config.hookSchema) return false;

  const startCmdTemplate = getHookStartCmd();
  if (!startCmdTemplate) return false;
  if (!startCmdTemplate.includes('{{skill_name}}')) return false;

  const home = options.home ?? homedir();
  const hooksPath = join(home, config.hooksFile);

  const startCmd = startCmdTemplate
    .replaceAll('{{skill_ref}}', skillRef)
    .replaceAll('{{skill_name}}', skillName)
    .replaceAll('{{agent}}', config.name);

  return writePromptHook(hooksPath, config.hookSchema, config.promptEvent, startCmd, skillRef);
}

/**
 * Remove the per-skill UserPromptSubmit hook for the given agent.
 * Called by `skills remove`. Returns true if an entry was removed.
 */
export async function removeUserPromptHook(
  options: Pick<HookWiringOptions, 'skillRef' | 'agent' | 'home'>
): Promise<boolean> {
  const { skillRef, agent: agentName } = options;
  const config = agents[agentName];
  if (!config.hooksFile || !config.promptEvent || !config.hookSchema) return false;

  const home = options.home ?? homedir();
  const hooksPath = join(home, config.hooksFile);

  if (!existsSync(hooksPath)) return false;

  let settings: Record<string, unknown>;
  try {
    settings = JSON.parse(readFileSync(hooksPath, 'utf-8'));
  } catch {
    return false;
  }

  const hooks = settings['hooks'] as Record<string, unknown> | undefined;
  if (!hooks) return false;

  const needle = skillRef;
  const promptHooks = hooks[config.promptEvent];
  if (!Array.isArray(promptHooks)) return false;

  const filtered = promptHooks.filter(
    (entry) => !entryContainsCommand(entry, needle, config.hookSchema!)
  );

  if (filtered.length === promptHooks.length) return false;

  hooks[config.promptEvent] = filtered;
  settings['hooks'] = hooks;
  writeJSON(hooksPath, settings);
  return true;
}

/**
 * Returns true if the global stop hook is already wired for at least one detected agent.
 */
export function isHookSetupDone(home?: string): boolean {
  const stopCmd = getHookStopCmd();
  if (!stopCmd) return false;

  const resolvedHome = home ?? homedir();
  for (const config of Object.values(agents)) {
    if (!config.hooksFile) continue;
    const hooksPath = join(resolvedHome, config.hooksFile);
    try {
      const content = readFileSync(hooksPath, 'utf-8');
      if (content.includes(stopCmd)) return true;
    } catch {
      // file doesn't exist — skip
    }
  }
  return false;
}

// ─── Private helpers ───────────────────────────────────────────────────────

function readSettings(hooksPath: string, schema: HookSchema): Record<string, unknown> {
  const base: Record<string, unknown> = schema === 'flat' ? { version: 1 } : {};
  try {
    const parsed = JSON.parse(readFileSync(hooksPath, 'utf-8')) as Record<string, unknown>;
    if (schema === 'flat' && parsed['version'] === undefined) {
      parsed['version'] = 1;
    }
    return parsed;
  } catch {
    return base;
  }
}

function writeJSON(hooksPath: string, settings: Record<string, unknown>): void {
  mkdirSync(dirname(hooksPath), { recursive: true });
  writeFileSync(hooksPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
}

function getOrCreateHooks(settings: Record<string, unknown>): Record<string, unknown> {
  if (
    typeof settings['hooks'] !== 'object' ||
    settings['hooks'] === null ||
    Array.isArray(settings['hooks'])
  ) {
    settings['hooks'] = {};
  }
  return settings['hooks'] as Record<string, unknown>;
}

function getEventEntries(hooks: Record<string, unknown>, event: string): unknown[] {
  if (!Array.isArray(hooks[event])) hooks[event] = [];
  return hooks[event] as unknown[];
}

function nestedEntry(command: string): Record<string, unknown> {
  return {
    hooks: [{ type: 'command', command, timeout: 5 }],
  };
}

function flatEntry(command: string): Record<string, unknown> {
  return { type: 'command', command, timeout: 5 };
}

function writeEventHook(
  hooksPath: string,
  schema: HookSchema,
  event: string,
  command: string
): boolean {
  const settings = readSettings(hooksPath, schema);
  const hooks = getOrCreateHooks(settings);
  const entries = getEventEntries(hooks, event);

  if (schema === 'flat') {
    if (entries.some((e) => (e as Record<string, unknown>)['command'] === command)) return false;
    entries.push(flatEntry(command));
  } else {
    if (entries.some((e) => commandInNestedEntry(e, command))) return false;
    entries.push(nestedEntry(command));
  }

  hooks[event] = entries;
  settings['hooks'] = hooks;
  writeJSON(hooksPath, settings);
  return true;
}

function writePromptHook(
  hooksPath: string,
  schema: HookSchema,
  event: string,
  command: string,
  skillRef: string
): boolean {
  const settings = readSettings(hooksPath, schema);
  const hooks = getOrCreateHooks(settings);
  const entries = getEventEntries(hooks, event);

  const needle = skillRef;
  const others = entries.filter((e) => !entryContainsCommand(e, needle, schema));

  // If there's an existing entry for this skill that already has the right command, no-op.
  if (others.length < entries.length) {
    const existing = entries.find((e) => entryContainsCommand(e, needle, schema));
    if (existing) {
      const existingCmd =
        schema === 'flat'
          ? (existing as Record<string, unknown>)['command']
          : getNestedCommand(existing);
      if (existingCmd === command) return false;
    }
  }

  const newEntry = schema === 'flat' ? flatEntry(command) : nestedEntry(command);
  hooks[event] = [...others, newEntry];
  settings['hooks'] = hooks;
  writeJSON(hooksPath, settings);
  return true;
}

function entryContainsCommand(entry: unknown, needle: string, schema: HookSchema): boolean {
  if (typeof entry !== 'object' || entry === null) return false;
  const m = entry as Record<string, unknown>;
  // Anchor on --skill-ref <value> so a short ref like "foo" doesn't substring-match "foobar"
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`--skill-ref\\s+${escaped}(?:\\s|$)`);
  if (schema === 'flat') {
    return typeof m['command'] === 'string' && pattern.test(m['command']);
  }
  const inner = m['hooks'];
  if (!Array.isArray(inner)) return false;
  return inner.some(
    (h) =>
      typeof h === 'object' &&
      h !== null &&
      typeof (h as Record<string, unknown>)['command'] === 'string' &&
      pattern.test((h as Record<string, unknown>)['command'] as string)
  );
}

function commandInNestedEntry(entry: unknown, command: string): boolean {
  if (typeof entry !== 'object' || entry === null) return false;
  const inner = (entry as Record<string, unknown>)['hooks'];
  if (!Array.isArray(inner)) return false;
  return inner.some(
    (h) =>
      typeof h === 'object' && h !== null && (h as Record<string, unknown>)['command'] === command
  );
}

function getNestedCommand(entry: unknown): string | undefined {
  if (typeof entry !== 'object' || entry === null) return undefined;
  const inner = (entry as Record<string, unknown>)['hooks'];
  if (!Array.isArray(inner) || inner.length === 0) return undefined;
  const first = inner[0];
  if (typeof first !== 'object' || first === null) return undefined;
  const cmd = (first as Record<string, unknown>)['command'];
  return typeof cmd === 'string' ? cmd : undefined;
}

// ─── repairHooks ───────────────────────────────────────────────────────────

export interface RepairHooksResult {
  wired: number;
  removed: number;
  agentsRepaired: string[];
}

/**
 * Reconcile agent hook config files against installed skills.
 *
 * Wire missing: for each installed skill, ensure all hook-capable detected
 * agents have a prompt hook entry for it. Delegates to wireUserPromptHook so
 * template expansion and env-var guards are handled in one place.
 *
 * Remove orphaned: for each hook-capable agent's promptEvent entries, extract
 * the embedded --skill-ref token and remove entries whose ref is no longer
 * in any installed lock. This runs regardless of SKILLS_HOOK_START_CMD.
 *
 * Rebuilds hookRefs in the global lock from scratch so future `skills remove`
 * calls have accurate ref counts.
 *
 * The set of "installed" skillRefs is derived from the global lock (global
 * installs) and any skills-lock.json files found in the provided project paths.
 */
export async function repairHooks(options?: {
  home?: string;
  projectPaths?: string[];
}): Promise<RepairHooksResult> {
  const home = options?.home ?? homedir();
  const projectPaths = options?.projectPaths ?? [];

  const { readSkillLock, writeSkillLock } = await import('./skill-lock.ts');
  const { readLocalLock } = await import('./local-lock.ts');

  // Read the global lock once — reused both for populating installedRefs and
  // for the hookRefs rebuild at the end, avoiding a TOCTOU double-read.
  const globalLock = await readSkillLock();

  // Collect installed skillRefs, tracking scope so we can rebuild hookRefs.
  const installedRefs = new Set<string>();
  const installedSkillsByRef = new Map<string, { skillName: string }>();
  const globalRefs = new Set<string>();
  const projectRefsByPath = new Map<string, Set<string>>();

  for (const [skillName, entry] of Object.entries(globalLock.skills)) {
    const ref = entry.skillRef ?? skillName;
    installedRefs.add(ref);
    installedSkillsByRef.set(ref, { skillName });
    globalRefs.add(ref);
  }

  for (const projectPath of projectPaths) {
    try {
      const localLock = await readLocalLock(projectPath);
      const refsHere = new Set<string>();
      for (const [skillName, entry] of Object.entries(localLock.skills)) {
        const ref = entry.skillRef ?? skillName;
        installedRefs.add(ref);
        installedSkillsByRef.set(ref, { skillName });
        refsHere.add(ref);
      }
      projectRefsByPath.set(projectPath, refsHere);
    } catch {
      // best-effort
    }
  }

  const hookableAgents = (Object.keys(agents) as AgentType[]).filter(
    (a) => agents[a].hooksFile && agents[a].promptEvent && agents[a].hookSchema
  );

  let wired = 0;
  let removed = 0;
  const repairedSet = new Set<string>();

  for (const agentName of hookableAgents) {
    const config = agents[agentName];
    const hooksPath = join(home, config.hooksFile!);
    const configDirRoot = join(home, config.hooksFile!.split('/')[0]!);

    if (!existsSync(configDirRoot)) continue;

    // ── Wire missing ──────────────────────────────────────────────────────
    // Delegate to wireUserPromptHook — it handles SKILLS_HOOK_START_CMD checks
    // and token expansion, keeping that logic in one place.
    for (const [skillRef, { skillName }] of installedSkillsByRef) {
      const changed = await wireUserPromptHook({ skillName, skillRef, agent: agentName, home });
      if (changed) {
        wired++;
        repairedSet.add(config.displayName);
      }
    }

    // ── Remove orphaned ───────────────────────────────────────────────────
    if (!existsSync(hooksPath)) continue;

    let settings: Record<string, unknown>;
    try {
      settings = JSON.parse(readFileSync(hooksPath, 'utf-8'));
    } catch {
      continue;
    }

    const hooks = settings['hooks'] as Record<string, unknown> | undefined;
    if (!hooks) continue;

    const promptHooks = hooks[config.promptEvent!];
    if (!Array.isArray(promptHooks)) continue;

    const before = promptHooks.length;
    const filtered = promptHooks.filter((entry) => {
      const cmd =
        config.hookSchema === 'flat'
          ? (entry as Record<string, unknown>)['command']
          : getNestedCommand(entry);
      if (typeof cmd !== 'string') return true; // keep entries we can't parse

      const m = cmd.match(/--skill-ref\s+(\S+)/);
      if (!m) return true; // not one of ours — keep it

      return installedRefs.has(m[1]!);
    });

    if (filtered.length < before) {
      hooks[config.promptEvent!] = filtered;
      settings['hooks'] = hooks;
      writeJSON(hooksPath, settings);
      removed += before - filtered.length;
      repairedSet.add(config.displayName);
    }
  }

  // Rebuild hookRefs from scratch to match installed reality so that future
  // `skills remove` calls have accurate ref counts. Reuse the lock object
  // already in memory rather than re-reading from disk.
  globalLock.hookRefs = {};
  for (const ref of globalRefs) {
    globalLock.hookRefs[ref] = { globalInstall: true, projectPaths: [] };
  }
  for (const [projectPath, refs] of projectRefsByPath) {
    for (const ref of refs) {
      const existing = globalLock.hookRefs[ref];
      if (existing) {
        existing.projectPaths.push(projectPath);
      } else {
        globalLock.hookRefs[ref] = { globalInstall: false, projectPaths: [projectPath] };
      }
    }
  }
  await writeSkillLock(globalLock);

  return { wired, removed, agentsRepaired: Array.from(repairedSet) };
}

/**
 * Scan a directory for project directories that contain a skills-lock.json.
 * Useful for callers who want to include local installs in repairHooks.
 */
export function findProjectsWithLocalLock(searchPaths: string[]): string[] {
  const found: string[] = [];
  for (const base of searchPaths) {
    if (!existsSync(base)) continue;
    try {
      for (const entry of readdirSync(base, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const candidate = join(base, entry.name, 'skills-lock.json');
        if (existsSync(candidate)) found.push(join(base, entry.name));
      }
    } catch {
      // skip
    }
  }
  return found;
}
