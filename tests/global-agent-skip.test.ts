import { beforeEach, describe, expect, it, vi } from 'vitest';

const { info } = vi.hoisted(() => ({ info: vi.fn() }));
vi.mock('@clack/prompts', () => ({ log: { info } }));

import { agents } from '../src/agents.ts';
import { skipAgentsWithoutGlobalDir } from '../src/add.ts';
import { withGlobalSkillsDir } from '../src/update.ts';
import type { AgentType } from '../src/types.ts';

// promptscript has no global skills directory; claude-code has one (#2533).
const detected: AgentType[] = ['claude-code', 'promptscript'];

describe('skipAgentsWithoutGlobalDir', () => {
  beforeEach(() => info.mockClear());

  it('fixture agents still differ in global support', () => {
    expect(agents['claude-code'].globalSkillsDir).toBeDefined();
    expect(agents.promptscript.globalSkillsDir).toBeUndefined();
  });

  it('skips detected agents without a global skills dir on a global install, with one notice', () => {
    expect(skipAgentsWithoutGlobalDir(detected, { global: true })).toEqual(['claude-code']);
    expect(info).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith(
      `Skipping ${agents.promptscript.displayName}: no global skills directory`
    );
  });

  it('leaves project installs alone', () => {
    expect(skipAgentsWithoutGlobalDir(detected, { global: false })).toEqual(detected);
    expect(info).not.toHaveBeenCalled();
  });

  it('keeps agents named with --agent, so their error stays visible', () => {
    expect(skipAgentsWithoutGlobalDir(detected, { global: true, agent: detected })).toEqual(
      detected
    );
    expect(info).not.toHaveBeenCalled();
  });

  it("skips them with --agent '*', which names no agent", () => {
    expect(skipAgentsWithoutGlobalDir(detected, { global: true, agent: ['*'] })).toEqual([
      'claude-code',
    ]);
    expect(info).toHaveBeenCalledTimes(1);
  });

  it('keeps the selection when no agent supports a global install', () => {
    expect(skipAgentsWithoutGlobalDir(['promptscript'], { global: true })).toEqual([
      'promptscript',
    ]);
    expect(info).not.toHaveBeenCalled();
  });
});

describe('withGlobalSkillsDir (update -g placement)', () => {
  it('drops agents without a global skills dir', () => {
    expect(withGlobalSkillsDir(detected)).toEqual(['claude-code']);
  });

  it('keeps the selection when no agent supports a global install', () => {
    expect(withGlobalSkillsDir(['promptscript'])).toEqual(['promptscript']);
  });
});
