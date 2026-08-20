import { spawn } from 'node:child_process';
import { resolve as resolvePath } from 'node:path';
import * as readline from 'node:readline';
import { agents, detectInstalledAgents } from './agents.ts';
import {
  listInstalledSkills,
  sanitizeName,
  setInstalledSkillEnabled,
  type InstalledSkill,
} from './installer.ts';
import { readLocalLock } from './local-lock.ts';
import { renderSkillsLogo } from './logo.ts';
import { sanitizeMetadata, stripTerminalEscapes } from './sanitize.ts';
import { getAllLockedSkills } from './skill-lock.ts';
import { readTuiPreferences, writeTuiPreferences } from './tui-preferences.ts';
import {
  checkAvailableSkillUpdates,
  type AvailableSkillUpdate,
  type SkillUpdateCheckProgress,
} from './update-check.ts';
import type { AgentType } from './types.ts';

const RESET = '\x1b[0m';
// Keep the panel on the terminal's default and ANSI palette colors so it
// follows the user's active terminal theme. Do not add fixed 256/RGB colors.
const DIM = '\x1b[2m';
const TEXT = '\x1b[39m';
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const BLUE = '\x1b[34m';
const MAGENTA = '\x1b[35m';
const BRIGHT_TEXT = '\x1b[97m';
const SELECTED_BG = '\x1b[44m';
const GLOBAL_METRIC_BG = '\x1b[42m';
const ALL_SCOPE_BG = '\x1b[45m';
const BOLD = '\x1b[1m';
const INVERSE = '\x1b[7m';
const CHECKING_SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;
const UPDATE_SPINNER_FRAMES = ['◒', '◐', '◓', '◑'] as const;
const LOADING_SPINNER_DELAY_MS = 80;

function renderCheckingSpinner(frame: number): string {
  return `${MAGENTA}${BOLD}${CHECKING_SPINNER_FRAMES[frame % CHECKING_SPINNER_FRAMES.length]}${RESET}`;
}

function renderUpdateSpinner(frame: number): string {
  return `${MAGENTA}${BOLD}${UPDATE_SPINNER_FRAMES[frame % UPDATE_SPINNER_FRAMES.length]}${RESET}`;
}

const ENTER_ALT_SCREEN = '\x1b[?1049h';
const EXIT_ALT_SCREEN = '\x1b[?1049l';
const CLEAR_SCREEN = '\x1b[2J\x1b[H';
const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';

const NAV_ITEMS: Array<{ id: TuiScreen; label: string; shortcut: string; color: string }> = [
  { id: 'overview', label: 'Overview', shortcut: 'o', color: CYAN },
  { id: 'installed', label: 'Installed', shortcut: 'i', color: GREEN },
  { id: 'updates', label: 'Updates', shortcut: 'u', color: YELLOW },
  { id: 'agents', label: 'Agents', shortcut: 'a', color: BLUE },
];

export type TuiScreen = 'overview' | 'installed' | 'updates' | 'agents' | 'help';
export type TuiScope = 'project' | 'global';
export type InstalledScopeFilter = TuiScope | 'all';

export interface TuiLockEntry {
  source?: string;
  sourceUrl?: string;
  sourceType?: string;
  ref?: string;
  skillPath?: string;
  skillFolderHash?: string;
  computedHash?: string;
  scope?: TuiScope;
}

export interface TuiState {
  screen: TuiScreen;
  installed: InstalledSkill[];
  installedScopeFilter: InstalledScopeFilter;
  installedAgentFilter: AgentType | null;
  agentFilterMenuOpen: boolean;
  agentFilterMenuIndex: number;
  detectedAgents: AgentType[];
  lockEntries: Record<string, TuiLockEntry>;
  installedIndex: number;
  availableUpdates: AvailableSkillUpdate[];
  updateIndex: number;
  loading: string | null;
  loadingFrame: number;
  updatingSkills: Array<{ name: string; scope: TuiScope }>;
  updateProgress: SkillUpdateCheckProgress | null;
  updateSummary: {
    checkedCount: number;
    totalCount: number;
    failedCount: number;
    skippedCount: number;
  } | null;
  removeConfirmation: { name: string; scope: TuiScope } | null;
  message: string | null;
  error: string | null;
}

export interface TuiSize {
  columns: number;
  rows: number;
}

export function createTuiState(): TuiState {
  return {
    screen: 'overview',
    installed: [],
    installedScopeFilter: 'all',
    installedAgentFilter: null,
    agentFilterMenuOpen: false,
    agentFilterMenuIndex: 0,
    detectedAgents: [],
    lockEntries: {},
    installedIndex: 0,
    availableUpdates: [],
    updateIndex: 0,
    loading: null,
    loadingFrame: 0,
    updatingSkills: [],
    updateProgress: null,
    updateSummary: null,
    removeConfirmation: null,
    message: null,
    error: null,
  };
}

export async function refreshTuiState(state: TuiState): Promise<TuiState> {
  const [installed, detectedAgents, globalLock, localLock] = await Promise.all([
    listInstalledSkills(),
    detectInstalledAgents(),
    getAllLockedSkills(),
    readLocalLock(),
  ]);

  state.installed = installed;
  state.detectedAgents = detectedAgents;
  state.lockEntries = Object.fromEntries([
    ...Object.entries(localLock.skills).map(
      ([name, entry]) => [`project:${name}`, { ...entry, scope: 'project' as const }] as const
    ),
    ...Object.entries(globalLock).map(
      ([name, entry]) => [`global:${name}`, { ...entry, scope: 'global' as const }] as const
    ),
  ]);
  clampIndexes(state);
  return state;
}

function clampIndexes(state: TuiState): void {
  const installed = getInstalledViewSkills(state);
  state.installedIndex = Math.max(0, Math.min(state.installedIndex, installed.length - 1));
  state.updateIndex = Math.max(0, Math.min(state.updateIndex, state.availableUpdates.length - 1));
}

function getInstalledViewSkills(state: TuiState): InstalledSkill[] {
  return state.installed.filter(
    (skill) =>
      (state.installedScopeFilter === 'all' || skill.scope === state.installedScopeFilter) &&
      (!state.installedAgentFilter || skill.agents.includes(state.installedAgentFilter))
  );
}

