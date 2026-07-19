import type { AgentType } from '../types.ts';

export type SkillLayer = 'project' | 'global';

export type SkillLayerFilter = SkillLayer | 'all';

export interface CuiAgentOption {
  id: AgentType;
  label: string;
  detected: boolean;
}

export interface CuiInstalledSkill {
  name: string;
  layer: SkillLayer;
  agents: AgentType[];
  path?: string;
  description?: string;
  source?: string;
  sourceUrl?: string;
  sourceType?: string;
  ref?: string;
  skillPath?: string;
  hash?: string;
  hashKind?: 'skillFolderHash' | 'computedHash';
  pluginName?: string;
  installedAt?: string;
  updatedAt?: string;
  metadata?: Record<string, unknown>;
  triggers?: string[];
}

export interface CuiSearchResult {
  name: string;
  source: string;
  slug?: string;
  installs?: number;
}

export interface CuiListRequest {
  layer?: SkillLayerFilter;
  agents?: AgentType[];
}

export interface CuiSearchRequest {
  query?: string;
  owner?: string;
}

export interface CuiInstallRequest {
  source: string;
  layer: SkillLayer;
  agents: AgentType[];
  skills?: string[];
  copy?: boolean;
  fullDepth?: boolean;
}

export interface CuiUpdateRequest {
  names?: string[];
  layer?: SkillLayerFilter;
}

export interface CuiRemoveRequest {
  names: string[];
  layer: SkillLayer;
  agents?: AgentType[];
  skipConfirmation?: boolean;
}

export interface CuiMoveRequest {
  name: string;
  fromLayer: SkillLayer;
  toLayer: SkillLayer;
  agents?: AgentType[];
  skipConfirmation?: boolean;
}

export interface CuiActionResult {
  ok: boolean;
  message?: string;
}

/**
 * Execution boundary for the CUI.
 *
 * Core `skills cui` implementations should satisfy this contract by calling existing repository
 * modules directly. Standalone `skill-cui` implementations should satisfy it by invoking the
 * public `npx skills` CLI and parsing structured output where available. Keeping UI flows against
 * this interface prevents duplicating business orchestration across both entry points.
 */
export interface CuiBackend {
  list(request: CuiListRequest): Promise<CuiInstalledSkill[]>;
  search(request: CuiSearchRequest): Promise<CuiSearchResult[]>;
  install(request: CuiInstallRequest): Promise<CuiActionResult>;
  update(request: CuiUpdateRequest): Promise<CuiActionResult>;
  remove(request: CuiRemoveRequest): Promise<CuiActionResult>;
  move(request: CuiMoveRequest): Promise<CuiActionResult>;
  detectAgents?(): Promise<CuiAgentOption[]>;
}
