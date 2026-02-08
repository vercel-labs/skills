import * as p from '@clack/prompts';
import pc from 'picocolors';
import type { AgentType, CognitiveType } from '../core/types.ts';
import { COGNITIVE_SUBDIRS } from '../core/types.ts';
import { agents, getUniversalAgents, getNonUniversalAgents } from '../services/registry/index.ts';
import { getLastSelectedAgents, saveSelectedAgents } from '../services/lock/lock-file.ts';
import { searchMultiselect } from './search-multiselect.ts';

// Helper to check if a value is a cancel symbol (works with both clack and our custom prompts)
export const isCancelled = (value: unknown): value is symbol => typeof value === 'symbol';

/**
 * Wrapper around p.multiselect that adds a hint for keyboard usage.
 * Accepts options with required labels (matching our usage pattern).
 */
export function multiselect<Value>(opts: {
  message: string;
  options: Array<{ value: Value; label: string; hint?: string }>;
  initialValues?: Value[];
  required?: boolean;
}) {
  return p.multiselect({
    ...opts,
    // Cast is safe: our options always have labels, which satisfies p.Option requirements
    options: opts.options as p.Option<Value>[],
    message: `${opts.message} ${pc.dim('(space to toggle)')}`,
  }) as Promise<Value[] | symbol>;
}

/**
 * Prompts the user to select agents using interactive search.
 * Pre-selects the last used agents if available.
 * Saves the selection for future use.
 */
export async function promptForAgents(
  message: string,
  choices: Array<{ value: AgentType; label: string; hint?: string }>
): Promise<AgentType[] | symbol> {
  // Get last selected agents to pre-select
  let lastSelected: string[] | undefined;
  try {
    lastSelected = await getLastSelectedAgents();
  } catch {
    // Silently ignore errors reading lock file
  }

  const validAgents = choices.map((c) => c.value);

  // Default agents to pre-select when no valid history exists
  const defaultAgents: AgentType[] = ['claude-code', 'opencode', 'codex'];
  const defaultValues = defaultAgents.filter((a) => validAgents.includes(a));

  let initialValues: AgentType[] = [];

  if (lastSelected && lastSelected.length > 0) {
    // Filter stored agents against currently valid agents
    initialValues = lastSelected.filter((a) => validAgents.includes(a as AgentType)) as AgentType[];
  }

  // If no valid selection from history, use defaults
  if (initialValues.length === 0) {
    initialValues = defaultValues;
  }

  const selected = await searchMultiselect({
    message,
    items: choices,
    initialSelected: initialValues,
    required: true,
  });

  if (!isCancelled(selected)) {
    // Save selection for next time
    try {
      await saveSelectedAgents(selected as string[]);
    } catch {
      // Silently ignore errors writing lock file
    }
  }

  return selected as AgentType[] | symbol;
}

/**
 * Interactive agent selection using fuzzy search.
 * Shows universal agents as locked (always selected), and other agents as selectable.
 */
export async function selectAgentsInteractive(options: {
  global?: boolean;
  cognitiveType?: CognitiveType;
}): Promise<AgentType[] | symbol> {
  const cognitiveType: CognitiveType = options.cognitiveType ?? 'skill';

  // Filter out agents that don't support global installation when --global is used
  const supportsGlobalFilter = (a: AgentType) =>
    !options.global || agents[a].dirs[cognitiveType]?.global;

  const universalAgents = getUniversalAgents().filter(supportsGlobalFilter);
  const otherAgents = getNonUniversalAgents().filter(supportsGlobalFilter);

  // Universal agents shown as locked section
  const universalSection = {
    title: `Universal (.agents/${COGNITIVE_SUBDIRS[cognitiveType]})`,
    items: universalAgents.map((a) => ({
      value: a,
      label: agents[a].displayName,
    })),
  };

  // Other agents are selectable with their dirs[cognitiveType].local as hint
  const otherChoices = otherAgents.map((a) => ({
    value: a,
    label: agents[a].displayName,
    hint: options.global
      ? agents[a].dirs[cognitiveType]!.global!
      : agents[a].dirs[cognitiveType]!.local,
  }));

  // Get last selected agents (filter to only non-universal ones for initial selection)
  let lastSelected: string[] | undefined;
  try {
    lastSelected = await getLastSelectedAgents();
  } catch {
    // Silently ignore errors
  }

  const initialSelected = lastSelected
    ? (lastSelected.filter(
        (a) => otherAgents.includes(a as AgentType) && !universalAgents.includes(a as AgentType)
      ) as AgentType[])
    : [];

  const selected = await searchMultiselect({
    message: 'Which agents do you want to install to?',
    items: otherChoices,
    initialSelected,
    lockedSection: universalSection,
  });

  if (!isCancelled(selected)) {
    // Save selection (all agents including universal)
    try {
      await saveSelectedAgents(selected as string[]);
    } catch {
      // Silently ignore errors
    }
  }

  return selected as AgentType[] | symbol;
}
