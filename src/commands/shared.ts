import * as p from '@clack/prompts';
import { logger, type Ora } from '../utils/logger.ts';
import { agents } from '../services/registry/index.ts';
import type { AgentType, CognitiveType } from '../core/types.ts';

// ── Cancellation ────────────────────────────────────────────────────────

/**
 * Type assertion that throws if the value is a cancellation symbol.
 * Replaces the repeated 4-line cancel+cleanup+exit pattern.
 */
export function assertNotCancelled(
  value: unknown,
  cleanup?: () => Promise<void>
): asserts value is Exclude<typeof value, symbol> {
  if (p.isCancel(value)) {
    logger.cancel('Operation cancelled');
    if (cleanup) {
      cleanup()
        .then(() => process.exit(0))
        .catch(() => process.exit(0));
    } else {
      process.exit(0);
    }
    throw new Error('cancelled');
  }
}

// ── Error Handling ──────────────────────────────────────────────────────

/**
 * Fails a spinner, shows an error message, cleans up, and exits.
 * Replaces the repeated spinner.fail + logger.outro + cleanup + exit pattern.
 */
export async function failAndExit(
  spinner: Ora,
  title: string,
  detail: string,
  cleanup?: () => Promise<void>
): Promise<never> {
  spinner.fail(title);
  logger.outro(detail);
  await cleanup?.();
  process.exit(1);
}

// ── Agent Validation ────────────────────────────────────────────────────

/**
 * Validates that all agent names are valid, exiting with an error if not.
 * Returns the validated agent names typed as AgentType[].
 */
export function validateAgentNames(agentNames: string[]): AgentType[] {
  const validAgents = Object.keys(agents);
  const invalid = agentNames.filter((a) => !validAgents.includes(a));
  if (invalid.length > 0) {
    logger.error(`Invalid agents: ${invalid.join(', ')}`);
    logger.info(`Valid agents: ${validAgents.join(', ')}`);
    process.exit(1);
  }
  return agentNames as AgentType[];
}

// ── Lock Entry Builder ──────────────────────────────────────────────────

export interface LockEntry {
  name: string;
  source: string;
  sourceType: string;
  sourceUrl: string;
  cognitivePath?: string;
  cognitiveFolderHash: string;
  cognitiveType: CognitiveType;
}

/**
 * Builds a lock entry with sensible defaults.
 * Replaces the repeated inline object construction in resolvers.
 */
export function buildLockEntry(params: {
  name: string;
  source: string;
  sourceType: string;
  sourceUrl: string;
  cognitivePath?: string;
  cognitiveType: CognitiveType;
}): LockEntry {
  return {
    ...params,
    cognitiveFolderHash: '',
  };
}
