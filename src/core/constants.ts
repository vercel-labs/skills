import type { CognitiveType } from './types.ts';

export const AGENTS_DIR = '.agents';
export const SKILLS_SUBDIR = 'skills';
export const UNIVERSAL_SKILLS_DIR = '.agents/skills';

export const AGENTS_SUBDIR = 'agents';
export const PROMPTS_SUBDIR = 'prompts';
export const UNIVERSAL_AGENTS_DIR = '.agents/agents';
export const UNIVERSAL_PROMPTS_DIR = '.agents/prompts';

export const COGNITIVE_SUBDIRS: Record<CognitiveType, string> = {
  skill: 'skills',
  agent: 'agents',
  prompt: 'prompts',
};

export const COGNITIVE_FILE_NAMES: Record<CognitiveType, string> = {
  skill: 'SKILL.md',
  agent: 'AGENT.md',
  prompt: 'PROMPT.md',
};