export function cycleInstalledScopeFilter(state: TuiState): InstalledScopeFilter {
  const scopes: InstalledScopeFilter[] = ['all', 'project', 'global'];
  const currentIndex = scopes.indexOf(state.installedScopeFilter);
  state.installedScopeFilter = scopes[(currentIndex + 1) % scopes.length]!;
  state.installedIndex = 0;
  clampIndexes(state);
  return state.installedScopeFilter;
}

interface AgentFilterOption {
  agent: AgentType | null;
  label: string;
}

function getDetectedAgentFilterOptions(state: TuiState): AgentFilterOption[] {
  const detected = Array.from(new Set(state.detectedAgents)).sort((a, b) =>
    (agents[a]?.displayName || a).localeCompare(agents[b]?.displayName || b)
  );

  return [
    { agent: null, label: 'All agents' },
    ...detected.map((agent) => ({ agent, label: agents[agent]?.displayName || agent })),
  ];
}

export function openAgentFilterMenu(state: TuiState): void {
  const options = getDetectedAgentFilterOptions(state);
  const currentIndex = options.findIndex((option) => option.agent === state.installedAgentFilter);
  state.agentFilterMenuIndex = Math.max(0, currentIndex);
  state.agentFilterMenuOpen = true;
}

export function moveAgentFilterMenu(state: TuiState, direction: 1 | -1): void {
  const count = getDetectedAgentFilterOptions(state).length;
  state.agentFilterMenuIndex =
    (state.agentFilterMenuIndex + direction + count) % Math.max(1, count);
}

export function applyAgentFilterMenuSelection(state: TuiState): AgentType | null {
  const options = getDetectedAgentFilterOptions(state);
  const selected = options[state.agentFilterMenuIndex] ?? options[0]!;
  state.installedAgentFilter = selected.agent;
  state.agentFilterMenuOpen = false;
  state.installedIndex = 0;
  clampIndexes(state);
  return selected.agent;
}

export function restoreInstalledAgentFilter(state: TuiState, savedFilter: AgentType | null): void {
  state.installedAgentFilter =
    savedFilter === null || state.detectedAgents.includes(savedFilter) ? savedFilter : null;
  state.installedIndex = 0;
  clampIndexes(state);
}

function getLockEntry(
  state: TuiState,
  skillName: string,
  scope?: TuiScope
): TuiLockEntry | undefined {
  return (
    (scope ? state.lockEntries[`${scope}:${skillName}`] : undefined) ??
    state.lockEntries[skillName] ??
    Object.entries(state.lockEntries).find(([name, entry]) => {
      const unscopedName = name.replace(/^(project|global):/, '');
      return (
        (!scope || !entry.scope || entry.scope === scope) &&
        sanitizeName(unscopedName) === sanitizeName(skillName)
      );
    })?.[1]
  );
}

function safe(value: string | undefined | null): string {
  return sanitizeMetadata(value ?? '');
}

