import { describe, expect, it } from 'vitest';
import { SKILLS_LOGO_LINES } from './logo.ts';
import { stripTerminalEscapes } from './sanitize.ts';
import {
  applyAgentFilterMenuSelection,
  conflictsWithBackgroundUpdateCheck,
  createTuiState,
  cycleInstalledScopeFilter,
  moveAgentFilterMenu,
  openAgentFilterMenu,
  renderTuiFrame,
  resolveSkillSourceTarget,
  restoreInstalledAgentFilter,
} from './tui.ts';

describe('TUI renderer', () => {
  it('renders the dashboard navigation and workspace metrics', () => {
    const state = createTuiState();
    state.detectedAgents = ['codex'];
    state.installed = [
      {
        name: 'frontend-design',
        description: 'Build polished frontend experiences.',
        path: '/tmp/.agents/skills/frontend-design',
        canonicalPath: '/tmp/.agents/skills/frontend-design',
        scope: 'project',
        agents: ['codex'],
      },
    ];

    const output = renderTuiFrame(state, { columns: 100, rows: 28 }).join('\n');
    const plainOutput = stripTerminalEscapes(output);

    expect(plainOutput).toContain('███████╗██╗  ██╗██╗██╗     ██╗     ███████╗');
    expect(plainOutput).toContain('╚══════╝╚═╝  ╚═╝╚═╝╚══════╝╚══════╝╚══════╝');
    expect(plainOutput).toContain('The Open Agent Skills Ecosystem');
    expect(
      plainOutput
        .split('\n')
        .some((line) => line.startsWith(' ███████╗██╗  ██╗██╗██╗     ██╗     ███████╗'))
    ).toBe(true);
    expect(
      plainOutput.split('\n').some((line) => line.startsWith(' The Open Agent Skills Ecosystem'))
    ).toBe(true);
    expect(plainOutput).not.toContain('Discover');
    expect(output).toContain('Overview');
    expect(output).toContain('Project skills');
    expect(output).toContain('frontend-design');
    expect(output).toContain('\x1b[7m\x1b[1m Overview[O] \x1b[0m');
    expect(output).toContain('\x1b[44m\x1b[1m\x1b[39m 1 SKILL ');
    expect(output).toContain('\x1b[42m\x1b[1m\x1b[39m 0 SKILLS ');
    expect(plainOutput).toContain('Available in this workspace');
    expect(plainOutput).toContain('Available in every workspace');
    expect(plainOutput).not.toContain('Scope Project · Skills');

    const lines = renderTuiFrame(state, { columns: 100, rows: 28 }).map(stripTerminalEscapes);
    const navigationLine = lines.findIndex(
      (line) => line.includes('Overview[O]') && line.includes('Agents[A]')
    );
    const contentLine = lines.findIndex((line) => line.includes('Project skills'));
    expect(navigationLine).toBeGreaterThanOrEqual(0);
    expect(navigationLine).toBeLessThan(contentLine);
    expect(lines.filter((line) => line.includes('Overview[O]'))).toHaveLength(1);

    const narrowLines = renderTuiFrame(state, { columns: 60, rows: 28 }).map(stripTerminalEscapes);
    const narrowMenu = narrowLines.find(
      (line) => line.includes('Overview[O]') && line.includes('Agents[A]')
    );
    expect(narrowMenu).toBeDefined();
    expect(narrowLines.filter((line) => line.includes('Overview[O]'))).toHaveLength(1);
  });

  it('renders the menu border in one color', () => {
    const lines = renderTuiFrame(createTuiState(), { columns: 100, rows: 28 });

    expect(lines[1]).toBe(`\x1b[36m${'━'.repeat(100)}\x1b[0m`);
  });

  it('uses the shared logo colors and terminal palette-aware colors elsewhere', () => {
    const overview = createTuiState();

    const installed = createTuiState();
    installed.screen = 'installed';
    installed.installed = [
      {
        name: 'theme-aware',
        description: 'Uses the terminal palette.',
        path: '/workspace/.agents/skills/theme-aware',
        canonicalPath: '/workspace/.agents/skills/theme-aware',
        scope: 'project',
        agents: ['codex'],
      },
    ];

    const updates = createTuiState();
    updates.screen = 'updates';
    updates.updateProgress = { checked: 1, total: 2, current: 'theme-aware' };

    const output = [overview, installed, updates]
      .flatMap((state) => renderTuiFrame(state, { columns: 100, rows: 28 }))
      .join('\n');

    expect(output).toContain('\x1b[39m');
    expect(output).toContain('\x1b[2m');
    expect(output).toContain('\x1b[44m');
    expect(output).toContain('\x1b[42m');
    expect(output).toContain('\x1b[38;5;250m');

    const outputWithoutLogo = output
      .split('\n')
      .filter((line) => !SKILLS_LOGO_LINES.some((logoLine) => line.includes(logoLine)))
      .join('\n');
    expect(outputWithoutLogo).not.toMatch(/\x1b\[(?:38|48);(?:2|5);/);
  });

  it('renders installed skill details for the selected scope', () => {
    const state = createTuiState();
    state.screen = 'installed';
    state.installed = [
      {
        name: 'project-helper',
        description: 'A project-local helper.',
        path: '/workspace/.agents/skills/project-helper',
        canonicalPath: '/workspace/.agents/skills/project-helper',
        scope: 'project',
        agents: ['codex'],
      },
      {
        name: 'release-notes',
        description: 'Prepare release notes from git history.',
        path: '/home/user/.agents/skills/release-notes',
        canonicalPath: '/home/user/.agents/skills/release-notes',
        scope: 'global',
        agents: ['codex'],
        disabled: true,
      },
    ];
    state.installedIndex = 1;
    state.lockEntries = {
      'project:release-notes': {
        source: 'project-owner/release-notes',
        sourceType: 'github',
        scope: 'project',
      },
      'global:release-notes': {
        source: 'global-owner/release-notes',
        sourceType: 'github',
        scope: 'global',
      },
    };

    const output = renderTuiFrame(state, { columns: 100, rows: 28 }).join('\n');
    const plainOutput = stripTerminalEscapes(output);

    expect(output).toContain('Installed skills');
    expect(output).toContain('project-helper');
    expect(output).toContain('release-notes');
    expect(output).toContain('Prepare release notes from git history.');
    expect(plainOutput).toMatch(/project-helper\s+project/);
    expect(plainOutput).toMatch(/release-notes\s+global/);
    expect(plainOutput).toContain('Status ○ disabled');
    expect(plainOutput).toContain('Source global-owner/release-notes');
    expect(plainOutput).toMatch(/All\(2\)\s+· Agent\s+All agents/);
    expect(plainOutput).not.toContain('Scope All');
    expect(output).toContain('\x1b[45m\x1b[1m\x1b[39m All(2) \x1b[0m');
    expect(output).toContain('\x1b[44m\x1b[1m\x1b[39m All agents \x1b[0m');
    expect(output).toContain('\x1b[35ms\x1b[0m \x1b[2mscope');
    expect(plainOutput).toContain('s scope  f agent filter');
    expect(plainOutput).toContain('f agent filter  Space enable  o source');
    expect(plainOutput).not.toContain('u update');
    expect(output).toContain(
      '\x1b[44m\x1b[1m  \x1b[2m○\x1b[0m\x1b[44m\x1b[1m \x1b[2mrelease-notes'
    );
    expect(plainOutput).not.toContain('▸');
    expect(output).toContain('\x1b[2m○');
  });

  it('uses the full available height for the Installed list', () => {
    const state = createTuiState();
    state.screen = 'installed';
    state.installed = Array.from({ length: 30 }, (_, index) => ({
      name: `skill-${String(index + 1).padStart(2, '0')}`,
      description: `Skill ${index + 1}`,
      path: `/workspace/.agents/skills/skill-${index + 1}`,
      canonicalPath: `/workspace/.agents/skills/skill-${index + 1}`,
      scope: 'project' as const,
      agents: ['codex' as const],
    }));

    const standard = stripTerminalEscapes(
      renderTuiFrame(state, { columns: 100, rows: 24 }).join('\n')
    );
    const tall = stripTerminalEscapes(renderTuiFrame(state, { columns: 100, rows: 30 }).join('\n'));

    expect(standard).toContain('skill-14');
    expect(standard).not.toContain('skill-15');
    expect(tall).toContain('skill-20');
  });

  it('wraps complete Installed detail values instead of truncating them', () => {
    const state = createTuiState();
    const description =
      'This complete description explains every important capability without hiding the final words.';
    const canonicalPath =
      '/workspace/.agents/skills/a-complete-skill-directory-name-that-exceeds-the-detail-column';
    const source =
      'owner/a-complete-repository-name/tree/main/a-deeply-nested-skill-source-directory';
    state.screen = 'installed';
    state.installed = [
      {
        name: 'complete-details',
        description,
        path: canonicalPath,
        canonicalPath,
        scope: 'project',
        agents: ['codex'],
      },
    ];
    state.lockEntries = {
      'project:complete-details': {
        source,
        sourceType: 'github',
        scope: 'project',
      },
    };

    const detailText = renderTuiFrame(state, { columns: 80, rows: 40 })
      .map(stripTerminalEscapes)
      .map((line) => line.split('│')[1] || '')
      .join('')
      .replace(/\s+/g, '');

    expect(detailText).toContain(description.replace(/\s+/g, ''));
    expect(detailText).toContain(canonicalPath);
    expect(detailText).toContain(source);
    expect(detailText).not.toContain('…');
  });

  it('sanitizes metadata before rendering it to the terminal', () => {
    const state = createTuiState();
    state.screen = 'installed';
    state.installed = [
      {
        name: '\u001b]2;malicious\u0007safe-skill',
        description: 'A safe skill.',
        path: '/workspace/.agents/skills/safe-skill',
        canonicalPath: '/workspace/.agents/skills/safe-skill',
        scope: 'project',
        agents: ['codex'],
      },
    ];

    const output = renderTuiFrame(state, { columns: 100, rows: 28 }).join('\n');

    expect(output).toContain('safe-skill');
    expect(output).not.toContain('malicious');
    expect(output).not.toContain('\u001b]');
  });

  it('filters installed skills by the agents they are effective for', () => {
    const state = createTuiState();
    state.screen = 'installed';
    state.installedAgentFilter = 'codex';
    state.installed = [
      {
        name: 'codex-only',
        description: 'Effective for Codex.',
        path: '/workspace/.agents/skills/codex-only',
        canonicalPath: '/workspace/.agents/skills/codex-only',
        scope: 'project',
        agents: ['codex'],
      },
      {
        name: 'cursor-only',
        description: 'Effective for Cursor.',
        path: '/workspace/.agents/skills/cursor-only',
        canonicalPath: '/workspace/.agents/skills/cursor-only',
        scope: 'project',
        agents: ['cursor'],
      },
      {
        name: 'shared-skill',
        description: 'Effective for both agents.',
        path: '/workspace/.agents/skills/shared-skill',
        canonicalPath: '/workspace/.agents/skills/shared-skill',
        scope: 'project',
        agents: ['codex', 'cursor'],
      },
    ];

    const rendered = renderTuiFrame(state, { columns: 100, rows: 28 }).join('\n');
    const output = stripTerminalEscapes(rendered);

    expect(output).toMatch(/All\(2\)\s+· Agent\s+Codex/);
    expect(output).not.toContain('Scope All');
    expect(rendered).toContain('\x1b[44m\x1b[1m\x1b[39m Codex \x1b[0m');
    expect(output).toContain('codex-only');
    expect(output).toContain('shared-skill');
    expect(output).not.toContain('cursor-only');
    expect(output).toContain('f agent filter');
  });

  it('cycles the Installed scope through project, global, and all', () => {
    const state = createTuiState();
    state.screen = 'installed';
    state.installed = [
      {
        name: 'project-helper',
        description: 'A project-local helper.',
        path: '/workspace/.agents/skills/project-helper',
        canonicalPath: '/workspace/.agents/skills/project-helper',
        scope: 'project',
        agents: ['codex'],
      },
      {
        name: 'global-helper',
        description: 'A global helper.',
        path: '/home/user/.agents/skills/global-helper',
        canonicalPath: '/home/user/.agents/skills/global-helper',
        scope: 'global',
        agents: ['codex'],
      },
    ];
    state.installedIndex = 1;

    expect(cycleInstalledScopeFilter(state)).toBe('project');
    expect(state.installedIndex).toBe(0);
    let output = stripTerminalEscapes(renderTuiFrame(state, { columns: 100, rows: 28 }).join('\n'));
    expect(output).toMatch(/Project\(1\)\s+· Agent\s+All agents/);
    expect(output).not.toContain('Scope Project');
    expect(output).toContain('project-helper');
    expect(output).not.toContain('global-helper');

    expect(cycleInstalledScopeFilter(state)).toBe('global');
    output = stripTerminalEscapes(renderTuiFrame(state, { columns: 100, rows: 28 }).join('\n'));
    expect(output).toMatch(/Global\(1\)\s+· Agent\s+All agents/);
    expect(output).not.toContain('Scope Global');
    expect(output).not.toContain('project-helper');
    expect(output).toContain('global-helper');

    expect(cycleInstalledScopeFilter(state)).toBe('all');
    output = stripTerminalEscapes(renderTuiFrame(state, { columns: 100, rows: 28 }).join('\n'));
    expect(output).toMatch(/All\(2\)\s+· Agent\s+All agents/);
    expect(output).toContain('project-helper');
    expect(output).toContain('global-helper');
  });

  it('switches the detected-agent filter with an arrow-key and Vim-key picker', () => {
    const state = createTuiState();
    state.screen = 'installed';
    state.detectedAgents = ['cursor', 'codex'];
    openAgentFilterMenu(state);

    const rendered = renderTuiFrame(state, { columns: 100, rows: 28 }).join('\n');
    const output = stripTerminalEscapes(rendered);

    expect(output).toContain('Filter by detected agent');
    expect(output).toContain('2 detected agents');
    expect(output).toContain('All agents');
    expect(output).toContain('Codex');
    expect(output).toContain('Cursor');
    expect(output).toContain('↑↓ / j k select · Enter apply · Esc/f close');
    expect(output).not.toContain('Tab next');
    expect(output).not.toContain('Shift+Tab previous');
    expect(rendered).toContain(
      '\x1b[44m\x1b[1m  \x1b[32m●\x1b[0m\x1b[44m\x1b[1m \x1b[39mAll agents'
    );
    expect(output).not.toContain('▸');

    const lines = rendered.split('\n').map(stripTerminalEscapes);
    const allAgentsLine = lines.findIndex((line) => line.includes('All agents'));
    const codexLine = lines.findIndex((line) => line.trim().startsWith('○ Codex'));
    const cursorLine = lines.findIndex((line) => line.trim().startsWith('○ Cursor'));
    expect(allAgentsLine).toBeGreaterThanOrEqual(0);
    expect(codexLine).toBeGreaterThan(allAgentsLine);
    expect(cursorLine).toBeGreaterThan(codexLine);

    moveAgentFilterMenu(state, 1);
    expect(applyAgentFilterMenuSelection(state)).toBe('codex');
    expect(state.installedAgentFilter).toBe('codex');
    expect(state.agentFilterMenuOpen).toBe(false);

    openAgentFilterMenu(state);
    moveAgentFilterMenu(state, -1);
    expect(applyAgentFilterMenuSelection(state)).toBeNull();
    expect(state.installedAgentFilter).toBeNull();
  });

  it('restores only a saved filter for an agent detected in this session', () => {
    const state = createTuiState();
    state.detectedAgents = ['codex'];

    restoreInstalledAgentFilter(state, 'codex');
    expect(state.installedAgentFilter).toBe('codex');

    restoreInstalledAgentFilter(state, 'cursor');
    expect(state.installedAgentFilter).toBeNull();
  });

  it('keeps update progress visible inside the TUI frame', () => {
    const state = createTuiState();
    state.screen = 'updates';
    state.loading = 'Checking for skill updates in background…';
    state.updateProgress = { checked: 1, total: 10, current: 'frontend-design' };

    const renderedLines = renderTuiFrame(state, { columns: 100, rows: 28 });
    const output = renderedLines.join('\n');
    const plainLines = renderedLines.map(stripTerminalEscapes);
    const progressLine = plainLines.findIndex((line) =>
      line.includes('Checking 1 of 10 project and global skills')
    );
    const contentLine = plainLines.findIndex((line) => line.includes('Available updates'));

    expect(stripTerminalEscapes(output)).toContain(
      '⠋  Checking 1 of 10 project and global skills… · frontend-design'
    );
    expect(stripTerminalEscapes(output).match(/⠋/g)).toHaveLength(1);
    expect(stripTerminalEscapes(renderedLines.at(-1) || '')).toContain('navigate');
    expect(stripTerminalEscapes(output)).toContain('frontend-design');
    expect(progressLine).toBeGreaterThanOrEqual(0);
    expect(progressLine).toBeGreaterThan(contentLine);
    expect(renderedLines[1]).toBe(
      `\x1b[33m${'━'.repeat(10)}\x1b[0m\x1b[2m${'─'.repeat(90)}\x1b[0m`
    );
  });

  it('renders the update loader in the skill row instead of the footer', () => {
    const state = createTuiState();
    state.screen = 'updates';
    state.loading = 'Updating frontend-design…';
    state.availableUpdates = [
      {
        name: 'frontend-design',
        scope: 'project',
        source: 'owner/frontend-design',
        sourceType: 'github',
      },
    ];
    state.updateSummary = {
      checkedCount: 1,
      totalCount: 1,
      failedCount: 0,
      skippedCount: 0,
    };
    state.updatingSkills = [{ name: 'frontend-design', scope: 'project' }];

    const firstFrame = renderTuiFrame(state, { columns: 80, rows: 24 }).map(stripTerminalEscapes);
    state.loadingFrame = 2;
    const laterFrame = renderTuiFrame(state, { columns: 80, rows: 24 }).map(stripTerminalEscapes);

    expect(firstFrame.some((line) => line.includes('◒ frontend-design'))).toBe(true);
    expect(laterFrame.some((line) => line.includes('◓ frontend-design'))).toBe(true);
    expect(firstFrame.at(-1)).toContain('navigate');
    expect(firstFrame.at(-1)).not.toContain('Updating frontend-design');
  });

  it('keeps menu navigation available during a background update check', () => {
    const state = createTuiState();
    state.screen = 'updates';

    expect(conflictsWithBackgroundUpdateCheck(state, { name: 'tab' })).toBe(false);
    expect(conflictsWithBackgroundUpdateCheck(state, { name: 'left' })).toBe(false);
    expect(conflictsWithBackgroundUpdateCheck(state, { name: 'i', shift: true })).toBe(false);
    expect(conflictsWithBackgroundUpdateCheck(state, { name: 's' })).toBe(false);
    expect(conflictsWithBackgroundUpdateCheck(state, { name: 'u' })).toBe(true);

    state.screen = 'installed';
    expect(conflictsWithBackgroundUpdateCheck(state, { name: 'u' })).toBe(false);
  });

  it('keeps the footer visible in a standard 24-row terminal', () => {
    const state = createTuiState();

    const lines = renderTuiFrame(state, { columns: 80, rows: 24 }).map(stripTerminalEscapes);

    expect(lines).toHaveLength(24);
    expect(lines.at(-1)).toContain('navigate');
    expect(lines.at(-1)).toContain('quit');
  });

  it('renders an in-TUI confirmation before removing an installed skill', () => {
    const state = createTuiState();
    state.screen = 'installed';
    state.removeConfirmation = { name: 'release-notes', scope: 'global' };

    const lines = renderTuiFrame(state, { columns: 80, rows: 24 }).map(stripTerminalEscapes);

    expect(lines.at(-1)).toContain('Remove release-notes?');
    expect(lines.at(-1)).toContain('y / Enter confirm');
    expect(lines.at(-1)).toContain('n / Esc cancel');
  });

  it('renders available updates as a selectable list with selected and all actions', () => {
    const state = createTuiState();
    state.screen = 'updates';
    state.availableUpdates = [
      {
        name: 'alpha-skill',
        scope: 'project',
        source: 'owner/alpha',
        sourceType: 'github',
      },
      {
        name: 'global-skill',
        scope: 'global',
        source: 'owner/global',
        sourceType: 'github',
      },
    ];
    state.updateIndex = 1;
    state.updateSummary = {
      checkedCount: 10,
      totalCount: 10,
      failedCount: 0,
      skippedCount: 0,
    };

    const rendered = renderTuiFrame(state, { columns: 100, rows: 28 }).join('\n');
    const output = stripTerminalEscapes(rendered);

    expect(output).toContain('Available updates · Project + global · 2 found');
    expect(output).toContain('10 checked · 0 failed · 0 skipped');
    expect(output).toContain('alpha-skill');
    expect(output).toContain('global-skill');
    expect(output).toContain('Scope  Global');
    expect(output).toContain('Source owner/global');
    expect(output).toContain('u update selected  U update all');
    expect(output).not.toContain('▸');
    expect(rendered).toContain(
      '\x1b[44m\x1b[1m  \x1b[33m↑\x1b[0m\x1b[44m\x1b[1m \x1b[39mglobal-skill'
    );
  });

  it('shows a successful empty result after a completed update check', () => {
    const state = createTuiState();
    state.screen = 'updates';
    state.updateSummary = {
      checkedCount: 10,
      totalCount: 10,
      failedCount: 0,
      skippedCount: 0,
    };

    const output = stripTerminalEscapes(
      renderTuiFrame(state, { columns: 100, rows: 28 }).join('\n')
    );

    expect(output).toContain('All 10 checked skills are up to date.');
  });

  it('shows the detected-agent total and sorts detected agents first', () => {
    const state = createTuiState();
    state.screen = 'agents';
    state.detectedAgents = ['cursor', 'codex'];

    const lines = renderTuiFrame(state, { columns: 100, rows: 28 }).map(stripTerminalEscapes);
    const output = lines.join('\n');
    const detectedRows = lines.filter((line) => line.includes('●'));

    expect(output).toContain('Detected 2 agents');
    expect(output).toMatch(/2 of \d+ supported agents detected/);
    expect(detectedRows[0]).toContain('Codex');
    expect(detectedRows[1]).toContain('Cursor');
  });

  it('resolves safe source targets for the open-source action', () => {
    expect(
      resolveSkillSourceTarget({ source: 'vercel-labs/agent-skills', sourceType: 'github' })
    ).toBe('https://github.com/vercel-labs/agent-skills');
    expect(
      resolveSkillSourceTarget({
        source: 'vercel-labs/agent-skills',
        sourceUrl: 'git+https://github.com/vercel-labs/agent-skills.git',
        sourceType: 'github',
      })
    ).toBe('https://github.com/vercel-labs/agent-skills');
    expect(
      resolveSkillSourceTarget({ source: 'npm-package', sourceType: 'node_modules' })
    ).toBeNull();
  });
});