export function resolveSkillSourceTarget(entry: TuiLockEntry | undefined): string | null {
  const rawSource = (entry?.sourceUrl || entry?.source || '').trim();
  if (!rawSource) return null;

  const webSource = rawSource.startsWith('git+http') ? rawSource.slice(4) : rawSource;
  try {
    const url = new URL(webSource);
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      if (url.hostname.toLowerCase() === 'github.com' && url.pathname.endsWith('.git')) {
        url.pathname = url.pathname.slice(0, -4);
      }
      return url.toString();
    }
  } catch {
    // Continue with provider shorthand and local-path handling.
  }

  const sshGitHub = rawSource.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (sshGitHub) return `https://github.com/${sshGitHub[1]}/${sshGitHub[2]}`;

  if (entry?.sourceType === 'github') {
    const shorthand = rawSource
      .replace(/^github\.com\//i, '')
      .replace(/^https?:\/\/github\.com\//i, '')
      .replace(/\.git$/, '');
    if (/^[^/\s]+\/[^/\s]+$/.test(shorthand)) {
      return `https://github.com/${shorthand}`;
    }
  }

  if (entry?.sourceType === 'local') return resolvePath(rawSource);
  return null;
}

function openExternalTarget(target: string): Promise<void> {
  const command =
    process.platform === 'darwin'
      ? 'open'
      : process.platform === 'win32'
        ? 'explorer.exe'
        : 'xdg-open';

  return new Promise((resolve, reject) => {
    const child = spawn(command, [target], { detached: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

function visibleWidth(value: string): number {
  return stripTerminalEscapes(value).length;
}

function truncate(value: string, width: number): string {
  if (width <= 0) return '';
  const plain = stripTerminalEscapes(value);
  if (plain.length <= width) return value;
  return `${plain.slice(0, Math.max(0, width - 1))}…`;
}

function pad(value: string, width: number): string {
  const clipped = truncate(value, width);
  return clipped + ' '.repeat(Math.max(0, width - visibleWidth(clipped)));
}

function wrapText(value: string, width: number): string[] {
  if (width <= 0) return [''];
  let remaining = value.trim();
  if (!remaining) return [''];

  const lines: string[] = [];
  while (Array.from(remaining).length > width) {
    const characters = Array.from(remaining);
    const window = characters.slice(0, width + 1);
    const whitespace = window.lastIndexOf(' ');
    const breakAt = whitespace > 0 ? whitespace : width;
    lines.push(characters.slice(0, breakAt).join('').trimEnd());
    remaining = characters.slice(breakAt).join('').trimStart();
  }
  if (remaining) lines.push(remaining);
  return lines;
}

function renderDetailField(
  label: string,
  value: string,
  width: number,
  valueStyle = TEXT
): string[] {
  const labelWidth = 7;
  const valueLines = wrapText(value, Math.max(1, width - labelWidth));
  return valueLines.map((line, index) => {
    const prefix =
      index === 0
        ? `${DIM}${label}${RESET}${' '.repeat(Math.max(1, labelWidth - label.length))}`
        : ' '.repeat(labelWidth);
    return `${prefix}${valueStyle}${line}${RESET}`;
  });
}

function horizontalRule(width: number): string {
  return `${DIM}${'─'.repeat(Math.max(0, width))}${RESET}`;
}

function accentRule(width: number): string {
  return `${CYAN}${'━'.repeat(Math.max(0, width))}${RESET}`;
}

function updateProgressRule(progress: SkillUpdateCheckProgress, width: number): string {
  const ratio = progress.total === 0 ? 0 : Math.min(1, progress.checked / progress.total);
  const filledWidth = Math.round(width * ratio);
  return `${YELLOW}${'━'.repeat(filledWidth)}${RESET}${DIM}${'─'.repeat(
    Math.max(0, width - filledWidth)
  )}${RESET}`;
}

function scopeLabel(scope: TuiScope): string {
  return scope === 'project' ? 'Project' : 'Global';
}

function installedScopeFilterLabel(scope: InstalledScopeFilter): string {
  return scope === 'all' ? 'All' : scopeLabel(scope);
}

function installedScopeFilterStyle(scope: InstalledScopeFilter): {
  color: string;
  background: string;
} {
  if (scope === 'project') return { color: CYAN, background: SELECTED_BG };
  if (scope === 'global') return { color: GREEN, background: GLOBAL_METRIC_BG };
  return { color: MAGENTA, background: ALL_SCOPE_BG };
}

function formatCount(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function renderTopPanel(state: TuiState, width: number): string[] {
  const navigation = NAV_ITEMS.map((item) => {
    const active = state.screen === item.id;
    return active
      ? `${INVERSE}${BOLD} ${item.label}[${item.shortcut.toUpperCase()}] ${RESET}`
      : `${item.color}${item.label}${RESET}${DIM}[${item.shortcut.toUpperCase()}]${RESET}`;
  }).join('  ');

  return [pad(navigation, width)];
}

function renderMetric(
  label: string,
  value: number,
  description: string,
  width: number,
  color: string,
  background: string,
  icon: string
): string[] {
  const inner = Math.max(1, width - 2);
  const title = `─ ${icon} ${label} `;
  const badge = ` ${value} ${value === 1 ? 'SKILL' : 'SKILLS'} `;
  return [
    `${color}╭─ ${icon} ${BOLD}${BRIGHT_TEXT}${label}${RESET}${color} ${'─'.repeat(Math.max(0, inner - title.length))}╮${RESET}`,
    `${color}│${RESET}${pad(`  ${background}${BOLD}${TEXT}${badge}${RESET}`, inner)}${color}│${RESET}`,
    `${color}│${RESET}${pad(`  ${DIM}${description}${RESET}`, inner)}${color}│${RESET}`,
    `${color}╰${'─'.repeat(inner)}╯${RESET}`,
  ];
}

function renderOverview(state: TuiState, width: number): string[] {
  const projectCount = state.installed.filter((skill) => skill.scope === 'project').length;
  const globalCount = state.installed.filter((skill) => skill.scope === 'global').length;
  const trackedCount = Object.values(state.lockEntries).filter(
    (entry) => entry.source || entry.sourceType
  ).length;
  const metricWidth = Math.max(16, Math.floor((width - 3) / 2));
  const projectMetric = renderMetric(
    'Project skills',
    projectCount,
    'Available in this workspace',
    metricWidth,
    CYAN,
    SELECTED_BG,
    '◆'
  );
  const globalMetric = renderMetric(
    'Global skills',
    globalCount,
    'Available in every workspace',
    metricWidth,
    GREEN,
    GLOBAL_METRIC_BG,
    '●'
  );
  const lines: string[] = renderSkillsLogo().map((line) => pad(` ${line}`, width));
  lines.push(pad(` ${BOLD}${TEXT}The Open Agent Skills Ecosystem${RESET}`, width), '');

  for (let i = 0; i < projectMetric.length; i++) {
    lines.push(`${projectMetric[i]} ${globalMetric[i]}`);
  }

  lines.push('', `${BOLD}${CYAN}◆ Workspace status${RESET}`);
  lines.push(
    `${DIM}Detected agents${RESET}  ${TEXT}${formatCount(state.detectedAgents.length, 'agent')}${RESET}`
  );
  lines.push(
    `${DIM}Tracked sources${RESET}  ${TEXT}${formatCount(trackedCount, 'source')}${RESET}`
  );
  lines.push('', `${BOLD}${MAGENTA}◆ Quick actions${RESET}`);
  lines.push(`${GREEN}${BOLD}I${RESET} Installed   ${YELLOW}${BOLD}U${RESET} Updates`);
  lines.push('', `${BOLD}${GREEN}◆ Recently visible${RESET}`);

  const recent = state.installed.slice(0, 5);
  if (recent.length === 0) {
    lines.push(`${DIM}No installed skills found in the project or global scope.${RESET}`);
  } else {
    for (const skill of recent) {
      lines.push(
        `  ${GREEN}•${RESET} ${safe(skill.name)} ${DIM}(${scopeLabel(skill.scope)})${RESET}`
      );
    }
  }

  return lines;
}

function renderInstalled(state: TuiState, width: number, height: number): string[] {
  const skills = getInstalledViewSkills(state);
  const listWidth = Math.max(24, Math.min(40, Math.floor(width * 0.42)));
  const detailWidth = Math.max(20, width - listWidth - 3);
  const selected = skills[state.installedIndex];
  const filterLabel = state.installedAgentFilter
    ? agents[state.installedAgentFilter]?.displayName || state.installedAgentFilter
    : 'All agents';
  const scopeFilterLabel = installedScopeFilterLabel(state.installedScopeFilter);
  const scopeFilterStyle = installedScopeFilterStyle(state.installedScopeFilter);
  const scopeBadge = `${scopeFilterStyle.background}${BOLD}${TEXT} ${scopeFilterLabel}(${skills.length}) ${RESET}`;
  const filterBadge = `${SELECTED_BG}${BOLD}${TEXT} ${safe(filterLabel)} ${RESET}`;
  const lines: string[] = [
    `${BOLD}${TEXT}Installed skills${RESET} ${DIM}·${RESET} ${scopeBadge} ${DIM}·${RESET} ${BLUE}Agent${RESET} ${filterBadge}`,
    '',
  ];
  const tableRowBudget = Math.max(1, height - 4);
  const needsPagination = skills.length > tableRowBudget;
  const maxRows = Math.max(1, tableRowBudget - (needsPagination ? 1 : 0));
  const start = Math.min(
    Math.max(0, state.installedIndex - maxRows + 1),
    Math.max(0, skills.length - maxRows)
  );

  const listLines: string[] = [];
  if (skills.length === 0) {
    const scopeDescription =
      state.installedScopeFilter === 'all'
        ? 'installed skills'
        : `${state.installedScopeFilter} skills`;
    listLines.push(`${DIM}No ${scopeDescription} are effective for ${safe(filterLabel)}.${RESET}`);
  } else {
    for (let index = start; index < Math.min(skills.length, start + maxRows); index++) {
      const skill = skills[index]!;
      const active = index === state.installedIndex;
      const name = safe(skill.name);
      const scope = skill.scope;
      const scopeColor = scope === 'global' ? GREEN : CYAN;
      const suffixWidth = scope.length + 1;
      const marker = skill.disabled ? `${DIM}○${RESET}` : `${GREEN}●${RESET}`;
      const nameColor = skill.disabled ? DIM : TEXT;
      listLines.push(
        active
          ? `${SELECTED_BG}${BOLD}  ${marker}${SELECTED_BG}${BOLD} ${nameColor}${pad(name, listWidth - 4 - suffixWidth)}${RESET}${SELECTED_BG}${BOLD} ${scopeColor}${scope}${RESET}`
          : `  ${marker} ${pad(`${nameColor}${name}${RESET}`, listWidth - 4 - suffixWidth)} ${scopeColor}${scope}${RESET}`
      );
    }
    if (start > 0 || start + maxRows < skills.length) {
      listLines.push(
        `${DIM}  ${start + 1}–${Math.min(start + maxRows, skills.length)} of ${skills.length}${RESET}`
      );
    }
  }

  const detailLines: string[] = wrapText(safe(selected?.name || 'Select a skill'), detailWidth).map(
    (line) => `${BOLD}${line}${RESET}`
  );
  detailLines.push(
    '',
    ...wrapText(
      safe(selected?.description || 'Move through the list to inspect an installed skill.'),
      detailWidth
    ),
    ''
  );
  if (selected) {
    const entry = getLockEntry(state, selected.name, selected.scope);
    detailLines.push(
      ...renderDetailField(
        'Status',
        selected.disabled ? '○ disabled' : '● enabled',
        detailWidth,
        selected.disabled ? DIM : GREEN
      ),
      ...renderDetailField('Scope', scopeLabel(selected.scope), detailWidth),
      ...renderDetailField(
        'Agents',
        selected.agents.map((a) => agents[a]?.displayName || a).join(', ') || 'not linked',
        detailWidth
      ),
      ...renderDetailField('Path', safe(selected.canonicalPath), detailWidth),
      ...renderDetailField('Source', safe(entry?.source || 'local'), detailWidth)
    );
  }

  for (let i = 0; i < Math.max(listLines.length, detailLines.length); i++) {
    lines.push(
      `${pad(listLines[i] || '', listWidth)} ${DIM}│${RESET} ${pad(detailLines[i] || '', detailWidth)}`
    );
  }
  const toggleAction = selected?.disabled ? 'enable' : 'disable';
  lines.push(
    '',
    `${CYAN}↑↓${RESET} ${DIM}select${RESET}  ${scopeFilterStyle.color}s${RESET} ${DIM}scope${RESET}  ${BLUE}f${RESET} ${DIM}agent filter${RESET}  ${YELLOW}Space${RESET} ${DIM}${toggleAction}${RESET}  ${MAGENTA}o${RESET} ${DIM}source${RESET}  ${RED}d${RESET} ${DIM}remove${RESET}  ${CYAN}r${RESET} ${DIM}refresh${RESET}`
  );
  return lines;
}

function renderInstalledAgentFilter(state: TuiState, width: number): string[] {
  const options = getDetectedAgentFilterOptions(state);
  const columnWidth = Math.max(20, width);
  const detectedCount = options.length - 1;
  const lines = [
    `${BOLD}${TEXT}Filter by detected agent${RESET}`,
    `${DIM}${detectedCount} detected ${detectedCount === 1 ? 'agent' : 'agents'} · choose a filter, then press Enter${RESET}`,
    '',
  ];

  for (const [index, option] of options.entries()) {
    const active = state.installedAgentFilter === option.agent;
    const focused = state.agentFilterMenuIndex === index;
    const marker = active ? `${GREEN}●${RESET}` : `${DIM}○${RESET}`;
    lines.push(
      focused
        ? `${SELECTED_BG}${BOLD}  ${marker}${SELECTED_BG}${BOLD} ${TEXT}${pad(safe(option.label), columnWidth - 4)}${RESET}`
        : `  ${marker} ${TEXT}${pad(safe(option.label), columnWidth - 4)}${RESET}`
    );
  }

  lines.push(
    '',
    `${CYAN}↑↓ / j k${RESET} ${DIM}select ·${RESET} ${GREEN}Enter${RESET} ${DIM}apply · Esc/f close${RESET}`
  );
  return lines;
}

function renderUpdates(state: TuiState, width: number, height: number): string[] {
  const updates = state.availableUpdates;
  const summary = state.updateSummary;
  const summaryLine = summary
    ? `${summary.checkedCount} checked · ${summary.failedCount} failed · ${summary.skippedCount} skipped`
    : 'Entering this panel checks remote sources without installing anything.';
  const lines = [
    `${BOLD}${TEXT}Available updates${RESET} ${DIM}· Project + global · ${updates.length} found${RESET}`,
    `${DIM}${summaryLine}${RESET}`,
    '',
  ];

  if (state.updateProgress) {
    const progress = state.updateProgress;
    const count =
      progress.total === 0
        ? 'Preparing project and global update check…'
        : `Checking ${progress.checked} of ${progress.total} project and global skills…`;
    const current = progress.current ? ` ${DIM}· ${safe(progress.current)}${RESET}` : '';
    lines.push(
      `${renderCheckingSpinner(state.loadingFrame)}  ${YELLOW}${BOLD}${count}${RESET}${current}`,
      `${DIM}Available updates will appear here when the check completes.${RESET}`
    );
    return lines;
  }

  if (!summary) {
    lines.push(`${DIM}No update check has run yet.${RESET}`);
    return lines;
  }

  if (updates.length === 0) {
    if (summary.totalCount === 0) {
      lines.push(`${DIM}No automatically checkable skills were found.${RESET}`);
    } else if (summary.failedCount > 0) {
      lines.push(
        `${YELLOW}No updates found among the successfully checked skills.${RESET}`,
        `${DIM}${summary.failedCount} ${summary.failedCount === 1 ? 'skill could' : 'skills could'} not be checked.${RESET}`
      );
    } else {
      lines.push(
        `${GREEN}${BOLD}✓ All ${summary.checkedCount} checked skills are up to date.${RESET}`
      );
    }
    if (summary.skippedCount > 0) {
      lines.push(
        `${DIM}${summary.skippedCount} ${summary.skippedCount === 1 ? 'entry was' : 'entries were'} skipped because automatic checking is unavailable.${RESET}`
      );
    }
    lines.push('', `${CYAN}r${RESET} ${DIM}check again${RESET}`);
    return lines;
  }

  const listWidth = Math.max(24, Math.min(40, Math.floor(width * 0.42)));
  const detailWidth = Math.max(20, width - listWidth - 3);
  const selected = updates[state.updateIndex];
  const tableRowBudget = Math.max(1, height - 7);
  const needsPagination = updates.length > tableRowBudget;
  const maxRows = Math.max(1, tableRowBudget - (needsPagination ? 1 : 0));
  const start = Math.min(
    Math.max(0, state.updateIndex - maxRows + 1),
    Math.max(0, updates.length - maxRows)
  );
  const listLines: string[] = [];

  for (let index = start; index < Math.min(updates.length, start + maxRows); index++) {
    const update = updates[index]!;
    const active = index === state.updateIndex;
    const updating = state.updatingSkills.some(
      (skill) => skill.name === update.name && skill.scope === update.scope
    );
    const marker = updating ? renderUpdateSpinner(state.loadingFrame) : `${YELLOW}↑${RESET}`;
    const scopeColor = update.scope === 'global' ? GREEN : CYAN;
    const suffixWidth = update.scope.length + 1;
    listLines.push(
      active
        ? `${SELECTED_BG}${BOLD}  ${marker}${SELECTED_BG}${BOLD} ${TEXT}${pad(safe(update.name), listWidth - 4 - suffixWidth)}${RESET}${SELECTED_BG}${BOLD} ${scopeColor}${update.scope}${RESET}`
        : `  ${marker} ${pad(`${TEXT}${safe(update.name)}${RESET}`, listWidth - 4 - suffixWidth)} ${scopeColor}${update.scope}${RESET}`
    );
  }
  if (start > 0 || start + maxRows < updates.length) {
    listLines.push(
      `${DIM}  ${start + 1}–${Math.min(start + maxRows, updates.length)} of ${updates.length}${RESET}`
    );
  }

  const detailLines = selected
    ? [
        `${BOLD}${safe(selected.name)}${RESET}`,
        '',
        `${YELLOW}${BOLD}↑ Update available${RESET}`,
        '',
        `${DIM}Scope${RESET}  ${TEXT}${scopeLabel(selected.scope)}${RESET}`,
        `${DIM}Source${RESET} ${TEXT}${safe(selected.source)}${RESET}`,
        `${DIM}Type${RESET}   ${TEXT}${safe(selected.sourceType)}${RESET}`,
      ]
    : [`${DIM}Select an available update.${RESET}`];

  for (let i = 0; i < Math.max(listLines.length, detailLines.length); i++) {
    lines.push(
      `${pad(listLines[i] || '', listWidth)} ${DIM}│${RESET} ${pad(detailLines[i] || '', detailWidth)}`
    );
  }
  lines.push(
    '',
    `${CYAN}↑↓${RESET} ${DIM}select${RESET}  ${GREEN}u${RESET} ${DIM}update selected${RESET}  ${YELLOW}U${RESET} ${DIM}update all${RESET}  ${CYAN}r${RESET} ${DIM}check again${RESET}`
  );
  return lines;
}

function renderAgents(state: TuiState): string[] {
  const detected = new Set(state.detectedAgents);
  const agentEntries = Object.entries(agents).sort(([typeA, agentA], [typeB, agentB]) => {
    const detectedOrder =
      Number(detected.has(typeB as AgentType)) - Number(detected.has(typeA as AgentType));
    return detectedOrder || agentA.displayName.localeCompare(agentB.displayName);
  });
  const detectedCount = agentEntries.filter(([type]) => detected.has(type as AgentType)).length;
  const lines = [
    `${BOLD}${TEXT}Detected ${detectedCount} ${detectedCount === 1 ? 'agent' : 'agents'}${RESET}`,
    `${DIM}${detectedCount} of ${agentEntries.length} supported agents detected. Detected agents are shown first.${RESET}`,
    '',
  ];

  for (const [type, config] of agentEntries) {
    const isDetected = detected.has(type as AgentType);
    const marker = isDetected ? `${GREEN}●${RESET}` : `${DIM}○${RESET}`;
    const status = isDetected ? `${GREEN}detected${RESET}` : `${DIM}not detected${RESET}`;
    lines.push(`${marker} ${pad(`${TEXT}${safe(config.displayName)}${RESET}`, 28)} ${status}`);
  }
  return lines;
}

function renderHelp(): string[] {
  return [
    `${BOLD}${TEXT}Keyboard shortcuts${RESET}`,
    '',
    `${CYAN}↑ ↓ / j k${RESET} Move through the current list`,
    `${CYAN}← → / Tab${RESET} Switch sections`,
    `${CYAN}Shift + O I U A${RESET} Open a section by its first letter`,
    `${CYAN}Enter${RESET}      Open or run the selected action`,
    `${CYAN}r${RESET}          Refresh installed skills`,
    `${MAGENTA}s${RESET}          Cycle Installed scope: All, Project, Global`,
    `${CYAN}f${RESET}          Open the detected-agent filter picker`,
    `${CYAN}Space${RESET}      Enable or disable the selected installed skill`,
    `${CYAN}u${RESET}          Update the selected installed skill or available update`,
    `${CYAN}U${RESET}          Update every item in the Updates panel`,
    `${CYAN}o${RESET}          Open the selected skill's source`,
    `${CYAN}d${RESET}          Remove the selected installed skill`,
    `${CYAN}Esc${RESET}        Clear search or return`,
    `${CYAN}q${RESET}          Quit`,
  ];
}

function renderMain(state: TuiState, width: number, height: number): string[] {
  switch (state.screen) {
    case 'overview':
      return renderOverview(state, width);
    case 'installed':
      return state.agentFilterMenuOpen
        ? renderInstalledAgentFilter(state, width)
        : renderInstalled(state, width, height);
    case 'updates':
      return renderUpdates(state, width, height);
    case 'agents':
      return renderAgents(state);
    case 'help':
      return renderHelp();
  }
}

export function getTerminalSize(): TuiSize {
  return {
    columns: Math.max(60, process.stdout.columns || 100),
    rows: Math.max(16, process.stdout.rows || 30),
  };
}

export function renderTuiFrame(state: TuiState, size: TuiSize): string[] {
  const columns = Math.max(60, size.columns);
  const rows = Math.max(16, size.rows);
  const topPanel = renderTopPanel(state, columns);
  const menuRule =
    state.screen === 'updates' && state.updateProgress !== null
      ? updateProgressRule(state.updateProgress, columns)
      : accentRule(columns);
  const lines: string[] = [...topPanel, menuRule];
  lines.push('');

  const footerRows = 2;
  const mainHeight = Math.max(1, rows - lines.length - footerRows);
  const main = renderMain(state, columns, mainHeight);
  for (const line of main) lines.push(pad(line, columns));

  const navigationStatus = `${CYAN}↑↓${RESET} ${DIM}navigate${RESET}  ${GREEN}Enter${RESET} ${DIM}select${RESET}  ${MAGENTA}?${RESET} ${DIM}help${RESET}  ${YELLOW}q${RESET} ${DIM}quit${RESET}`;
  const updateLoaderIsVisible =
    state.screen === 'updates' &&
    (state.updateProgress !== null || state.updatingSkills.length > 0);
  const status = state.removeConfirmation
    ? `${RED}${BOLD}Remove ${safe(state.removeConfirmation.name)}?${RESET}  ${YELLOW}y / Enter${RESET} ${DIM}confirm${RESET}  ${CYAN}n / Esc${RESET} ${DIM}cancel${RESET}`
    : state.loading && !updateLoaderIsVisible
      ? `${renderUpdateSpinner(state.loadingFrame)}  ${YELLOW}${BOLD}${safe(state.loading)}${RESET}`
      : state.error
        ? `${RED}${BOLD}✕ ${safe(state.error)}${RESET}`
        : state.message
          ? `${GREEN}${BOLD}✓ ${safe(state.message)}${RESET}`
          : navigationStatus;
  const footer = [horizontalRule(columns), pad(status, columns)];
  const visibleLines = lines.slice(0, Math.max(0, rows - footer.length));
  while (visibleLines.length < rows - footer.length) visibleLines.push(' '.repeat(columns));
  return [...visibleLines, ...footer].map((line) => pad(line, columns));
}

export function renderTui(state: TuiState, size: TuiSize): string {
  return `${CLEAR_SCREEN}${HIDE_CURSOR}${renderTuiFrame(state, size).join('\n')}`;
}

function changeScreen(state: TuiState, screen: TuiScreen): void {
  state.screen = screen;
  state.message = null;
  state.error = null;
  if (screen === 'installed') state.installedIndex = 0;
  clampIndexes(state);
}

function moveSelection(state: TuiState, direction: 1 | -1): void {
  if (state.screen === 'installed') {
    const count = getInstalledViewSkills(state).length;
    state.installedIndex = Math.max(
      0,
      Math.min(Math.max(0, count - 1), state.installedIndex + direction)
    );
  } else if (state.screen === 'updates') {
    const count = state.availableUpdates.length;
    state.updateIndex = Math.max(
      0,
      Math.min(Math.max(0, count - 1), state.updateIndex + direction)
    );
  } else if (state.screen === 'agents') {
    // Agent rows are static, so scrolling is intentionally left to the terminal.
  }
}

function nextScreen(state: TuiState, direction: 1 | -1): TuiScreen {
  const currentIndex = NAV_ITEMS.findIndex((item) => item.id === state.screen);
  const nextIndex =
    currentIndex < 0 ? 0 : (currentIndex + direction + NAV_ITEMS.length) % NAV_ITEMS.length;
  return NAV_ITEMS[nextIndex]!.id;
}

interface CapturedCommandResult {
  code: number;
  output: string;
}

function runCliCommandCaptured(args: string[]): Promise<CapturedCommandResult> {
  const entry = process.argv[1];
  if (!entry) return Promise.reject(new Error('Unable to locate the CLI entry point.'));

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entry, ...args], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const capture = (chunk: string): void => {
      output = `${output}${chunk}`.slice(-32_000);
    };

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', capture);
    child.stderr.on('data', capture);
    child.once('error', reject);
    child.once('close', (code) => resolve({ code: code ?? 1, output }));
  });
}

function summarizeCommandOutput(output: string, fallback: string): string {
  const lines = stripTerminalEscapes(output)
    .split(/\r?\n/)
    .map((line) => safe(line).trim())
    .filter(Boolean);
  const preferred = [...lines]
    .reverse()
    .find((line) => /installed|updated|up to date|failed|no .*skills?/i.test(line));
  return truncate(preferred || lines.at(-1) || fallback, 160);
}

export function conflictsWithBackgroundUpdateCheck(
  state: TuiState,
  key: { name?: string; sequence?: string; shift?: boolean }
): boolean {
  const isSpace = key.name === 'space' || key.sequence === ' ';
  return (
    key.name === 'r' ||
    (state.screen === 'updates' && key.name === 'u') ||
    (state.screen === 'installed' && !key.shift && (key.name === 'd' || isSpace))
  );
}

export async function runTui(): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error('skills panel requires an interactive terminal.');
    process.exitCode = 1;
    return;
  }

  const state = createTuiState();
  let inputEnabled = true;
  let cleanedUp = false;
  let rendering = false;
  let renderPending = false;
  let updateCheckRunning = false;

  const enterScreen = (): void => {
    process.stdout.write(`${ENTER_ALT_SCREEN}${CLEAR_SCREEN}${HIDE_CURSOR}`);
  };

  const exitScreen = (): void => {
    process.stdout.write(`${SHOW_CURSOR}${EXIT_ALT_SCREEN}`);
  };

  const render = (): void => {
    if (cleanedUp) return;
    if (rendering) {
      renderPending = true;
      return;
    }
    rendering = true;
    renderPending = false;
    process.stdout.write(renderTui(state, getTerminalSize()), () => {
      rendering = false;
      if (renderPending) render();
    });
  };

  const loadingAnimationTimer = setInterval(() => {
    if (!state.loading || cleanedUp) return;
    state.loadingFrame = (state.loadingFrame + 1) % 20;
    render();
  }, LOADING_SPINNER_DELAY_MS);

  const refresh = async (): Promise<void> => {
    state.loading = 'Refreshing workspace…';
    render();
    try {
      await refreshTuiState(state);
      state.loading = null;
    } catch (error) {
      state.loading = null;
      state.error = error instanceof Error ? error.message : 'Unable to refresh workspace.';
    }
    render();
  };

  const runInTui = async (label: string, args: string[]): Promise<boolean> => {
    inputEnabled = false;
    state.loading = `${label}…`;
    state.message = null;
    state.error = null;
    let succeeded = false;
    render();

    try {
      const result = await runCliCommandCaptured(args);
      state.loading = null;
      const summary = summarizeCommandOutput(result.output, `${label} complete.`);
      if (result.code === 0) {
        succeeded = true;
        state.message = summary;
      } else {
        state.error = summary || `${label} exited with code ${result.code}.`;
      }

      try {
        await refreshTuiState(state);
      } catch (error) {
        state.error = error instanceof Error ? error.message : 'Unable to refresh workspace.';
      }
    } catch (error) {
      state.loading = null;
      state.error = error instanceof Error ? error.message : `${label} failed.`;
      state.message = null;
    } finally {
      inputEnabled = true;
      render();
    }
    return succeeded;
  };

  const checkUpdatesInTui = async (): Promise<void> => {
    if (updateCheckRunning) return;
    updateCheckRunning = true;
    state.availableUpdates = [];
    state.updateIndex = 0;
    state.updateSummary = null;
    state.updateProgress = { checked: 0, total: 0, current: null };
    state.loading = 'Checking for skill updates in background…';
    state.message = null;
    state.error = null;
    render();

    let progressRenderScheduled = false;
    try {
      const result = await checkAvailableSkillUpdates({
        scope: 'all',
        onProgress: (progress) => {
          state.updateProgress = progress;
          if (progressRenderScheduled) return;
          progressRenderScheduled = true;
          setImmediate(() => {
            progressRenderScheduled = false;
            render();
          });
        },
      });
      state.availableUpdates = result.updates;
      state.updateSummary = {
        checkedCount: result.checkedCount,
        totalCount: result.totalCount,
        failedCount: result.failedCount,
        skippedCount: result.skippedCount,
      };
      state.loading = null;
      if (result.failedCount > 0) {
        state.error = `${result.failedCount} ${result.failedCount === 1 ? 'skill could' : 'skills could'} not be checked.`;
      } else if (result.updates.length > 0) {
        state.message = `${result.updates.length} ${result.updates.length === 1 ? 'update' : 'updates'} available.`;
      } else if (result.totalCount === 0) {
        state.message = 'No automatically checkable skills found.';
      } else {
        state.message = `All ${result.checkedCount} checked skills are up to date.`;
      }
    } catch (error) {
      state.loading = null;
      state.error = error instanceof Error ? error.message : 'Unable to check for updates.';
      state.message = null;
    } finally {
      state.updateProgress = null;
      updateCheckRunning = false;
      render();
    }
  };

  const updateFromUpdatesPanel = async (all: boolean): Promise<void> => {
    const selected = state.availableUpdates[state.updateIndex];
    const updates = all ? state.availableUpdates : selected ? [selected] : [];
    if (updates.length === 0) {
      state.message = 'No updates are available.';
      state.error = null;
      render();
      return;
    }

    const groups = new Map<TuiScope, string[]>();
    for (const update of updates) {
      const names = groups.get(update.scope) || [];
      if (!names.includes(update.name)) names.push(update.name);
      groups.set(update.scope, names);
    }

    let updated = false;
    for (const scope of ['project', 'global'] as const) {
      const names = groups.get(scope);
      if (!names?.length) continue;
      const label = all
        ? `Updating ${names.length} ${scope} ${names.length === 1 ? 'skill' : 'skills'}`
        : `Updating ${names[0]}`;
      state.updatingSkills = names.map((name) => ({ name, scope }));
      const succeeded = await runInTui(label, [
        'update',
        ...names,
        '-y',
        scope === 'global' ? '-g' : '-p',
      ]);
      state.updatingSkills = [];
      render();
      if (!succeeded) break;
      updated = true;
    }
    if (updated) await checkUpdatesInTui();
  };

  const navigateTo = async (screen: TuiScreen): Promise<void> => {
    const previousScreen = state.screen;
    changeScreen(state, screen);
    if (previousScreen !== 'updates' && screen === 'updates') {
      if (updateCheckRunning) {
        render();
        return;
      }
      await checkUpdatesInTui();
      return;
    }
    render();
  };

  const runOperationInTui = async (
    label: string,
    operation: () => Promise<unknown>,
    successMessage: string
  ): Promise<void> => {
    inputEnabled = false;
    state.loading = `${label}…`;
    state.message = null;
    state.error = null;
    render();

    try {
      await operation();
      await refreshTuiState(state);
      state.loading = null;
      state.message = successMessage;
    } catch (error) {
      state.loading = null;
      state.error = error instanceof Error ? error.message : `${label} failed.`;
      state.message = null;
    } finally {
      inputEnabled = true;
      render();
    }
  };

  const handleKeypress = (_ch: string | undefined, key: readline.Key): void => {
    if (!inputEnabled || !key) return;
    void (async () => {
      if (key.ctrl && key.name === 'c') {
        cleanedUp = true;
        return;
      }

      if (state.removeConfirmation) {
        if (key.name === 'y' || key.name === 'return') {
          const pending = state.removeConfirmation;
          state.removeConfirmation = null;
          const args = ['remove', pending.name, '-y'];
          if (pending.scope === 'global') args.push('-g');
          await runInTui(`Removing ${pending.name}`, args);
        } else if (key.name === 'n' || key.name === 'escape') {
          state.removeConfirmation = null;
          state.message = 'Removal cancelled.';
          state.error = null;
          render();
        }
        return;
      }

      if (state.agentFilterMenuOpen) {
        if (key.name === 'escape' || key.name === 'f') {
          state.agentFilterMenuOpen = false;
          render();
          return;
        }
        if (key.name === 'tab') {
          moveAgentFilterMenu(state, key.shift ? -1 : 1);
          render();
          return;
        }
        if (key.name === 'up' || key.name === 'left' || key.name === 'k') {
          moveAgentFilterMenu(state, -1);
          render();
          return;
        }
        if (key.name === 'down' || key.name === 'right' || key.name === 'j') {
          moveAgentFilterMenu(state, 1);
          render();
          return;
        }
        if (key.name === 'return' || key.name === 'enter') {
          const selectedFilter = applyAgentFilterMenuSelection(state);
          const label = selectedFilter
            ? agents[selectedFilter]?.displayName || selectedFilter
            : 'All agents';
          try {
            await writeTuiPreferences(selectedFilter);
            state.message = `Filtering installed skills by ${label}. Saved for next time.`;
            state.error = null;
          } catch (error) {
            state.message = null;
            state.error = `Filter applied, but could not save it: ${
              error instanceof Error ? error.message : 'unknown error'
            }`;
          }
          render();
        }
        return;
      }

      if (updateCheckRunning && conflictsWithBackgroundUpdateCheck(state, key)) {
        state.loading = 'Checking for skill updates in background…';
        render();
        return;
      }

      if (state.screen === 'updates' && key.name === 'u' && key.shift) {
        await updateFromUpdatesPanel(true);
        return;
      }

      const shiftedMenuItem = key.shift
        ? NAV_ITEMS.find((item) => item.shortcut === key.name)
        : undefined;
      if (shiftedMenuItem) {
        await navigateTo(shiftedMenuItem.id);
        return;
      }

      if (key.name === 'q' || key.name === 'escape') {
        cleanedUp = true;
        return;
      }
      if (key.name === 'up' || key.name === 'k') moveSelection(state, -1);
      else if (key.name === 'down' || key.name === 'j') moveSelection(state, 1);
      else if (key.name === 'left') {
        await navigateTo(nextScreen(state, -1));
        return;
      } else if (key.name === 'right' || key.name === 'tab') {
        await navigateTo(nextScreen(state, 1));
        return;
      } else if (key.name === 'r') {
        if (state.screen === 'updates') {
          await checkUpdatesInTui();
          return;
        }
        await refresh();
        return;
      } else if (key.name === 's' && !key.shift && state.screen === 'installed') {
        cycleInstalledScopeFilter(state);
        state.message = null;
        state.error = null;
        render();
        return;
      } else if (key.name === 'f' && state.screen === 'installed') {
        openAgentFilterMenu(state);
        state.message = null;
        state.error = null;
        render();
        return;
      } else if (key.name === 'd' && state.screen === 'installed') {
        const selected = getInstalledViewSkills(state)[state.installedIndex];
        if (selected) {
          state.removeConfirmation = { name: selected.name, scope: selected.scope };
          state.message = null;
          state.error = null;
          render();
          return;
        }
      } else if ((key.name === 'space' || key.sequence === ' ') && state.screen === 'installed') {
        const selected = getInstalledViewSkills(state)[state.installedIndex];
        if (selected) {
          const enable = Boolean(selected.disabled);
          await runOperationInTui(
            `${enable ? 'Enabling' : 'Disabling'} ${selected.name}`,
            () => setInstalledSkillEnabled(selected, enable),
            `${selected.name} ${enable ? 'enabled' : 'disabled'}.`
          );
          return;
        }
      } else if (key.name === 'o' && state.screen === 'installed') {
        const selected = getInstalledViewSkills(state)[state.installedIndex];
        if (selected) {
          const entry = getLockEntry(state, selected.name, selected.scope);
          const target = resolveSkillSourceTarget(entry);
          if (!target) {
            state.error = `No openable source is recorded for ${selected.name}.`;
            state.message = null;
          } else {
            try {
              await openExternalTarget(target);
              state.message = `Opened ${selected.name} source.`;
              state.error = null;
            } catch (error) {
              state.error =
                error instanceof Error ? error.message : `Unable to open ${selected.name}.`;
              state.message = null;
            }
          }
          render();
          return;
        }
      } else if (key.name === 'u' && !key.shift && state.screen === 'updates') {
        await updateFromUpdatesPanel(false);
        return;
      } else if (key.name === '?' || key.sequence === '?') {
        await navigateTo('help');
        return;
      } else if (NAV_ITEMS.some((item) => item.shortcut === key.name)) {
        await navigateTo(NAV_ITEMS.find((item) => item.shortcut === key.name)!.id);
        return;
      }
      render();
    })();
  };

  const handleResize = (): void => render();
  const handleSignal = (): void => {
    cleanedUp = true;
  };

  const cleanup = (): void => {
    clearInterval(loadingAnimationTimer);
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.stdin.removeListener('keypress', handleKeypress);
    process.stdout.removeListener('resize', handleResize);
    process.removeListener('SIGINT', handleSignal);
    process.removeListener('SIGTERM', handleSignal);
    process.stdin.pause();
    exitScreen();
  };

  enterScreen();
  const preferences = await readTuiPreferences();
  await refresh();
  restoreInstalledAgentFilter(state, preferences.installedAgentFilter);
  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on('keypress', handleKeypress);
  process.stdout.on('resize', handleResize);
  process.on('SIGINT', handleSignal);
  process.on('SIGTERM', handleSignal);
  render();

  await new Promise<void>((resolve) => {
    const timer = setInterval(() => {
      if (cleanedUp) {
        clearInterval(timer);
        resolve();
      }
    }, 50);
  });
  cleanup();
}
